const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { authenticate } = require('../middleware/auth');
const {
  effectivePermissions, PERMISSION_MANAGER_ROLES, isSuperAdmin, superAdminScope, canSeeActivityFeed,
} = require('../services/permissions');

// The user object every authenticated response returns. Must match GET /auth/me exactly: the
// client gates its entire navigation on `permissions`, so a login response that omits them makes
// the app think the user has no modules until the next background refresh.
async function authUserPayload(user) {
  // GA scope is email-level: if ANY row sharing this email holds a super_admin_scope grant,
  // this session inherits it. This covers auto-provisioned accounts that may not have the
  // column set yet (race with sync, legacy rows, etc.).
  if (user.email && !user.super_admin_scope) {
    const { Op } = require('sequelize');
    const sibling = await User.findOne({
      where: { email: user.email, super_admin_scope: { [Op.ne]: null } },
      attributes: ['super_admin_scope'],
    });
    if (sibling) user.super_admin_scope = sibling.super_admin_scope;
  }

  const safe = user.toJSON();
  delete safe.password_hash;
  delete safe.module_permissions;          // the resolved map below is the contract
  safe.permissions = effectivePermissions(user);
  safe.can_manage_permissions = PERMISSION_MANAGER_ROLES.includes(user.role) || isSuperAdmin(user);
  // Cross-platform Super Admin grant (migration 021) — additive to `role`, so it is reported
  // separately rather than folded into it.
  safe.super_admin_scope = superAdminScope(user);
  safe.is_super_admin = isSuperAdmin(user);
  safe.super_admin_read_only = user.super_admin_scope === 'read';
  // Platform-wide Activity feed visibility (J1) — resolved so the client just reads a boolean.
  safe.can_see_activity_feed = canSeeActivityFeed(user);
  // Platforms this person can switch between in-tool (N1): every active account under the same
  // email. One email holds at most one account per business unit (migration 002), so this is the
  // set of platforms they may hop to without re-entering credentials. A BD (no email) has just one.
  if (user.email) {
    const siblings = await User.findAll({
      where: { email: user.email, active: true },
      attributes: ['business_unit'],
    });
    safe.platforms = [...new Set(siblings.map(s => s.business_unit))].sort();
  } else {
    safe.platforms = [user.business_unit];
  }
  return safe;
}


const signToken = (user) => jwt.sign(
  { id: user.id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
);

// Password-based auth (email/BD login + self-service change-password) is DEV-ONLY.
// In production the app is SSO-only (see /sso and /sso/select below), so these
// routes reject with 403. Mirrors the production guard the SSO endpoints use.
const passwordAuthDevOnly = (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ message: 'Password login is disabled in production. Please sign in through the portal (SSO).' });
  }
  next();
};

// POST /api/auth/login — unified credential login (N1). Dev-only (production is SSO).
//
// The login screen sends { identifier, password, business_unit, role? }.
//   • Global Admin (role='super_admin'): `identifier` is an email; the account must hold a
//     super_admin_scope grant. No business_unit.
//   • Platform login (business_unit set, no role): `identifier` is an email or a full name.
//     The backend finds the user on that platform by email first, then by name, regardless of
//     role. The user's role and module access are determined by what the admin assigned — the
//     login screen does not ask for a role.
//   • Legacy: { email, password, business_unit } still works for backward compatibility.
router.post('/login', passwordAuthDevOnly, async (req, res) => {
  try {
    const { identifier, password, business_unit, role,
            /* legacy field */
            email: legacyEmail } = req.body;
    const ident = (identifier || legacyEmail || '').trim();
    if (!ident || !password) return res.status(400).json({ message: 'Credentials required' });

    let user;

    if (role === 'super_admin' || (!role && !business_unit && !legacyEmail)) {
      // --- Global Admin login: email with a super_admin_scope grant ---
      const { Op } = require('sequelize');
      user = await User.findOne({
        where: { email: ident, super_admin_scope: { [Op.ne]: null } },
      });
    } else if (business_unit) {
      // --- Platform login: find by email first, then by name, on this platform ---
      // Try email match (covers Business Admin, Manager, and any Team Member with an email)
      user = await User.findOne({ where: { email: ident, business_unit } });
      // Fallback: match by full name on this platform (Team Members typically have no email)
      if (!user) {
        user = await User.findOne({ where: { name: ident, business_unit } });
      }
    } else {
      // Legacy: email-only lookup (old frontend without business_unit)
      user = await User.findOne({ where: { email: ident } });
    }

    if (!user)                return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.active)         return res.status(403).json({ message: 'User is inactive' });
    if (!user.password_hash)  return res.status(401).json({ message: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const token = signToken(user);
    return res.json({ token, user: await authUserPayload(user) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/bd-login — legacy BD login with { userId, password }.
// Kept for backward compatibility; the new login screen uses /auth/login instead.
router.post('/bd-login', passwordAuthDevOnly, async (req, res) => {
  try {
    const { userId, password } = req.body;
    if (!userId || !password) return res.status(400).json({ message: 'BD id and password required' });

    const user = await User.findByPk(userId);
    if (!user)                return res.status(404).json({ message: 'User not found' });
    if (!user.active)         return res.status(403).json({ message: 'User is inactive' });
    if (!user.password_hash)  return res.status(500).json({ message: 'No password set. Ask a Manager to reset it.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Incorrect password' });

    const token = signToken(user);
    return res.json({ token, user: await authUserPayload(user) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// === JIOAUTIFY INTEGRATION: SSO bridge (mirrors JioTCM / Jio Inventory / Release Planner
// POST /api/auth/sso). The STB ("Jioautify") portal calls this with the logged-in user's email.
// Production-only, exactly like the other modules; the user must already exist in Sales CRM as an
// ACTIVE, email-bearing account (BDs log in with bd-login, not SSO). No auto-provisioning.
//
// A corporate email may hold up to two accounts — one per business unit (signage / jhes), see
// migration 002. So this endpoint returns one of two shapes:
//   • exactly one account  -> { token, user }  (portal opens /sales_crm?token=&data= -> home)
//   • two accounts         -> { multiple: true, accounts: [...], ticket }  (portal opens
//                             /sales_crm?ssoTicket=<ticket>; the Sales CRM page renders the account
//                             chooser and calls /sso/select to redeem a token for the chosen BU)
// `ticket` is a short-lived JWT that only names the (already portal-authenticated) email — it is
// redeemed at /sso/select. We put the ticket, not the raw email, in the redirect URL. ===
const SSO_SELECT_PURPOSE = 'salescrm-sso-select';

function ssoAccountSummary(u) {
  return { business_unit: u.business_unit, role: u.role, name: u.name };
}

router.post('/sso', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'production') {
      return res.status(403).json({ message: 'SSO is only available in production' });
    }
    const email = (req.body && req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ message: 'Email required' });

    const users = await User.findAll({ where: { email, active: true }, order: [['business_unit', 'ASC']] });
    if (!users.length) {
      return res.status(401).json({ message: 'User not provisioned in Sales CRM. Ask an admin to create your account.' });
    }

    // Two accounts (one per BU) -> hand back a chooser ticket instead of a token.
    if (users.length > 1) {
      const ticket = jwt.sign(
        { email, purpose: SSO_SELECT_PURPOSE },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ multiple: true, accounts: users.map(ssoAccountSummary), ticket });
    }

    // Single account -> straight to a token (unchanged behaviour).
    const user = users[0];
    const token = signToken(user);
    return res.json({ token, user: await authUserPayload(user) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// === JIOAUTIFY INTEGRATION: redeem an SSO chooser ticket. Called by the Sales CRM redirect page:
//   • { ticket }                       -> { accounts: [...] }  (to render the chooser)
//   • { ticket, business_unit: 'jhes' } -> { token, user }     (after the user picks an account)
// Production-only; the ticket is a 5-minute JWT issued by /sso that only carries the already
// portal-authenticated email, so this grants no more access than /sso itself. ===
router.post('/sso/select', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'production') {
      return res.status(403).json({ message: 'SSO is only available in production' });
    }
    const { ticket, business_unit } = req.body || {};
    if (!ticket) return res.status(400).json({ message: 'Ticket required' });

    let payload;
    try {
      payload = jwt.verify(ticket, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'SSO session expired. Please open Sales CRM from the portal again.' });
    }
    if (!payload || payload.purpose !== SSO_SELECT_PURPOSE || !payload.email) {
      return res.status(401).json({ message: 'Invalid SSO ticket' });
    }
    const email = payload.email;

    const users = await User.findAll({ where: { email, active: true }, order: [['business_unit', 'ASC']] });
    if (!users.length) {
      return res.status(401).json({ message: 'User not provisioned in Sales CRM. Ask an admin to create your account.' });
    }

    // No BU chosen yet -> return the account list so the page can render the chooser.
    if (!business_unit) {
      return res.json({ accounts: users.map(ssoAccountSummary) });
    }

    // BU chosen -> issue a token for that specific account.
    const user = users.find(u => u.business_unit === business_unit);
    if (!user) return res.status(404).json({ message: 'No Sales CRM account for that business unit.' });

    const token = signToken(user);
    return res.json({ token, user: await authUserPayload(user) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// === JIOAUTIFY INTEGRATION: logout endpoint called by the STB portal on sign-out (mirrors the
// JioTCM / Jio Inventory / Release Planner logout). Auth is stateless JWT, so there is no server
// session to destroy — this simply acknowledges the request so the portal's best-effort logout
// call succeeds. ===
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me — the current authenticated user, plus their effective per-module access.
// The frontend re-polls this (on focus and on an interval) so a permission change an admin makes
// applies to the affected user without them re-logging in. `permissions` is always the resolved
// map, never the raw column, so the client never has to know about defaults.
router.get('/me', authenticate, async (req, res) => {
  try {
    return res.json(await authUserPayload(req.user));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/switch-platform — body { business_unit }  (N1: in-tool platform switching)
//
// Hops the signed-in user to their account on another platform WITHOUT re-entering credentials.
// Safe because the caller is already authenticated, and it only ever issues a token for another
// account with the SAME email — one email holds at most one account per business unit (migration
// 002), so the email is the person's identity across platforms. A BD (no email) cannot switch.
router.post('/switch-platform', authenticate, async (req, res) => {
  try {
    const { business_unit } = req.body;
    if (!business_unit) return res.status(400).json({ message: 'business_unit is required' });
    if (!req.user.email) return res.status(400).json({ message: 'This account is not able to switch platforms.' });
    if (business_unit === req.user.business_unit) {
      // Already there — hand back a fresh token for the same account rather than erroring.
      return res.json({ token: signToken(req.user), user: await authUserPayload(req.user) });
    }

    const target = await User.findOne({ where: { email: req.user.email, business_unit } });
    if (!target)         return res.status(404).json({ message: 'You do not have an account on that platform.' });
    if (!target.active)  return res.status(403).json({ message: 'Your account on that platform is disabled.' });

    return res.json({ token: signToken(target), user: await authUserPayload(target) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/auth/change-password — any authenticated user (admin, PMO, or BD)
// changes their own password. Dev only; passwords are not used in production (SSO).
router.post('/change-password', passwordAuthDevOnly, authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Both passwords required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'New password too short (min 6)' });

    const user = await User.findByPk(req.user.id);
    if (!user || !user.password_hash) return res.status(404).json({ message: 'User not found' });

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Current password is wrong' });

    user.password_hash = await bcrypt.hash(newPassword, 10);
    await user.save();
    return res.json({ message: 'Password updated' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
