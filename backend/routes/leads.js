const router = require('express').Router();
const { sequelize, Lead, LeadContact, ActivityLog, StageHistory, User, DropdownOption, GlobalPo } = require('../models');
const { authenticate, adminOnly, requireModule, requireAnyModule } = require('../middleware/auth');
// Lead rows back three modules — the Leads list, the Dashboard and Reports all read them — so a
// read is allowed if ANY of those grants it. Writes are specifically a Leads-module capability.
const canReadLeadData = requireAnyModule(['leads', 'dashboard', 'reports'], 'read');
const { leadScopeWhere } = require('../middleware/scope');
const { applyHoldTransition, scoringFieldsForSave } = require('../services/scoringEngine');
const { Op } = require('sequelize');

router.use(authenticate);

// A 'forecast' account can only see the Forecast dashboard — it has no access to lead data.
router.use((req, res, next) => {
  if (req.user.role === 'forecast') return res.status(403).json({ message: 'Forecast accounts can only access the Forecast dashboard.' });
  next();
});

// Phases that have their own dedicated date column on the lead.
const PHASE_DATE_MAP = {
  New: 'start_date',
  Qualified: 'qualified_date',
  Demo: 'demo_date',
  Proposal: 'proposal_date',
  Negotiation: 'negotiation_date',
  'PO Received': 'po_received_date',
};

const FIELD_LABELS = {
  property_type: 'Property Type', property_category: 'Property Category',
  customer_name: 'Customer Name', city: 'City', state: 'State', lead_source: 'Lead Source',
  channel_partner_name: 'Channel Partner', kam_name: 'KAM Name', affiliate_name: 'Affiliate Name', new_or_renewal: 'New/Renewal',
  lead_temperature: 'Lead Rating', competitor: 'Competitor', quantity: 'Quantity',
  sent_to_scm: 'Sent to SCM',
  potential_tcv_lakhs: 'Potential TCV (L)', contract_period_months: 'Contract Period (Mo)',
  po_validity_months: 'PO Validity (Mo)', phase: 'Phase', next_followup_date: 'Next Follow-Up Date',
  po_expected_date: 'PO Expected Date', service_start_date: 'Service Start Date', service_end_date: 'Service End Date',
  po_number: 'PO Number', lost_reason: 'Lost Reason', po_actual_value_lakhs: 'Actual PO Value (L)',
  includes_platform: 'Service: Platform', platform_rate: 'Platform Rate', platform_qty: 'Platform Qty',
  includes_cms: 'Service: CMS', cms_rate: 'CMS Rate', cms_qty: 'CMS Qty',
  includes_connectivity: 'Service: Connectivity', connectivity_rate: 'Connectivity Rate', connectivity_qty: 'Connectivity Qty',
  includes_display: 'Service: Display', display_rate: 'Display Rate', display_qty: 'Display Qty',
  includes_device: 'Service: Device', device_sku: 'Device SKU', device_cost_type: 'Device Cost Type',
  device_rate: 'Device Rate', device_qty: 'Device Qty', device_requested_date: 'Device Expected Date',
  includes_amc: 'Service: AMC', amc_rate: 'AMC Rate', amc_qty: 'AMC Qty',
  includes_installation: 'Service: Installation', installation_rate: 'Installation Rate', installation_qty: 'Installation Qty',
  includes_iptv: 'Service: IPTV', iptv_rate: 'IPTV Rate', iptv_qty: 'IPTV Qty',
  includes_jhes: 'Service: JHES', jhes_rate: 'JHES Rate', jhes_qty: 'JHES Qty',
  jhes_product: 'JHES Product', additional_notes: 'Additional Notes',
};

// Signage services and their cost nature, used to auto-calculate TCV. OPEX services bill monthly
// over the contract term; CAPEX services are one-time. Device's nature is per-lead (device_cost_type).
// Mirror of frontend SIGNAGE_SERVICES in frontend/src/utils/constants.js — keep the two in sync.
const TCV_SERVICES = [
  { key: 'platform',     nature: 'opex' },
  { key: 'cms',          nature: 'opex' },
  { key: 'connectivity', nature: 'opex' },
  { key: 'amc',          nature: 'opex' },
  { key: 'iptv',         nature: 'opex' },   // JHES only in the UI; other BUs never tick it (→ 0)
  { key: 'jhes',         nature: 'opex' },   // JHES only in the UI; other BUs never tick it (→ 0)
  { key: 'display',      nature: 'capex' },
  { key: 'installation', nature: 'capex' },
];

// Auto-calculated contract value, split into its OPEX (recurring) and CAPEX (one-time) parts,
// both in lakhs (₹ / 100,000), from the ticked services:
//   OPEX  → qty × rate × contract months   (recurring, billed across the term)
//   CAPEX → qty × rate                      (one-time)
// Device uses its per-lead cost type (defaults to capex).
// Mirror of computeTcvBreakdown() in frontend/src/utils/leadHelpers.js — keep the two in sync.
function computeTcvBreakdown(body) {
  const months = parseInt(body.contract_period_months, 10) || 0;
  let opex = 0, capex = 0;
  const add = (included, rate, qty, nature) => {
    if (!included) return;
    const r = parseFloat(rate) || 0;
    const q = parseInt(qty, 10) || 0;
    if (!r || !q) return;
    if (nature === 'opex') opex += r * q * months; else capex += r * q;
  };
  for (const svc of TCV_SERVICES) {
    add(body[`includes_${svc.key}`], body[`${svc.key}_rate`], body[`${svc.key}_qty`], svc.nature);
  }
  add(body.includes_device, body.device_rate, body.device_qty, body.device_cost_type === 'opex' ? 'opex' : 'capex');
  return { opexLakhs: opex / 100000, capexLakhs: capex / 100000 };
}

// Total Contract Value in lakhs — OPEX + CAPEX. Returns 0 when nothing is calculable.
function computeTcvLakhs(body) {
  const { opexLakhs, capexLakhs } = computeTcvBreakdown(body);
  const tcv = opexLakhs + capexLakhs;
  return tcv > 0 ? +tcv.toFixed(2) : 0;
}

// Surveillance leads carry a variable services list (JSON), not per-service columns. TCV split, in
// lakhs: OPEX = rate × qty × contract months (recurring), CAPEX = rate × qty (one-time).
function computeSurveillanceBreakdown(services, months) {
  const m = parseInt(months, 10) || 0;
  let opex = 0, capex = 0;
  for (const s of (Array.isArray(services) ? services : [])) {
    const r = parseFloat(s.rate) || 0;
    const q = parseInt(s.qty, 10) || 0;
    if (!r || !q) continue;
    if (s.nature === 'opex') opex += r * q * m; else capex += r * q;
  }
  return { opexLakhs: opex / 100000, capexLakhs: capex / 100000 };
}

// Normalise a surveillance services array to the persisted shape (only ticked rows with a rate & qty).
function cleanSurveillanceServices(services) {
  return (Array.isArray(services) ? services : [])
    .filter(s => s && (parseFloat(s.rate) || 0) > 0 && (parseInt(s.qty, 10) || 0) > 0)
    .map(s => ({ label: String(s.label || ''), nature: s.nature === 'opex' ? 'opex' : 'capex', rate: parseFloat(s.rate) || 0, qty: parseInt(s.qty, 10) || 0 }));
}

// Date-only helpers — deliberately avoid toISOString()/UTC conversion.
// A DATEONLY value like "2026-07-02" must mean the same calendar day
// regardless of server timezone; round-tripping through Date+toISOString
// shifts it by a day on any positive-UTC-offset server (e.g. IST), because
// "local midnight" converts to "yesterday, 18:30 UTC". We work in local
// calendar fields (getFullYear/getMonth/getDate) throughout instead.
function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDaysLocal(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return localDateString(dt);
}

// Clamp a phase date — defense-in-depth for the "BD can adjust the phase date" business rule.
// Window is [today+2] on the high end for every phase; the low end depends on the phase:
//   * "New"   → today (a brand-new lead can't have started in the past)
//   * others  → today-2 (a phase move may have actually happened up to 2 days ago)
function clampPhaseDate(input, phase) {
  const todayStr = localDateString();
  const minStr = phase === 'New' ? todayStr : addDaysLocal(todayStr, -2);
  const maxStr = addDaysLocal(todayStr, 2);
  let val = (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) ? input : todayStr;
  if (val < minStr) val = minStr;
  if (val > maxStr) val = maxStr;
  return val;
}

// Build the persisted payload from a raw request body, applying all
// business rules server-side (quantity totals, phase-gated fields, etc).
function normalizePayload(body, { isCreate, existing }) {
  // TCV is either hand-typed (tcv_manual) or auto-calculated from the services × contract period.
  // Computing it server-side keeps the stored value authoritative regardless of the client.
  const tcvManual = !!body.tcv_manual;
  const months = parseInt(body.contract_period_months, 10) || null;
  const years = months ? months / 12 : null;
  const isSurveillance = body.business_unit === 'surveillance';
  // Custom (wizard-created) business units are anything other than the three originals. They store
  // their services the flexible JSON way (like Surveillance) rather than in per-service columns, and
  // keep admin-defined custom field values in custom_fields. The three originals are untouched.
  const isOriginalBu = ['signage', 'jhes', 'surveillance'].includes(body.business_unit);
  const useJsonServices = isSurveillance || !isOriginalBu;
  const survServices = useJsonServices ? cleanSurveillanceServices(body.surveillance_services) : null;
  let tcv, acv;
  if (tcvManual) {
    // Hand-typed TCV has no service breakdown, so annualise the whole value evenly.
    tcv = parseFloat(body.potential_tcv_lakhs) || 0;
    acv = tcv && years ? +(tcv / years).toFixed(2) : 0;
  } else {
    // Auto-calc from services. OPEX is annualised across the contract term, CAPEX (one-time) is
    // realised in full in year 1 → first-year ACV = OPEX/years + full CAPEX. Surveillance and custom
    // units use their JSON services list; signage/jhes use their per-service columns.
    const { opexLakhs, capexLakhs } = useJsonServices
      ? computeSurveillanceBreakdown(survServices, months)
      : computeTcvBreakdown(body);
    tcv = +(opexLakhs + capexLakhs).toFixed(2);
    const opexPerYear = years ? opexLakhs / years : opexLakhs;
    acv = +(opexPerYear + capexLakhs).toFixed(2);
  }
  const phase = body.phase || 'New';

  const svcQty = (included, qty) => (included && qty) ? (parseInt(qty, 10) || 0) : 0;
  const platformQty = svcQty(body.includes_platform, body.platform_qty);
  const cmsQty = svcQty(body.includes_cms, body.cms_qty);
  const connQty = svcQty(body.includes_connectivity, body.connectivity_qty);
  const displayQty = svcQty(body.includes_display, body.display_qty);
  const deviceQty = svcQty(body.includes_device, body.device_qty);
  const amcQty = svcQty(body.includes_amc, body.amc_qty);
  const installationQty = svcQty(body.includes_installation, body.installation_qty);
  const iptvQty = svcQty(body.includes_iptv, body.iptv_qty);
  const jhesQty = svcQty(body.includes_jhes, body.jhes_qty);
  // `quantity` stays the sum of the original hardware/service lines so the device Forecast
  // (which falls back to it) is unaffected; AMC/installation counts live in their own columns.
  const totalQty = platformQty + cmsQty + connQty + displayQty + deviceQty;

  const phaseChanged = isCreate || (existing && existing.phase !== phase);
  const inactivePhase = ['PO Received', 'Lost'].includes(phase);

  const payload = {
    customer_name: body.customer_name,
    owner_id: body.owner_id,
    business_unit: body.business_unit || 'signage',
    // Account Mix (all businesses).
    property_type: body.property_type || null,
    property_category: body.property_category || null,
    // A lead is always an Individual PO. global_po_id links it to a chain (null = standalone property).
    po_type: 'individual',
    global_po_id: body.global_po_id ? (parseInt(body.global_po_id, 10) || null) : null,
    city: body.city || null,
    state: body.state || null,
    lead_source: body.lead_source || null,
    channel_partner_name: body.lead_source === 'Channel Partner' ? (body.channel_partner_name || null) : null,
    kam_name: body.lead_source === 'KAM' ? (body.kam_name || null) : null,
    affiliate_name: body.lead_source === 'Lead Affiliate' ? (body.affiliate_name || null) : null,
    new_or_renewal: body.new_or_renewal || null,
    lead_temperature: body.lead_temperature || null,
    competitor: body.competitor || null,
    quantity: totalQty,
    potential_tcv_lakhs: tcv,
    tcv_manual: tcvManual,
    contract_period_months: months,
    // PO validity is derived automatically from the contract period (same duration).
    po_validity_months: months,
    acv_lakhs: acv,
    contract_value_lakhs: phase === 'PO Received' ? tcv : null,
    phase,
    po_expected_date: body.po_expected_date || null,
    next_followup_date: inactivePhase
      ? null
      : (body.next_followup_date || (phaseChanged ? defaultFollowup() : (existing ? existing.next_followup_date : defaultFollowup()))),
    includes_platform: !!body.includes_platform,
    includes_cms: !!body.includes_cms,
    includes_connectivity: !!body.includes_connectivity,
    includes_display: !!body.includes_display,
    includes_device: !!body.includes_device,
    includes_amc: !!body.includes_amc,
    includes_installation: !!body.includes_installation,
    includes_iptv: !!body.includes_iptv,
    includes_jhes: !!body.includes_jhes,
    platform_rate: body.includes_platform && body.platform_rate ? parseFloat(body.platform_rate) : null,
    cms_rate: body.includes_cms && body.cms_rate ? parseFloat(body.cms_rate) : null,
    connectivity_rate: body.includes_connectivity && body.connectivity_rate ? parseFloat(body.connectivity_rate) : null,
    display_rate: body.includes_display && body.display_rate ? parseFloat(body.display_rate) : null,
    device_rate: body.includes_device && body.device_rate ? parseFloat(body.device_rate) : null,
    amc_rate: body.includes_amc && body.amc_rate ? parseFloat(body.amc_rate) : null,
    installation_rate: body.includes_installation && body.installation_rate ? parseFloat(body.installation_rate) : null,
    iptv_rate: body.includes_iptv && body.iptv_rate ? parseFloat(body.iptv_rate) : null,
    jhes_rate: body.includes_jhes && body.jhes_rate ? parseFloat(body.jhes_rate) : null,
    platform_qty: platformQty || null,
    cms_qty: cmsQty || null,
    connectivity_qty: connQty || null,
    display_qty: displayQty || null,
    device_qty: deviceQty || null,
    amc_qty: amcQty || null,
    installation_qty: installationQty || null,
    iptv_qty: iptvQty || null,
    jhes_qty: jhesQty || null,
    // JHES only: a device quantity of 0 is a valid value (device bundled at no unit count), so persist
    // it as 0 rather than nulling it. Other businesses keep the "0 → null" behaviour.
    ...(body.business_unit === 'jhes' && body.includes_device ? { device_qty: deviceQty } : {}),
    device_sku: body.includes_device ? (body.device_sku || null) : null,
    // Device cost nature: BD's choice, defaulting to capex when a device is included; null otherwise.
    device_cost_type: body.includes_device ? (body.device_cost_type === 'opex' ? 'opex' : 'capex') : null,
    device_requested_date: body.includes_device ? (body.device_requested_date || null) : null,
    jhes_product: body.business_unit === 'jhes' ? (body.jhes_product || null) : null,
    services_json: useJsonServices ? JSON.stringify(survServices || []) : null,
    // Custom field values (admin-defined fields with no dedicated column), keyed by slug. Only custom
    // business units use this; the three originals leave it null.
    custom_fields: (!isOriginalBu && body.custom_fields && typeof body.custom_fields === 'object')
      ? body.custom_fields
      : (existing ? existing.custom_fields : null),
    additional_notes: body.additional_notes || null,
    po_document_url: body.po_document_url !== undefined ? body.po_document_url : (existing ? existing.po_document_url : null),
    // PO number (identifier) — captured only for a won deal, alongside the PO document.
    po_number: phase === 'PO Received' ? (body.po_number ? String(body.po_number).trim() : null) : null,
    lost_reason: phase === 'Lost' ? (body.lost_reason || null) : null,
    po_actual_value_lakhs: (phase === 'PO Received' && body.po_actual_value_lakhs) ? parseFloat(body.po_actual_value_lakhs) : null,
    // Service period is captured only once a deal is won (PO Received).
    service_start_date: phase === 'PO Received' ? (body.service_start_date || null) : null,
    service_end_date: phase === 'PO Received' ? (body.service_end_date || null) : null,
  };

  // Phase date handling — only touched on an actual phase transition.
  if (phaseChanged) {
    const dateCol = PHASE_DATE_MAP[phase];
    const clamped = clampPhaseDate(body.phase_date, phase);
    payload.phase_changed_at = new Date(`${clamped}T12:00:00`);
    if (dateCol) payload[dateCol] = clamped;
  } else if (existing) {
    payload.phase_changed_at = existing.phase_changed_at;
  }

  return { payload, phaseChanged, fromPhase: existing ? existing.phase : null };
}

function defaultFollowup() {
  return addDaysLocal(localDateString(), 14);
}

// When a lead is saved with a source name (Channel Partner / KAM / Lead Affiliate) entered via the
// form's "Other" option, add it as a managed dropdown option for that business so it's offered for
// future leads. Runs for every business unit — the field names are channel_partner / kam / lead_affiliate.
async function ensureSourceNameOptions(payload, transaction) {
  const bu = payload.business_unit;
  const kinds = [
    ['Channel Partner', 'channel_partner', payload.channel_partner_name],
    ['KAM', 'kam', payload.kam_name],
    ['Lead Affiliate', 'lead_affiliate', payload.affiliate_name],
  ];
  for (const [src, field, raw] of kinds) {
    if (payload.lead_source !== src) continue;
    const value = (raw || '').trim();
    if (!value) continue;
    const maxOrder = (await DropdownOption.max('sort_order', { where: { field_name: field, business_unit: bu }, transaction })) || 0;
    await DropdownOption.findOrCreate({
      where: { field_name: field, business_unit: bu, value },
      defaults: { field_name: field, business_unit: bu, value, sort_order: maxOrder + 1, active: true },
      transaction,
    });
  }
}

// Diff two field sets and return one activity_log-shaped row per change.
// Sequelize returns DECIMAL columns as fixed-format strings ("12.50"), while
// the incoming request has plain JS numbers (12.5). Compare numerically when
// both sides parse as numbers, so re-saving an unchanged value never logs a
// false "changed" entry.
function valuesEqual(o, n) {
  const os = o === null || o === undefined ? '' : String(o);
  const ns = n === null || n === undefined ? '' : String(n);
  if (os === '' && ns === '') return true;
  const of = parseFloat(os), nf = parseFloat(ns);
  const bothNumeric = os !== '' && ns !== '' && !isNaN(of) && !isNaN(nf) && String(of) !== 'NaN';
  if (bothNumeric) return Math.abs(of - nf) < 0.001;
  return os === ns;
}

// `actor` is the full req.user, not a name string: names repeat across accounts (two are called
// "PMO") and can be renamed, so the id and email are what actually identify who made the change.
function diffActivity(before, after, leadId, srNo, customerName, actor) {
  const rows = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const o = before ? before[key] : undefined;
    const n = after[key];
    const os = o === null || o === undefined ? '' : String(o);
    const ns = n === null || n === undefined ? '' : String(n);
    if (!valuesEqual(o, n)) {
      rows.push({
        lead_id: leadId, lead_sr_no: srNo, customer_name: customerName,
        user_name: actor?.name, user_id: actor?.id ?? null, user_email: actor?.email ?? null,
        action_type: key === 'phase' ? 'phase_change' : 'field_update',
        field_changed: label, old_value: os || '(empty)', new_value: ns || '(empty)',
      });
    }
  }
  return rows;
}

// --------------------------------------------------------------------------
// GET /api/leads — list, scoped to owner for BDs, with filters
// --------------------------------------------------------------------------
router.get('/', canReadLeadData, async (req, res) => {
  try {
    const { phase, lead_temperature, lead_source, owner_id, search, overdue } = req.query;
    // business_unit is always taken from the authenticated user (leadScopeWhere) and cannot be
    // overridden via query param, so a PMO/BD can never read another business unit's leads.
    const where = leadScopeWhere(req.user);
    if (phase) where.phase = { [Op.in]: phase.split(',') };
    if (lead_temperature) where.lead_temperature = { [Op.in]: lead_temperature.split(',') };
    if (lead_source) where.lead_source = { [Op.in]: lead_source.split(',') };
    if (owner_id && req.user.role !== 'bd') where.owner_id = { [Op.in]: owner_id.split(',') };
    if (search) {
      const s = `%${search}%`;
      where[Op.or] = ['customer_name', 'city', 'state', 'competitor', 'additional_notes', 'device_sku']
        .map(f => ({ [f]: { [Op.like]: s } }));
    }
    if (overdue === 'true') {
      where.next_followup_date = { [Op.lt]: new Date() };
      where.phase = { [Op.notIn]: ['Lost', 'PO Received', 'On Hold'] };
    }

    const leads = await Lead.findAll({
      where,
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] },
        // Contacts (POCs) are included in the list now so the Leads export can carry them. The list
        // is already scoped to what the caller may see (a BD only gets their own leads), so this
        // exposes no contact the caller couldn't already open on the lead itself.
        { model: LeadContact, as: 'contacts', attributes: ['name', 'phone', 'email', 'designation'] },
      ],
      order: [['sr_no', 'ASC']],
    });
    return res.json(leads);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// GET /api/leads/:id — single lead with contacts, activity, stage history
// --------------------------------------------------------------------------
router.get('/:id', canReadLeadData, async (req, res) => {
  try {
    const lead = await Lead.findByPk(req.params.id, {
      include: [
        { model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] },
        { model: LeadContact, as: 'contacts' },
        { model: GlobalPo, as: 'globalPo' },
        { model: ActivityLog, as: 'activity', order: [['createdAt', 'DESC']] },
        { model: StageHistory, as: 'stageHistory', order: [['changed_at', 'ASC']] },
      ],
    });
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    if (req.user.role === 'bd' && lead.owner_id !== req.user.id) return res.status(403).json({ message: 'Forbidden' });
    return res.json(lead);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// POST /api/leads — create
// --------------------------------------------------------------------------
router.post('/', requireModule('leads', 'full'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const body = { ...req.body };
    if (req.user.role === 'bd') body.owner_id = req.user.id; // BDs can only create leads for themselves

    const { payload } = normalizePayload(body, { isCreate: true });

    // Validate the chain link (if any): the Global PO must exist and belong to the same business.
    if (payload.global_po_id) {
      const chain = await GlobalPo.findByPk(payload.global_po_id, { transaction: t });
      if (!chain || chain.business_unit !== payload.business_unit) {
        await t.rollback();
        return res.status(400).json({ message: 'Invalid chain (Global PO) selection.' });
      }
    }

    // Confidence scoring: stamp last-activity + hold fields, then compute the initial confidence.
    applyHoldTransition(payload, null, true, body);
    Object.assign(payload, await scoringFieldsForSave(payload, null));

    const maxSrNo = await Lead.max('sr_no') || 0;
    const lead = await Lead.create({ ...payload, sr_no: maxSrNo + 1, created_by: req.user.id, updated_by: req.user.id }, { transaction: t });
    await ensureSourceNameOptions(payload, t);

    // Contacts
    if (Array.isArray(body.contacts) && body.contacts.length) {
      await LeadContact.bulkCreate(
        body.contacts.map(c => ({ lead_id: lead.id, name: c.name, phone: c.phone || null, email: c.email || null, designation: c.designation || null })),
        { transaction: t }
      );
    }

    // Stage history — first entry, no "from"
    await StageHistory.create({
      lead_id: lead.id, from_stage: null, to_stage: payload.phase,
      changed_by: req.user.name, changed_at: payload.phase_changed_at || new Date(),
    }, { transaction: t });

    // Activity log — creation event
    await ActivityLog.create({
      lead_id: lead.id, lead_sr_no: lead.sr_no, customer_name: lead.customer_name,
      user_name: req.user.name, user_id: req.user.id, user_email: req.user.email,
      action_type: 'lead_created', note: 'New lead created',
      business_unit: req.user.business_unit,
    }, { transaction: t });

    await t.commit();
    const full = await Lead.findByPk(lead.id, { include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] }] });
    return res.status(201).json(full);
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// PUT /api/leads/:id — update
// --------------------------------------------------------------------------
router.put('/:id', requireModule('leads', 'edit'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const existing = await Lead.findByPk(req.params.id, { transaction: t });
    if (!existing) {
      await t.rollback();
      return res.status(404).json({ message: 'Lead not found' });
    }

    if (req.user.role === 'bd' && existing.owner_id !== req.user.id) {
      await t.rollback();
      return res.status(403).json({ message: 'Forbidden' });
    }

    const body = { ...req.body };
    if (req.user.role === 'bd') body.owner_id = existing.owner_id; // BDs cannot reassign leads

    const before = existing.toJSON();
    const { payload, phaseChanged, fromPhase } = normalizePayload(body, { isCreate: false, existing: before });

    // Validate the chain link (if any): the Global PO must exist and belong to the same business.
    if (payload.global_po_id) {
      const chain = await GlobalPo.findByPk(payload.global_po_id, { transaction: t });
      if (!chain || chain.business_unit !== payload.business_unit) {
        await t.rollback();
        return res.status(400).json({ message: 'Invalid chain (Global PO) selection.' });
      }
    }

    // Confidence scoring: apply the On-Hold freeze/resume transition + last-activity stamp, then
    // recompute confidence (a save is a touchpoint → active leads reset to their stage base weight).
    applyHoldTransition(payload, before, false, body);
    Object.assign(payload, await scoringFieldsForSave(payload, before));

    // Use a static UPDATE (not existing.update) so the write does NOT rely on Sequelize's
    // per-instance dirty-tracking. In the mounted (STB) process that dirty-tracking was flagging
    // every data field as "unchanged", so instance.update() emitted only `SET updated_at=?` and the
    // real edits (phase, service fields, etc.) were silently dropped — while the transaction still
    // committed, so it looked like a no-op. A static update always writes the given columns.
    await Lead.update({ ...payload, updated_by: req.user.id }, { where: { id: existing.id }, transaction: t });
    await ensureSourceNameOptions(payload, t);

    // Contacts — replace-all, matching original app behavior
    if (Array.isArray(body.contacts)) {
      await LeadContact.destroy({ where: { lead_id: existing.id }, transaction: t });
      if (body.contacts.length) {
        await LeadContact.bulkCreate(
          body.contacts.map(c => ({ lead_id: existing.id, name: c.name, phone: c.phone || null, email: c.email || null, designation: c.designation || null })),
          { transaction: t }
        );
      }
    }

    if (phaseChanged) {
      await StageHistory.create({
        lead_id: existing.id, from_stage: fromPhase, to_stage: payload.phase,
        changed_by: req.user.name, changed_at: payload.phase_changed_at || new Date(),
      }, { transaction: t });
    }

    const rows = diffActivity(before, payload, existing.id, existing.sr_no, existing.customer_name, req.user);
    if (rows.length) {
      for (const r of rows) r.business_unit = req.user.business_unit;
      await ActivityLog.bulkCreate(rows, { transaction: t });
    }

    await t.commit();
    const full = await Lead.findByPk(existing.id, { include: [{ model: User, as: 'owner', attributes: ['id', 'name', 'color', 'initials'] }] });
    return res.json(full);
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// PUT /api/leads/bulk — bulk reassign or bulk phase change (admin only)
// --------------------------------------------------------------------------
router.put('/bulk/update', adminOnly, requireModule('leads', 'edit'), async (req, res) => {
  try {
    const { ids, owner_id, phase } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ message: 'ids[] required' });

    const updates = { updated_by: req.user.id };
    if (owner_id) updates.owner_id = owner_id;
    if (phase) {
      updates.phase = phase;
      updates.phase_changed_at = new Date();
      // A phase change is a touchpoint → reset the decay clock, and clear any hold freeze when the
      // bulk move is to an active (non-hold) stage.
      updates.last_activity_at = new Date();
      if (phase !== 'On Hold') {
        Object.assign(updates, { hold_frozen_confidence: null, hold_entered_at: null, hold_end_date: null, pre_hold_stage: null });
      }
    }

    await Lead.update(updates, { where: { id: { [Op.in]: ids } } });
    // Refresh confidence for the affected leads immediately (recomputes all; cheap at this scale).
    if (phase) { try { await require('../services/scoringEngine').recomputeAll(); } catch (e) { /* non-fatal */ } }
    return res.json({ message: `Updated ${ids.length} lead(s)` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// DELETE /api/leads/:id — admin only
// --------------------------------------------------------------------------
router.delete('/:id', adminOnly, requireModule('leads', 'full'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const lead = await Lead.findByPk(req.params.id, { transaction: t });
    if (!lead) { await t.rollback(); return res.status(404).json({ message: 'Lead not found' }); }

    await LeadContact.destroy({ where: { lead_id: lead.id }, transaction: t });
    await ActivityLog.destroy({ where: { lead_id: lead.id }, transaction: t });
    await StageHistory.destroy({ where: { lead_id: lead.id }, transaction: t });
    await lead.destroy({ transaction: t });

    await t.commit();
    return res.json({ message: 'Lead deleted' });
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: err.message });
  }
});

// --------------------------------------------------------------------------
// POST /api/leads/bulk — bulk import from Excel upload
// --------------------------------------------------------------------------
const VALID_PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];
const VALID_TEMPS = ['Hot', 'Warm', 'Cold'];
const VALID_RENEWAL = ['New', 'Renewal', 'Expansion'];
const VALID_LOST_REASONS = ['Pricing', 'Competition', 'No Budget', 'No Decision', 'Timing', 'Product Fit', 'Other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.post('/bulk', adminOnly, async (req, res) => {
  const { rows, dryRun = true, business_unit } = req.body;
  const bu = business_unit || req.user.business_unit;

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ message: 'No rows provided.' });
  }
  if (rows.length > 500) {
    return res.status(400).json({ message: 'Maximum 500 rows per upload.' });
  }

  const users = await User.findAll({ where: { business_unit: bu, active: true }, attributes: ['id', 'email', 'name'] });
  const userByEmail = {};
  users.forEach(u => { if (u.email) userByEmail[u.email.toLowerCase().trim()] = u; });

  const valid = [];
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;
    const errs = [];

    const customerName = (r.customer_name || '').trim();
    const ownerEmail = (r.owner_email || '').trim();
    const phase = (r.phase || '').trim();

    if (!customerName) errs.push({ field: 'Customer Name', message: 'Required' });
    if (!ownerEmail) errs.push({ field: 'Lead Owner Email', message: 'Required' });
    if (!phase) errs.push({ field: 'Phase', message: 'Required' });

    let ownerId = null;
    if (ownerEmail) {
      const owner = userByEmail[ownerEmail.toLowerCase()];
      if (owner) ownerId = owner.id;
      else errs.push({ field: 'Lead Owner Email', message: `No active user "${ownerEmail}" in this business` });
    }

    if (phase && !VALID_PHASES.includes(phase)) {
      errs.push({ field: 'Phase', message: `Invalid. Valid: ${VALID_PHASES.join(', ')}` });
    }
    if (phase === 'Lost' && !(r.lost_reason || '').trim()) {
      errs.push({ field: 'Lost Reason', message: 'Required when Phase is Lost' });
    }
    if (r.lost_reason && !VALID_LOST_REASONS.includes(r.lost_reason.trim())) {
      errs.push({ field: 'Lost Reason', message: `Invalid. Valid: ${VALID_LOST_REASONS.join(', ')}` });
    }
    if (r.lead_temperature && !VALID_TEMPS.includes(r.lead_temperature.trim())) {
      errs.push({ field: 'Lead Temperature', message: 'Must be Hot, Warm, or Cold' });
    }
    if (r.new_or_renewal && !VALID_RENEWAL.includes(r.new_or_renewal.trim())) {
      errs.push({ field: 'New or Renewal', message: 'Must be New, Renewal, or Expansion' });
    }

    const numericFields = [
      'tcv_lakhs', 'contract_period_months', 'quantity',
      'platform_rate', 'platform_qty', 'cms_rate', 'cms_qty',
      'connectivity_rate', 'connectivity_qty', 'amc_rate', 'amc_qty',
      'display_rate', 'display_qty', 'installation_rate', 'installation_qty',
      'jhes_rate', 'jhes_qty', 'iptv_rate', 'iptv_qty',
      'device_rate', 'device_qty', 'po_actual_value_lakhs',
    ];
    for (const nf of numericFields) {
      if (r[nf] !== undefined && r[nf] !== '' && isNaN(Number(r[nf]))) {
        errs.push({ field: nf, message: 'Must be a number' });
      }
    }

    const dateFields = ['next_followup_date', 'po_expected_date', 'hold_end_date', 'service_start_date', 'service_end_date', 'device_requested_date'];
    for (const df of dateFields) {
      if (r[df] && !DATE_RE.test(r[df])) errs.push({ field: df, message: 'Date must be YYYY-MM-DD' });
    }

    if (r.device_cost_type && !['capex', 'opex'].includes(r.device_cost_type.toLowerCase())) {
      errs.push({ field: 'Device Cost Type', message: 'Must be capex or opex' });
    }

    const contacts = [];
    for (let c = 1; c <= 3; c++) {
      const cn = (r[`contact_${c}_name`] || '').trim();
      const ce = (r[`contact_${c}_email`] || '').trim();
      if (cn || ce) {
        if (!cn) errs.push({ field: `Contact ${c} Name`, message: 'Name required when email is provided' });
        if (!ce) errs.push({ field: `Contact ${c} Email`, message: 'Email required when name is provided' });
        contacts.push({ name: cn, email: ce, phone: (r[`contact_${c}_phone`] || '').trim() || null, designation: (r[`contact_${c}_designation`] || '').trim() || null });
      }
    }
    if (contacts.length === 0) errs.push({ field: 'Contact 1 Name', message: 'At least one contact with Name and Email required' });

    if (errs.length > 0) {
      errors.push({ row: rowNum, errors: errs });
    } else {
      const leadSource = (r.lead_source || '').trim() || null;
      const sourceName = (r.source_name || '').trim() || null;
      const parseBool = (v) => {
        if (!v) return false;
        const s = String(v).trim().toLowerCase();
        return s === 'yes' || s === 'true' || s === '1';
      };
      const optNum = (v) => (v !== undefined && v !== '' ? Number(v) : null);
      const optStr = (v) => (v ? String(v).trim() : null);

      const leadData = {
        customer_name: customerName,
        owner_id: ownerId,
        business_unit: bu,
        city: optStr(r.city),
        state: optStr(r.state),
        lead_source: leadSource,
        channel_partner_name: leadSource === 'Channel Partner' ? sourceName : null,
        kam_name: leadSource === 'KAM' ? sourceName : null,
        affiliate_name: leadSource === 'Lead Affiliate' ? sourceName : null,
        new_or_renewal: optStr(r.new_or_renewal),
        lead_temperature: optStr(r.lead_temperature),
        competitor: optStr(r.competitor),
        property_type: optStr(r.property_type),
        property_category: optStr(r.property_category),
        phase,
        next_followup_date: r.next_followup_date || null,
        po_expected_date: r.po_expected_date || null,
        lost_reason: phase === 'Lost' ? optStr(r.lost_reason) : null,
        hold_end_date: phase === 'On Hold' ? (r.hold_end_date || null) : null,
        contract_period_months: optNum(r.contract_period_months),
        quantity: r.quantity ? Number(r.quantity) : 0,
        po_number: optStr(r.po_number),
        po_actual_value_lakhs: optNum(r.po_actual_value_lakhs),
        service_start_date: r.service_start_date || null,
        service_end_date: r.service_end_date || null,
        additional_notes: optStr(r.additional_notes),
        jhes_product: optStr(r.jhes_product),
        // Services
        includes_platform: parseBool(r.includes_platform), platform_rate: optNum(r.platform_rate), platform_qty: optNum(r.platform_qty),
        includes_cms: parseBool(r.includes_cms), cms_rate: optNum(r.cms_rate), cms_qty: optNum(r.cms_qty),
        includes_connectivity: parseBool(r.includes_connectivity), connectivity_rate: optNum(r.connectivity_rate), connectivity_qty: optNum(r.connectivity_qty),
        includes_amc: parseBool(r.includes_amc), amc_rate: optNum(r.amc_rate), amc_qty: optNum(r.amc_qty),
        includes_display: parseBool(r.includes_display), display_rate: optNum(r.display_rate), display_qty: optNum(r.display_qty),
        includes_installation: parseBool(r.includes_installation), installation_rate: optNum(r.installation_rate), installation_qty: optNum(r.installation_qty),
        includes_jhes: parseBool(r.includes_jhes), jhes_rate: optNum(r.jhes_rate), jhes_qty: optNum(r.jhes_qty),
        includes_iptv: parseBool(r.includes_iptv), iptv_rate: optNum(r.iptv_rate), iptv_qty: optNum(r.iptv_qty),
        // Device
        includes_device: parseBool(r.includes_device), device_sku: optStr(r.device_sku),
        device_cost_type: r.device_cost_type ? r.device_cost_type.toLowerCase().trim() : null,
        device_rate: optNum(r.device_rate), device_qty: optNum(r.device_qty),
        device_requested_date: r.device_requested_date || null,
        _contacts: contacts,
        _rowNum: i + 2,
      };

      // Extract custom_xxx fields into a JSON object for storage in custom_fields column
      const customFields = {};
      for (const [key, val] of Object.entries(r)) {
        if (key.startsWith('custom_') && val !== undefined && val !== '') {
          customFields[key.replace('custom_', '')] = String(val).trim();
        }
      }
      if (Object.keys(customFields).length > 0) leadData.custom_fields = customFields;

      if (r.tcv_lakhs !== undefined && r.tcv_lakhs !== '') {
        leadData.potential_tcv_lakhs = Number(r.tcv_lakhs);
        leadData.tcv_manual = true;
      } else {
        const autoTcv = computeTcvLakhs(leadData);
        if (autoTcv > 0) {
          leadData.potential_tcv_lakhs = autoTcv;
          leadData.tcv_manual = false;
        } else {
          leadData.potential_tcv_lakhs = null;
          leadData.tcv_manual = true;
        }
      }

      valid.push(leadData);
    }
  }

  if (dryRun) {
    return res.json({ validCount: valid.length, errorCount: errors.length, errors, totalRows: rows.length });
  }

  const t = await sequelize.transaction();
  try {
    let maxSr = (await Lead.max('sr_no', { transaction: t })) || 0;
    const createdIds = [];

    for (const row of valid) {
      maxSr += 1;
      const contacts = row._contacts;
      delete row._contacts;
      delete row._rowNum;

      const payload = {
        ...row,
        sr_no: maxSr,
        po_type: 'individual',
        phase_changed_at: new Date(),
        last_activity_at: new Date(),
        created_by: req.user.id,
        updated_by: req.user.id,
      };

      applyHoldTransition(payload, null, true, row);
      Object.assign(payload, await scoringFieldsForSave(payload, null));

      const lead = await Lead.create(payload, { transaction: t });
      await ensureSourceNameOptions(payload, t);

      if (contacts.length > 0) {
        await LeadContact.bulkCreate(
          contacts.map(c => ({ lead_id: lead.id, name: c.name, phone: c.phone, email: c.email, designation: c.designation })),
          { transaction: t },
        );
      }

      await StageHistory.create({
        lead_id: lead.id, from_stage: null, to_stage: payload.phase,
        changed_by: req.user.name, changed_at: new Date(),
      }, { transaction: t });

      await ActivityLog.create({
        lead_id: lead.id, lead_sr_no: lead.sr_no, customer_name: lead.customer_name,
        user_name: req.user.name, user_id: req.user.id, user_email: req.user.email,
        action_type: 'lead_created', note: 'Bulk import',
        business_unit: bu,
      }, { transaction: t });

      createdIds.push(lead.id);
    }

    await t.commit();
    return res.json({
      validCount: valid.length, errorCount: errors.length, errors,
      created: createdIds.length,
      message: `Successfully imported ${createdIds.length} lead${createdIds.length !== 1 ? 's' : ''}.`,
    });
  } catch (err) {
    await t.rollback();
    return res.status(500).json({ message: `Import failed: ${err.message}` });
  }
});

module.exports = router;
