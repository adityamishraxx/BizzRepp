// Per-platform SLA (days-per-stage) config — admin only. Base weights and hourglass jumps are fixed
// constants in code and are NOT editable here; only the SLA window per stage is configurable, and it
// is independent for each platform (signage / jhes / surveillance).
const router = require('express').Router();
const { SlaConfig } = require('../models');
const { authenticate, authorize, adminOnly } = require('../middleware/auth');
const { STAGES_WITH_SLA, DEFAULT_SLA, BASE } = require('../services/scoring');
const { recomputeAll, isValidBusinessUnit } = require('../services/scoringEngine');
const audit = require('../services/audit');

router.use(authenticate);

// Editing the TAT is restricted to a business's PMO and Business Admin. (super_admin may VIEW any
// platform's TAT via GET, but the operational TAT is owned by the business's PMO / Business Admin.)
const tatEditors = authorize('business_admin', 'pmo');

// super_admin may target any platform via ?business_unit=; everyone else is scoped to their own.
function resolveBu(user, requested) {
  return user.role === 'super_admin' ? (requested || user.business_unit) : user.business_unit;
}

// Full stage list for a platform: the editable TAT (days) plus the FIXED confidence weightage per
// stage (a shared constant, shown read-only — it is not platform-specific and cannot be edited).
async function stagesFor(bu) {
  const rows = await SlaConfig.findAll({ where: { business_unit: bu } });
  const map = {};
  for (const r of rows) map[r.stage] = Number(r.sla_days);
  return STAGES_WITH_SLA.map(stage => ({
    stage,
    tat_days: map[stage] != null ? map[stage] : DEFAULT_SLA[stage],
    weight: BASE[stage],
  }));
}

// GET /api/sla?business_unit=signage → { business_unit, stages: [{stage, tat_days, weight}] }
router.get('/', adminOnly, async (req, res) => {
  try {
    const bu = resolveBu(req.user, req.query.business_unit);
    if (!(await isValidBusinessUnit(bu))) return res.status(400).json({ message: 'Invalid business_unit' });
    return res.json({ business_unit: bu, stages: await stagesFor(bu) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// PUT /api/sla  body: { business_unit, tats: { 'New': 2, 'Qualified': 5, ... } }
// Upserts the TAT days for the given platform, then recomputes confidence so the change is immediate.
// Only the business's PMO / Business Admin may call this (see tatEditors).
router.put('/', tatEditors, async (req, res) => {
  try {
    const bu = resolveBu(req.user, req.body.business_unit);
    if (!(await isValidBusinessUnit(bu))) return res.status(400).json({ message: 'Invalid business_unit' });
    const tats = req.body.tats || req.body.slas || {};

    for (const stage of STAGES_WITH_SLA) {
      const raw = tats[stage];
      if (raw === undefined || raw === null || raw === '') continue;
      const days = parseInt(raw, 10);
      if (!Number.isFinite(days) || days < 1 || days > 365) {
        return res.status(400).json({ message: `TAT for "${stage}" must be a whole number of days (1-365).` });
      }
      const [row, created] = await SlaConfig.findOrCreate({
        where: { business_unit: bu, stage },
        defaults: { business_unit: bu, stage, sla_days: days },
      });
      if (!created && Number(row.sla_days) !== days) {
        const wasDays = Number(row.sla_days);
        await SlaConfig.update({ sla_days: days }, { where: { id: row.id } });
        await audit.record({
          actor: req.user, entityType: 'sla', entityId: row.id, subject: `${stage} TAT`,
          businessUnit: bu, action: 'field_update',
          field: `${stage} TAT (days)`, from: wasDays, to: days,
        });
      }
    }

    try { await recomputeAll(); } catch (e) { /* SLA saved even if the refresh hiccups */ }
    return res.json({ business_unit: bu, stages: await stagesFor(bu) });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
