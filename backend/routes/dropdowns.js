const router = require('express').Router();
const { DropdownOption } = require('../models');
const { authenticate, authorize, requireModule } = require('../middleware/auth');

router.use(authenticate);

// Super Admin / Business Admin / PMO may add or remove dropdown options (scoped to their own business
// for non-super roles). This covers device SKUs, sources, partners, ratings, etc.
const canManageDropdowns = authorize('super_admin', 'business_admin', 'pmo');

// The business a dropdown action targets: super_admin may specify one; everyone else uses their own.
const targetBu = (user, requested) => (user.role === 'super_admin' ? (requested || user.business_unit) : user.business_unit);

// GET /api/dropdowns — options for the caller's business, grouped: { field_name: [values] }.
router.get('/', async (req, res) => {
  try {
    const bu = targetBu(req.user, req.query.business_unit);
    const rows = await DropdownOption.findAll({
      where: { active: true, business_unit: bu },
      order: [['field_name', 'ASC'], ['sort_order', 'ASC']],
    });
    const grouped = {};
    for (const r of rows) (grouped[r.field_name] ||= []).push(r.value);
    return res.json(grouped);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/dropdowns/manage?field_name=X — full option rows (id + value) for the manager UI.
router.get('/manage', canManageDropdowns, async (req, res) => {
  try {
    const bu = targetBu(req.user, req.query.business_unit);
    const where = { active: true, business_unit: bu };
    if (req.query.field_name) where.field_name = req.query.field_name;
    const rows = await DropdownOption.findAll({
      where, attributes: ['id', 'field_name', 'value'],
      order: [['field_name', 'ASC'], ['sort_order', 'ASC']],
    });
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/dropdowns — Super/Business Admin. Body: { field_name, value, business_unit? }.
router.post('/', canManageDropdowns, requireModule('leads', 'full'), async (req, res) => {
  try {
    const { field_name, value } = req.body;
    if (!field_name || !value || !String(value).trim()) return res.status(400).json({ message: 'field_name and value are required' });
    const bu = targetBu(req.user, req.body.business_unit);
    const v = String(value).trim();
    const maxOrder = (await DropdownOption.max('sort_order', { where: { field_name, business_unit: bu } })) || 0;
    const [row, created] = await DropdownOption.findOrCreate({
      where: { field_name, business_unit: bu, value: v },
      defaults: { field_name, business_unit: bu, value: v, sort_order: maxOrder + 1, active: true },
    });
    if (!created && !row.active) { row.active = true; await row.save(); }
    return res.status(201).json(row);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// DELETE /api/dropdowns/:id — Super/Business Admin (soft delete). A Business Admin can only remove
// options within their own business; super_admin may remove any.
router.delete('/:id', canManageDropdowns, requireModule('leads', 'full'), async (req, res) => {
  try {
    const row = await DropdownOption.findByPk(req.params.id);
    if (!row) return res.status(404).json({ message: 'Option not found' });
    if (req.user.role !== 'super_admin' && row.business_unit !== req.user.business_unit) {
      return res.status(403).json({ message: 'You can only manage your own business\'s options.' });
    }
    row.active = false;
    await row.save();
    return res.json({ message: 'Option removed' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
