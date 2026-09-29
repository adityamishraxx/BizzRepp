const router = require('express').Router();
const { Lead, User, ActivityLog, LeadContact } = require('../models');
const { Op } = require('sequelize');
const { authenticate, requireModule } = require('../middleware/auth');
const { hasLevel } = require('../services/permissions');

// Forecast access is governed solely by the per-module level (Settings -> Access), which is
// seeded from the legacy users.forecast_access flag by migration 020. The flag itself is no
// longer consulted: having two independent switches for the same thing meant an admin could
// grant Forecast in the Access editor and still see the user blocked.

// Cost of one service line, in lakhs (₹ / 100,000), following the same convention as
// computeTcvBreakdown() in routes/leads.js:
//   opex  → rate × qty × contract months  (recurring across the term)
//   capex → rate × qty                    (one-time)
// Returns 0 when the service isn't ticked or the rate/qty is missing.
function lineLakhs(included, rate, qty, nature, months) {
  if (!included) return 0;
  const r = parseFloat(rate) || 0;
  const q = parseInt(qty, 10) || 0;
  if (!r || !q) return 0;
  return (nature === 'opex' ? r * q * months : r * q) / 100000;
}

// Forecast price columns, derived server-side so the raw unit rates never leave the API (the
// forecast audience is granted volumes and totals, not the rate card — see the attribute list below).
//   price_tcv_lakhs  — "Price / TCV": the JHES platform line plus the device line.
//   iptv_price_lakhs — IPTV kept separate, as its own selectable column, rather than folded above.
// Device uses its per-lead cost nature (device_cost_type, default capex); JHES and IPTV are opex.
function priceFields(lead) {
  const months = parseInt(lead.contract_period_months, 10) || 0;
  const jhes = lineLakhs(lead.includes_jhes, lead.jhes_rate, lead.jhes_qty, 'opex', months);
  const device = lineLakhs(lead.includes_device, lead.device_rate, lead.device_qty, lead.device_cost_type === 'opex' ? 'opex' : 'capex', months);
  const iptv = lineLakhs(lead.includes_iptv, lead.iptv_rate, lead.iptv_qty, 'opex', months);
  const round = (n) => n > 0 ? +n.toFixed(2) : 0;
  return { price_tcv_lakhs: round(jhes + device), iptv_price_lakhs: round(iptv) };
}

// GET /api/forecast/devices — requires login + forecast access. Scoped to the caller's own business
// unit (forecast is per-business). Returns only the fields the forecast needs (never contact info,
// raw unit rates, or notes) plus the derived price columns from priceFields().
router.get('/devices', authenticate, requireModule('forecast', 'read'), async (req, res) => {
  try {
    const rows = await Lead.findAll({
      where: { includes_device: true, phase: { [Op.ne]: 'Lost' }, business_unit: req.user.business_unit },
      attributes: [
        'id', 'customer_name', 'business_unit', 'city', 'state', 'device_sku', 'quantity', 'device_qty',
        'po_expected_date', 'device_requested_date', 'phase',
        // owner_id lets the dashboard tell which rows the caller may actually open: the forecast
        // spans the whole business unit, but GET /api/leads/:id only lets a BD read their own.
        'owner_id',
        // Additional selectable forecast columns.
        'property_category', 'new_or_renewal', 'potential_tcv_lakhs', 'contract_period_months', 'confidence_score',
        // Chain link (null = standalone). Chain properties outrank standalone ones in the
        // shared prioritization order — see frontend/src/utils/leadPriority.js.
        'global_po_id',
        // Manual SCM-handoff marker and its last-changed provenance (migration 019).
        'sent_to_scm', 'sent_to_scm_at', 'sent_to_scm_by',
        // Rate/qty inputs for priceFields() only — stripped from the response below.
        'includes_jhes', 'jhes_rate', 'jhes_qty',
        'includes_iptv', 'iptv_rate', 'iptv_qty',
        'includes_device', 'device_rate', 'device_cost_type',
      ],
      // Contacts (POCs) go to the export, but only for a caller who can already read the Leads
      // module. A dedicated forecast-only account is deliberately kept away from contact info (it
      // gets volumes and totals, not the rate card or the POCs), so it never receives them here.
      include: [
        { model: User, as: 'owner', attributes: ['name'] },
        ...(hasLevel(req.user, 'leads', 'read')
          ? [{ model: LeadContact, as: 'contacts', attributes: ['name', 'phone', 'email', 'designation'] }]
          : []),
      ],
    });

    // Replace the rate inputs with the derived price columns so no unit rate is serialised.
    const payload = rows.map((row) => {
      const lead = row.toJSON();
      const prices = priceFields(lead);
      for (const k of ['jhes_rate', 'jhes_qty', 'iptv_rate', 'iptv_qty', 'device_rate']) delete lead[k];
      return { ...lead, ...prices };
    });
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PATCH /api/forecast/devices/:id/sent-to-scm — body { sent_to_scm: boolean }
//
// Lives on the forecast router rather than /api/leads on purpose: the people who perform the SCM
// handoff are exactly the dashboard's audience, and that audience can't use the leads API — a
// 'forecast' account is refused outright there, and a BD may only write leads they own, while the
// dashboard deliberately shows every device lead in the business unit. So this endpoint grants one
// narrow write (this flag, nothing else) to anyone who can already see the row.
//
// Purely a tracking marker: no notification, no handoff, and nothing else on the lead is touched.
router.patch('/devices/:id/sent-to-scm', authenticate, requireModule('forecast', 'edit'), async (req, res) => {
  try {
    const { sent_to_scm } = req.body;
    if (typeof sent_to_scm !== 'boolean') {
      return res.status(400).json({ message: 'sent_to_scm must be true or false' });
    }

    // Scope to the caller's own business unit, matching the devices listing above.
    const lead = await Lead.findOne({ where: { id: req.params.id, business_unit: req.user.business_unit } });
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const was = !!lead.sent_to_scm;
    if (was === sent_to_scm) {
      // Already in the requested state — report it without writing a spurious audit entry.
      return res.json({ id: lead.id, sent_to_scm: was, sent_to_scm_at: lead.sent_to_scm_at, sent_to_scm_by: lead.sent_to_scm_by });
    }

    const now = new Date();
    lead.sent_to_scm = sent_to_scm;
    lead.sent_to_scm_at = sent_to_scm ? now : null;
    lead.sent_to_scm_by = sent_to_scm ? req.user.name : null;
    await lead.save();

    await ActivityLog.create({
      lead_id: lead.id, lead_sr_no: lead.sr_no, customer_name: lead.customer_name,
      user_name: req.user.name, user_id: req.user.id, user_email: req.user.email,
      action_type: 'field_update', field_changed: 'Sent to SCM',
      old_value: was ? 'Yes' : 'No', new_value: sent_to_scm ? 'Yes' : 'No',
      note: sent_to_scm ? 'Marked as sent to SCM' : 'Unmarked as sent to SCM',
    });

    return res.json({ id: lead.id, sent_to_scm: lead.sent_to_scm, sent_to_scm_at: lead.sent_to_scm_at, sent_to_scm_by: lead.sent_to_scm_by });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
