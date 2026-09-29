import React, { useEffect, useState } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { useAuth } from '../context/AuthContext';
import { createLead, updateLead, uploadPoDocument, fileUrl, getBds, getDropdowns, getGlobalPos, createGlobalPo } from '../services/api';
import { DEVICE_SKU_MAP, LOST_REASONS, SIGNAGE_SERVICES, JHES_SERVICES, SURVEILLANCE_ITEMS, INDIAN_STATES, UNION_TERRITORIES, PROPERTY_TYPES, PROPERTY_CATEGORIES } from '../utils/constants';
import { todayStr, addDaysStr, computeTcvLakhs, computeAcvLakhs, computeTcvBreakdown, hasConfidence, confidenceTrend } from '../utils/leadHelpers';
import DropdownManager from './DropdownManager';

const NOTES_TOOLBAR = [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link'], ['clean']];

const PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];
const SOURCES = ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate'];
const RENEWALS = ['New', 'Renewal', 'Expansion'];
const RATINGS = ['Hot', 'Warm', 'Cold'];

const emptyForm = {
  property_type: '', property_category: '',
  customer_name: '', owner_id: '', city: '', state: '', lead_source: '', channel_partner_name: '', kam_name: '', affiliate_name: '',
  new_or_renewal: '', lead_temperature: '', competitor: '',
  includes_platform: false, platform_rate: '', platform_qty: '',
  includes_cms: false, cms_rate: '', cms_qty: '',
  includes_connectivity: false, connectivity_rate: '', connectivity_qty: '',
  includes_amc: false, amc_rate: '', amc_qty: '',
  includes_iptv: false, iptv_rate: '', iptv_qty: '',
  includes_jhes: false, jhes_rate: '', jhes_qty: '',
  includes_display: false, display_rate: '', display_qty: '',
  includes_installation: false, installation_rate: '', installation_qty: '',
  includes_device: false, device_sku: '', device_cost_type: 'capex', device_rate: '', device_qty: '', device_requested_date: '',
  jhes_product: '',
  potential_tcv_lakhs: '', tcv_manual: false, contract_period_months: '', po_validity_months: '',
  global_po_id: '',
  phase: 'New', next_followup_date: '', po_expected_date: '', lost_reason: '', po_actual_value_lakhs: '',
  service_start_date: '', service_end_date: '',
  hold_end_date: '', po_number: '',
  additional_notes: '',
};

// Confidence badge colour band by score.
const confBand = (c) => c >= 60 ? { bg: '#dcfce7', fg: '#166534' } : c >= 30 ? { bg: '#fef3c7', fg: '#92400e' } : { bg: '#f1f5f9', fg: '#475569' };

function Field({ label, children, required }) {
  return (
    <div>
      <label className="field-label">{label}{required && ' *'}</label>
      {children}
    </div>
  );
}

// Small tag showing a service's cost nature, so BDs can see how it feeds the TCV calc.
function NatureChip({ nature }) {
  const opex = nature === 'opex';
  return (
    <span className={`badge ${opex ? 'badge-blue' : 'badge-amber'}`} style={{ marginLeft: 6, fontSize: 10, fontWeight: 700 }}>
      {opex ? 'Opex · recurring' : 'Capex · one-time'}
    </span>
  );
}

export default function LeadForm({ lead, onSave, onCancel }) {
  const { user, isAdmin, canManageDropdowns, canEdit, canFull, canAct } = useAuth();
  // Per-module levels: Edit can change existing leads, Full can also create. Read-only opens the
  // form purely to view — a disabled fieldset covers every input at once, so no control is missed.
  const leadsReadOnly = !canAct || !canEdit('leads');
  // 'Manage' opens the dropdown-option editors: module-level configuration, which Edit excludes.
  const showManage = canAct && canManageDropdowns && canFull('leads');
  const isJHES = user.business_unit === 'jhes';
  const isSurveillance = user.business_unit === 'surveillance';

  const [form, setForm] = useState(emptyForm);
  const [contacts, setContacts] = useState([]);
  const [bds, setBds] = useState([]);
  const [dropdowns, setDropdowns] = useState({});              // per-business dropdown options
  const [cpOther, setCpOther] = useState(false);               // "Other — enter a new name" selected
  const [affOther, setAffOther] = useState(false);             // Lead Affiliate "Other" (JHES only)
  const [ptOther, setPtOther] = useState(false);               // Property Type "Other" → manual entry
  const [pcOther, setPcOther] = useState(false);               // Property Category "Other" → manual entry
  const channelPartners = dropdowns.channel_partner || [];
  const affiliates = dropdowns.lead_affiliate || [];
  const deviceSkus = dropdowns.device_sku || [];
  const sourceOpts  = (dropdowns.lead_source && dropdowns.lead_source.length)         ? dropdowns.lead_source      : SOURCES;
  const ratingOpts  = (dropdowns.lead_temperature && dropdowns.lead_temperature.length) ? dropdowns.lead_temperature : RATINGS;
  const renewalOpts = (dropdowns.new_or_renewal && dropdowns.new_or_renewal.length)   ? dropdowns.new_or_renewal   : RENEWALS;
  // Surveillance services — map keyed by `${label}__${nature}` → { on, rate, qty }.
  const [survServices, setSurvServices] = useState({});
  const setSurv = (key, patch) => setSurvServices(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...patch } }));
  const [phaseChanged, setPhaseChanged] = useState(false);
  const [phaseDate, setPhaseDate] = useState(todayStr());
  const [poFile, setPoFile] = useState(null);
  const [existingPoUrl, setExistingPoUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lostOther, setLostOther] = useState('');
  // Global vs Individual PO. Only chosen at creation; an existing lead is always an Individual PO.
  const [poType, setPoType] = useState('individual');
  const [chains, setChains] = useState([]);                 // Global POs (chains) for linkage
  const [linkToChain, setLinkToChain] = useState(false);    // Individual: property belongs to a chain
  const emptyGlobal = { chain_name: '', device_total: '', price_lakhs: '', expected_start_date: '', expected_end_date: '' };
  const [globalForm, setGlobalForm] = useState(emptyGlobal);
  const setGlobal = (k, v) => setGlobalForm(f => ({ ...f, [k]: v }));

  useEffect(() => { getBds(user.business_unit).then(setBds).catch(() => {}); }, [user.business_unit]);
  useEffect(() => { getGlobalPos().then(setChains).catch(() => setChains([])); }, [user.business_unit]);
  const loadDropdowns = () => getDropdowns().then(setDropdowns).catch(() => {});
  useEffect(() => { loadDropdowns(); }, []);
  // If an existing lead's channel partner isn't in the managed list, treat it as an "Other" value.
  useEffect(() => {
    if (form.lead_source === 'Channel Partner' && form.channel_partner_name
        && channelPartners.length && !channelPartners.includes(form.channel_partner_name)) {
      setCpOther(true);
    }
    if (isJHES && form.lead_source === 'Lead Affiliate' && form.affiliate_name
        && affiliates.length && !affiliates.includes(form.affiliate_name)) {
      setAffOther(true);
    }
  }, [dropdowns, form.lead_source, form.channel_partner_name, form.affiliate_name, isJHES]); // eslint-disable-line

  useEffect(() => {
    if (lead) {
      setForm({
        property_type: lead.property_type || '', property_category: lead.property_category || '',
        customer_name: lead.customer_name || '', owner_id: lead.owner_id || '',
        city: lead.city || '', state: lead.state || '', lead_source: lead.lead_source || '',
        channel_partner_name: lead.channel_partner_name || '', kam_name: lead.kam_name || '', affiliate_name: lead.affiliate_name || '',
        new_or_renewal: lead.new_or_renewal || '', lead_temperature: lead.lead_temperature || '', competitor: lead.competitor || '',
        includes_platform: !!lead.includes_platform, platform_rate: lead.platform_rate || '', platform_qty: lead.platform_qty || '',
        includes_cms: !!lead.includes_cms, cms_rate: lead.cms_rate || '', cms_qty: lead.cms_qty || '',
        includes_connectivity: !!lead.includes_connectivity, connectivity_rate: lead.connectivity_rate || '', connectivity_qty: lead.connectivity_qty || '',
        includes_amc: !!lead.includes_amc, amc_rate: lead.amc_rate || '', amc_qty: lead.amc_qty || '',
        includes_iptv: !!lead.includes_iptv, iptv_rate: lead.iptv_rate || '', iptv_qty: lead.iptv_qty || '',
        includes_jhes: !!lead.includes_jhes, jhes_rate: lead.jhes_rate || '', jhes_qty: lead.jhes_qty || '',
        includes_display: !!lead.includes_display, display_rate: lead.display_rate || '', display_qty: lead.display_qty || '',
        includes_installation: !!lead.includes_installation, installation_rate: lead.installation_rate || '', installation_qty: lead.installation_qty || '',
        includes_device: !!lead.includes_device, device_sku: lead.device_sku || '', device_cost_type: lead.device_cost_type || 'capex', device_rate: lead.device_rate || '',
        device_qty: lead.device_qty || '', device_requested_date: lead.device_requested_date || '',
        jhes_product: lead.jhes_product || '',
        potential_tcv_lakhs: lead.potential_tcv_lakhs || '', tcv_manual: lead.tcv_manual === undefined ? true : !!lead.tcv_manual,
        contract_period_months: lead.contract_period_months || '',
        po_validity_months: lead.po_validity_months || '',
        phase: lead.phase || 'New', next_followup_date: lead.next_followup_date || '', po_expected_date: lead.po_expected_date || '',
        service_start_date: lead.service_start_date || '', service_end_date: lead.service_end_date || '',
        hold_end_date: lead.hold_end_date || '', po_number: lead.po_number || '',
        global_po_id: lead.global_po_id || '',
        lost_reason: lead.lost_reason?.startsWith('Other: ') ? 'Other' : (lead.lost_reason || ''),
        po_actual_value_lakhs: lead.po_actual_value_lakhs || '', additional_notes: lead.additional_notes || '',
      });
      setLostOther(lead.lost_reason?.startsWith('Other: ') ? lead.lost_reason.slice(7) : '');
      setContacts((lead.contacts || []).map(c => ({ name: c.name, phone: c.phone || '', email: c.email || '', designation: c.designation || '' })));
      setExistingPoUrl(lead.po_document_url || null);
      try {
        const arr = lead.services_json ? JSON.parse(lead.services_json) : [];
        const map = {};
        for (const s of arr) map[s.label] = { on: true, nature: s.nature === 'opex' ? 'opex' : 'capex', rate: String(s.rate ?? ''), qty: String(s.qty ?? '') };
        setSurvServices(map);
      } catch { setSurvServices({}); }
      setPhaseChanged(false);
      setPoType('individual');            // an existing lead is always an Individual PO
      setLinkToChain(!!lead.global_po_id);
      // A stored Account Mix value not in the fixed list is a manually-entered "Other" value.
      setPtOther(!!lead.property_type && !PROPERTY_TYPES.includes(lead.property_type));
      setPcOther(!!lead.property_category && !PROPERTY_CATEGORIES.includes(lead.property_category));
    } else {
      // Both business units capture the same itemized services now, so TCV auto-calculates for both
      // (the BD can still override it by hand).
      setForm({ ...emptyForm, owner_id: !isAdmin ? user.id : '', next_followup_date: addDaysStr(todayStr(), 14), tcv_manual: false, device_rate: isJHES ? '0' : '' });
      setPoType('individual'); setLinkToChain(false); setGlobalForm(emptyGlobal); setCpOther(false); setAffOther(false); setPtOther(false); setPcOther(false);
      // Start with one empty POC row — name & email are mandatory (at least one contact required).
      setContacts([{ name: '', phone: '', email: '', designation: '' }]);
      setSurvServices({});
      setExistingPoUrl(null);
      setPhaseChanged(true);
      setPhaseDate(todayStr());
    }
  }, [lead, isAdmin, user]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handlePhaseChange = (newPhase) => {
    const inactive = ['PO Received', 'Lost'].includes(newPhase);
    setForm(f => ({
      ...f,
      phase: newPhase,
      next_followup_date: inactive ? '' : addDaysStr(todayStr(), 14),
      // Entering On Hold: seed the resume/hold-until date so confidence freezes with an end date.
      hold_end_date: newPhase === 'On Hold' ? (f.hold_end_date || addDaysStr(todayStr(), 60)) : '',
    }));
    setPhaseDate(todayStr());
    setPhaseChanged(true);
  };

  // Surveillance TCV split (lakhs) from its JSON services map. Mirror of computeSurveillanceBreakdown
  // in backend/routes/leads.js.
  const survBreakdown = () => {
    const m = parseInt(form.contract_period_months, 10) || 0;
    let opex = 0, capex = 0;
    for (const svc of Object.values(survServices)) {
      if (!svc || !svc.on) continue;
      const r = parseFloat(svc.rate) || 0, q = parseInt(svc.qty, 10) || 0;
      if (!r || !q) continue;
      if (svc.nature === 'opex') opex += r * q * m; else capex += r * q;
    }
    return { opexLakhs: opex / 100000, capexLakhs: capex / 100000 };
  };

  // TCV auto-calculates from the ticked services × contract period, unless the BD overrides it
  // (tcv_manual). effectiveTcv is what's shown in the field and persisted on save.
  const computedTcv = isSurveillance
    ? (() => { const { opexLakhs, capexLakhs } = survBreakdown(); const t = opexLakhs + capexLakhs; return t > 0 ? +t.toFixed(2) : ''; })()
    : computeTcvLakhs(form);
  const effectiveTcv = form.tcv_manual ? form.potential_tcv_lakhs : computedTcv;
  const overrideTcv = () => setForm(f => ({ ...f, tcv_manual: true, potential_tcv_lakhs: computedTcv || 0 }));
  const useAutoTcv = () => setForm(f => ({ ...f, tcv_manual: false }));

  // First-year ACV: OPEX is annualised over the contract term, but CAPEX (one-time) is realised in
  // full in year 1. JHES / manual-TCV leads have no service breakdown, so the whole TCV is
  // annualised evenly. Mirrors the backend ACV rule in normalizePayload().
  const acv = () => {
    if (form.tcv_manual || isJHES) return computeAcvLakhs(form, { manual: true, manualTcv: form.potential_tcv_lakhs });
    if (isSurveillance) {
      const { opexLakhs, capexLakhs } = survBreakdown();
      if (opexLakhs + capexLakhs <= 0) return null;
      const m = parseInt(form.contract_period_months, 10) || 0; const years = m ? m / 12 : 0;
      return +((years ? opexLakhs / years : opexLakhs) + capexLakhs).toFixed(2);
    }
    return computeAcvLakhs(form, { manual: form.tcv_manual, manualTcv: form.potential_tcv_lakhs });
  };

  const addContact = () => setContacts(c => [...c, { name: '', phone: '', email: '', designation: '' }]);
  const updateContact = (i, key, val) => setContacts(c => c.map((row, idx) => idx === i ? { ...row, [key]: val } : row));
  const removeContact = (i) => setContacts(c => c.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      // Global PO — a chain reference record only (no funnel, no POC, no scoring). Created in "new" mode.
      if (!lead && poType === 'global') {
        if (!globalForm.chain_name.trim()) { setError('Chain name is required.'); return; }
        const devices = parseInt(globalForm.device_total, 10);
        if (!Number.isFinite(devices) || devices < 0) { setError('Number of devices must be a non-negative whole number.'); return; }
        const savedGlobal = await createGlobalPo({
          chain_name: globalForm.chain_name.trim(),
          device_total: devices,
          price_lakhs: globalForm.price_lakhs === '' ? null : parseFloat(globalForm.price_lakhs),
          expected_start_date: globalForm.expected_start_date || null,
          expected_end_date: globalForm.expected_end_date || null,
        });
        onSave(savedGlobal);
        return;
      }
      // POC is mandatory: at least one contact, each with a name and email.
      if (contacts.length === 0 || contacts.some(c => !c.name.trim() || !c.email.trim())) {
        setError('At least one contact (POC) with Name and Email is required.');
        return;
      }
      // A PO document is mandatory once a deal is marked PO Received.
      if (form.phase === 'PO Received' && !existingPoUrl && !poFile) {
        setError('A PO document is required once the phase is PO Received.');
        return;
      }
      // Once the PO document is attached, its PO Number (identifier) is required.
      if (form.phase === 'PO Received' && (existingPoUrl || poFile) && !String(form.po_number || '').trim()) {
        setError('Please enter the PO Number for the received PO.');
        return;
      }
      const payload = {
        ...form,
        business_unit: user.business_unit,
        // Chain link — only when the property is marked as part of a chain (else standalone).
        global_po_id: linkToChain && form.global_po_id ? form.global_po_id : null,
        // In auto mode form.potential_tcv_lakhs isn't kept in sync — send the computed value.
        potential_tcv_lakhs: form.tcv_manual ? form.potential_tcv_lakhs : (computedTcv || ''),
        // Surveillance leads carry their ticked services (backend recomputes TCV from these).
        surveillance_services: isSurveillance
          ? Object.entries(survServices)
              .filter(([, svc]) => svc && svc.on && parseFloat(svc.rate) > 0 && parseInt(svc.qty, 10) > 0)
              .map(([label, svc]) => ({ label, nature: svc.nature === 'opex' ? 'opex' : 'capex', rate: parseFloat(svc.rate), qty: parseInt(svc.qty, 10) }))
          : undefined,
        lost_reason: form.phase === 'Lost' && form.lost_reason === 'Other' && lostOther.trim()
          ? `Other: ${lostOther.trim()}` : form.lost_reason,
        contacts,
        phase_date: phaseChanged ? phaseDate : undefined,
        // Resume/hold-until date — only meaningful while On Hold (freezes confidence until manual resume).
        hold_end_date: form.phase === 'On Hold' ? (form.hold_end_date || undefined) : undefined,
        po_document_url: existingPoUrl,
      };

      let saved = lead ? await updateLead(lead.id, payload) : await createLead(payload);

      if (poFile) {
        const { url } = await uploadPoDocument(saved.id, poFile);
        saved = await updateLead(saved.id, { ...payload, po_document_url: url });
      }

      onSave(saved);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // "New" can't be backdated (a lead starts today at the earliest); every other phase move may
  // have happened up to 2 days ago. The high end is always today+2.
  const isNewPhase = form.phase === 'New';
  const minPhaseDate = isNewPhase ? todayStr() : addDaysStr(todayStr(), -2);
  const maxPhaseDate = addDaysStr(todayStr(), 2);
  const inactivePhase = ['PO Received', 'Lost'].includes(form.phase);

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {leadsReadOnly && (
        <div style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#475569' }}>
          👁 Read-only — you can view this lead but not change it.
        </div>
      )}
      <fieldset disabled={leadsReadOnly} style={{ border: 'none', padding: 0, margin: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 22 }}>
      {error && <div className="badge badge-red" style={{ padding: '8px 12px', fontSize: 13 }}>{error}</div>}

      {/* PO Type — chosen at creation. An existing lead is always an Individual PO. */}
      {!lead && (
        <section>
          <p className="section-title">PO Type</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { key: 'individual', title: 'Individual PO', desc: 'A property-level deal — enters the funnel and is scored.' },
              { key: 'global', title: 'Global PO (chain)', desc: 'A chain/account reference record — not tracked in the funnel.' },
            ].map(o => (
              <button key={o.key} type="button" onClick={() => setPoType(o.key)}
                style={{ flex: 1, minWidth: 200, textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '12px 14px',
                  border: `2px solid ${poType === o.key ? '#4f46e5' : '#e2e8f0'}`, background: poType === o.key ? '#eef2ff' : '#fff' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{o.title}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{o.desc}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Global PO sub-form — reference record only (no funnel, no scoring). */}
      {!lead && poType === 'global' && (
        <section>
          <p className="section-title">Global PO — Chain Reference</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Chain Name" required>
              <input required className="input" value={globalForm.chain_name} onChange={e => setGlobal('chain_name', e.target.value)} placeholder="e.g. Sunrise Hotels" />
            </Field>
            <Field label="Number of Devices" required>
              <input required type="number" min="0" className="input" value={globalForm.device_total} onChange={e => setGlobal('device_total', e.target.value)} placeholder="Total capacity across the chain" />
            </Field>
            <Field label="Price (₹ Lakhs)">
              <input type="number" step="0.01" min="0" className="input" value={globalForm.price_lakhs} onChange={e => setGlobal('price_lakhs', e.target.value)} />
            </Field>
            <div />
            <Field label="Expected Start Date">
              <input type="date" className="input" value={globalForm.expected_start_date} onChange={e => setGlobal('expected_start_date', e.target.value)} />
            </Field>
            <Field label="Expected End Date">
              <input type="date" className="input" value={globalForm.expected_end_date} onChange={e => setGlobal('expected_end_date', e.target.value)} />
            </Field>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>Saved for reference only — a Global PO does not enter the sales funnel and has no stage or confidence score. Devices consumed are tracked automatically as its Individual POs are won.</p>
        </section>
      )}

      {poType === 'individual' && (<>
      {/* Chain Mapping — link this Individual PO to a chain, or leave it standalone. */}
      <section>
        <p className="section-title">Chain Mapping</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#334155' }}>
          <input type="checkbox" checked={linkToChain} onChange={e => { setLinkToChain(e.target.checked); if (!e.target.checked) set('global_po_id', ''); }} />
          This property belongs to a chain
        </label>
        {linkToChain ? (
          <div style={{ marginTop: 10 }}>
            <Field label="Chain (Global PO)" required>
              <select required className="input" value={form.global_po_id} onChange={e => set('global_po_id', e.target.value)}>
                <option value="">Select a chain…</option>
                {chains.map(c => {
                  const s = c.status || {};
                  return <option key={c.id} value={c.id}>{c.chain_name} — {s.consumed ?? 0} of {c.device_total} won{s.exceeded ? ' · exceeded' : ` · ${s.remaining} left`}</option>;
                })}
              </select>
            </Field>
            {chains.length === 0 && <p style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>No chains yet — create one first via New Lead → PO Type → Global PO.</p>}
          </div>
        ) : (
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Standalone property — no chain mapping.</p>
        )}
      </section>

      {/* Account Mix — captured before the customer details (all businesses). Optional; "Other" lets the
          user type a custom value. */}
      <section>
        <p className="section-title">Account Mix</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Property Type">
            <select className="input" value={ptOther ? 'Other' : form.property_type}
              onChange={e => {
                if (e.target.value === 'Other') { setPtOther(true); set('property_type', ''); }
                else { setPtOther(false); set('property_type', e.target.value); }
              }}>
              <option value="">Select type</option>
              {PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            {ptOther && (
              <input className="input" style={{ marginTop: 8 }} placeholder="Enter property type"
                value={form.property_type} onChange={e => set('property_type', e.target.value)} />
            )}
          </Field>
          <Field label="Property Category">
            <select className="input" value={pcOther ? 'Other' : form.property_category}
              onChange={e => {
                if (e.target.value === 'Other') { setPcOther(true); set('property_category', ''); }
                else { setPcOther(false); set('property_category', e.target.value); }
              }}>
              <option value="">Select category</option>
              {PROPERTY_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            {pcOther && (
              <input className="input" style={{ marginTop: 8 }} placeholder="Enter property category"
                value={form.property_category} onChange={e => set('property_category', e.target.value)} />
            )}
          </Field>
        </div>
      </section>

      {/* Section 1: Lead Info */}
      <section>
        <p className="section-title">Lead Information</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Customer Name" required>
            <input required className="input" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} />
          </Field>
          <Field label="Lead Owner" required>
            {isAdmin ? (
              <select required className="input" value={form.owner_id} onChange={e => set('owner_id', e.target.value)}>
                <option value="">Select BD</option>
                {bds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : (
              <input className="input" value={user.name} readOnly disabled style={{ background: '#f8fafc' }} />
            )}
          </Field>
          <Field label="State / UT" required>
            <select required className="input" value={form.state} onChange={e => set('state', e.target.value)}>
              <option value="">Select State / UT</option>
              {form.state && ![...INDIAN_STATES, ...UNION_TERRITORIES].includes(form.state) && <option value={form.state}>{form.state}</option>}
              <optgroup label="States">{INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
              <optgroup label="Union Territories">{UNION_TERRITORIES.map(s => <option key={s} value={s}>{s}</option>)}</optgroup>
            </select>
          </Field>
          <Field label="City"><input className="input" value={form.city} onChange={e => set('city', e.target.value)} /></Field>
          <Field label="Lead Source" required>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select required className="input" style={{ flex: 1 }} value={form.lead_source} onChange={e => set('lead_source', e.target.value)}>
                <option value="">Select</option>
                {form.lead_source && !sourceOpts.includes(form.lead_source) && <option value={form.lead_source}>{form.lead_source}</option>}
                {sourceOpts.map(s => <option key={s}>{s}</option>)}
              </select>
              {showManage && <DropdownManager field="lead_source" label="Lead Source" onChange={loadDropdowns} />}
            </div>
          </Field>
          {form.lead_source === 'Channel Partner' && (
            <Field label="Channel Partner Name" required>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <select
                  required
                  className="input"
                  style={{ flex: 1 }}
                  value={cpOther ? '__other__' : form.channel_partner_name}
                  onChange={e => {
                    if (e.target.value === '__other__') { setCpOther(true); set('channel_partner_name', ''); }
                    else { setCpOther(false); set('channel_partner_name', e.target.value); }
                  }}>
                  <option value="">Select channel partner</option>
                  {channelPartners.map(cp => <option key={cp} value={cp}>{cp}</option>)}
                  <option value="__other__">Other (enter name)…</option>
                </select>
                {showManage && <DropdownManager field="channel_partner" label="Channel Partner" onChange={loadDropdowns} />}
              </div>
              {cpOther && (
                <input required className="input" style={{ marginTop: 8 }} placeholder="Enter new channel partner name"
                  value={form.channel_partner_name} onChange={e => set('channel_partner_name', e.target.value)} />
              )}
            </Field>
          )}
          {form.lead_source === 'KAM' && (
            <Field label="KAM Name" required>
              <input required className="input" value={form.kam_name} onChange={e => set('kam_name', e.target.value)} placeholder="Key Account Manager name" />
            </Field>
          )}
          {form.lead_source === 'Lead Affiliate' && (
            <Field label="Affiliate Name" required>
              {isJHES ? (
                <>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <select
                      required
                      className="input"
                      style={{ flex: 1 }}
                      value={affOther ? '__other__' : form.affiliate_name}
                      onChange={e => {
                        if (e.target.value === '__other__') { setAffOther(true); set('affiliate_name', ''); }
                        else { setAffOther(false); set('affiliate_name', e.target.value); }
                      }}>
                      <option value="">Select affiliate</option>
                      {affiliates.map(a => <option key={a} value={a}>{a}</option>)}
                      <option value="__other__">Other (enter name)…</option>
                    </select>
                    {showManage && <DropdownManager field="lead_affiliate" label="Lead Affiliate" onChange={loadDropdowns} />}
                  </div>
                  {affOther && (
                    <input required className="input" style={{ marginTop: 8 }} placeholder="Enter new affiliate name"
                      value={form.affiliate_name} onChange={e => set('affiliate_name', e.target.value)} />
                  )}
                </>
              ) : (
                <input required className="input" value={form.affiliate_name} onChange={e => set('affiliate_name', e.target.value)} placeholder="Lead affiliate name" />
              )}
            </Field>
          )}
          <Field label="New / Renewal" required>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select required className="input" style={{ flex: 1 }} value={form.new_or_renewal} onChange={e => set('new_or_renewal', e.target.value)}>
                <option value="">Select</option>
                {form.new_or_renewal && !renewalOpts.includes(form.new_or_renewal) && <option value={form.new_or_renewal}>{form.new_or_renewal}</option>}
                {renewalOpts.map(r => <option key={r}>{r}</option>)}
              </select>
              {showManage && <DropdownManager field="new_or_renewal" label="New / Renewal" onChange={loadDropdowns} />}
            </div>
          </Field>
          <Field label="Lead Rating" required>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select required className="input" style={{ flex: 1 }} value={form.lead_temperature} onChange={e => set('lead_temperature', e.target.value)}>
                <option value="">Select</option>
                {form.lead_temperature && !ratingOpts.includes(form.lead_temperature) && <option value={form.lead_temperature}>{form.lead_temperature}</option>}
                {ratingOpts.map(r => <option key={r}>{r}</option>)}
              </select>
              {showManage && <DropdownManager field="lead_temperature" label="Lead Rating" onChange={loadDropdowns} />}
            </div>
          </Field>
          <Field label="Competitor"><input className="input" value={form.competitor} onChange={e => set('competitor', e.target.value)} placeholder="Optional" /></Field>
        </div>
      </section>

      {/* Section 2: Services Offered. Signage/JHES share the itemised list; Surveillance has its own
          catalogue (each service selectable as Opex and/or Capex). */}
      <section>
          <p className="section-title">Services Offered</p>
        {isSurveillance ? (
          <>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '-6px 0 10px' }}>
              Tick each service, choose whether it's <b>Opex</b> (recurring) or <b>Capex</b> (one-time),
              then enter its unit rate and quantity. These feed the auto-calculated TCV below.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SURVEILLANCE_ITEMS.map(label => {
                const ssvc = survServices[label] || {};
                const son = !!ssvc.on;
                const snat = ssvc.nature || 'opex';
                return (
                  <div key={label} className="card-sm" style={{ borderColor: son ? '#c7d2fe' : '#e2e8f0', background: son ? '#eef2ff' : '#fff' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                      <input type="checkbox" checked={son} onChange={e => setSurv(label, e.target.checked ? { on: true, nature: snat } : { on: false, rate: '', qty: '' })} />
                      {label}
                      {son && <NatureChip nature={snat} />}
                    </label>
                    {son && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        <Field label="Cost Type" required>
                          <div style={{ display: 'flex', gap: 18 }}>
                            {[['opex', 'Opex (recurring)'], ['capex', 'Capex (one-time)']].map(([ct, lbl]) => (
                              <label key={ct} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                                <input type="radio" name={`surv_nature_${label}`} checked={snat === ct} onChange={() => setSurv(label, { nature: ct })} />
                                {lbl}
                              </label>
                            ))}
                          </div>
                        </Field>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <Field label={snat === 'opex' ? 'Unit Rate (₹/month)' : 'Unit Rate (₹, one-time)'}>
                            <input type="number" step="0.01" min="0" className="input" value={ssvc.rate || ''} onChange={e => setSurv(label, { rate: e.target.value })} />
                          </Field>
                          <Field label="Quantity" required><input required type="number" min="1" className="input" value={ssvc.qty || ''} onChange={e => setSurv(label, { qty: e.target.value })} /></Field>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '-6px 0 10px' }}>
            Tick each service, then enter its unit rate and quantity. <b>Opex</b> is recurring (billed monthly over the contract);
            <b> Capex</b> is one-time. These feed the auto-calculated TCV below.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(isJHES ? JHES_SERVICES : SIGNAGE_SERVICES).map(svc => {
              const on = form[`includes_${svc.key}`];
              return (
                <div key={svc.key} className="card-sm" style={{ borderColor: on ? '#c7d2fe' : '#e2e8f0', background: on ? '#eef2ff' : '#fff' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    <input type="checkbox" checked={on} onChange={e => {
                      set(`includes_${svc.key}`, e.target.checked);
                      if (!e.target.checked) { set(`${svc.key}_rate`, ''); set(`${svc.key}_qty`, ''); }
                    }} />
                    {svc.label}
                    <NatureChip nature={svc.nature} />
                  </label>
                  {on && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                      <Field label={svc.nature === 'opex' ? 'Unit Rate (₹/month)' : 'Unit Rate (₹, one-time)'}>
                        <input type="number" step="0.01" min="0" className="input" value={form[`${svc.key}_rate`]} onChange={e => set(`${svc.key}_rate`, e.target.value)} />
                      </Field>
                      <Field label="Quantity" required><input required type="number" min="1" className="input" value={form[`${svc.key}_qty`]} onChange={e => set(`${svc.key}_qty`, e.target.value)} /></Field>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="card-sm" style={{ borderColor: form.includes_device ? '#c7d2fe' : '#e2e8f0', background: form.includes_device ? '#eef2ff' : '#fff' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                <input type="checkbox" checked={form.includes_device} onChange={e => {
                  set('includes_device', e.target.checked);
                  if (e.target.checked) {
                    if (!form.device_cost_type) set('device_cost_type', 'capex');
                    // JHES: device unit price defaults to 0.
                    if (isJHES) setForm(f => (f.device_rate === '' || f.device_rate == null) ? { ...f, device_rate: '0' } : f);
                  }
                  else { set('device_sku', ''); set('device_rate', ''); set('device_qty', ''); set('device_requested_date', ''); set('device_cost_type', 'capex'); }
                }} />
                Device
                <NatureChip nature={form.device_cost_type === 'opex' ? 'opex' : 'capex'} />
              </label>
              {form.includes_device && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  <Field label="Cost Type" required>
                    <div style={{ display: 'flex', gap: 18 }}>
                      {[['capex', 'Capex (one-time)'], ['opex', 'Opex (recurring)']].map(([ct, lbl]) => (
                        <label key={ct} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                          <input type="radio" name="device_cost_type" checked={(form.device_cost_type || 'capex') === ct} onChange={() => set('device_cost_type', ct)} />
                          {lbl}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Field label="Device SKU" required>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select required className="input" style={{ flex: 1 }} value={form.device_sku} onChange={e => set('device_sku', e.target.value)}>
                          <option value="">Select SKU</option>
                          {form.device_sku && !deviceSkus.includes(form.device_sku) && <option value={form.device_sku}>{form.device_sku}</option>}
                          {deviceSkus.map(sku => <option key={sku} value={sku}>{sku}</option>)}
                        </select>
                        {showManage && <DropdownManager field="device_sku" label="Device SKU" onChange={loadDropdowns} />}
                      </div>
                    </Field>
                    {form.device_sku && DEVICE_SKU_MAP[form.device_sku] && <Field label="Device Type"><input className="input" readOnly disabled value={DEVICE_SKU_MAP[form.device_sku]} style={{ background: '#f8fafc' }} /></Field>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <Field label={form.device_cost_type === 'opex' ? 'Unit Rate (₹/month)' : 'Unit Rate (₹, one-time)'}><input type="number" step="0.01" min="0" className="input" value={form.device_rate} onChange={e => set('device_rate', e.target.value)} /></Field>
                    <Field label="Quantity" required><input required type="number" min={isJHES ? 0 : 1} className="input" value={form.device_qty} onChange={e => set('device_qty', e.target.value)} /></Field>
                  </div>
                  <Field label="Device Expected Date">
                    <input type="date" className="input" value={form.device_requested_date} onChange={e => set('device_requested_date', e.target.value)} />
                    <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>When these devices are expected — used (and sorted by) in the Inventory Pipeline.</p>
                  </Field>
                </div>
              )}
            </div>
          </div>
          </>
        )}
      </section>

      {/* Section 3: Deal Size — Contract Period first, since the auto-calculated TCV depends on it */}
      <section>
        <p className="section-title">Deal Size</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <Field label="Contract Period (Months)" required><input required type="number" min="1" className="input" value={form.contract_period_months} onChange={e => set('contract_period_months', e.target.value)} /></Field>
          <Field label="Potential TCV (Lakhs)" required>
            <input
              required type="number" step="0.01" min="0" className="input"
              value={effectiveTcv}
              readOnly={!form.tcv_manual}
              onChange={e => set('potential_tcv_lakhs', e.target.value)}
              style={!form.tcv_manual ? { background: '#f8fafc', color: '#334155' } : undefined}
              title={!form.tcv_manual ? 'Auto-calculated — click Override to edit' : undefined}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {form.tcv_manual ? (
                <>
                  <button type="button" className="btn btn-sm" onClick={useAutoTcv}>↻ Use auto-calc</button>
                  {computedTcv !== '' && <span style={{ fontSize: 11, color: '#94a3b8' }}>Auto-calc: ₹{computedTcv} L</span>}
                </>
              ) : (
                <>
                  <button type="button" className="btn btn-sm" onClick={overrideTcv}>✎ Override</button>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    {computedTcv === ''
                      ? 'Auto-calc: add services with rate & quantity (and contract period), or Override to type a value.'
                      : 'Auto-calculated from services × contract period.'}
                  </span>
                </>
              )}
            </div>
          </Field>
          <Field label="PO Validity (Months)">
            <input type="number" className="input" value={form.contract_period_months || ''} readOnly disabled style={{ background: '#f8fafc', color: '#334155' }} title="Auto-filled from Contract Period" />
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Auto-filled from Contract Period.</p>
          </Field>
        </div>
        {acv() !== null && (
          <div className="badge badge-blue" style={{ marginTop: 10, padding: '6px 12px' }}>
            First-Year ACV: ₹{acv()} L/yr
            {!form.tcv_manual && computeTcvBreakdown(form).capexLakhs > 0 && (
              <span style={{ marginLeft: 6, fontWeight: 500 }}>· incl. one-time CAPEX in year 1</span>
            )}
          </div>
        )}
      </section>

      {/* Section 4: Phase & Timeline */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <p className="section-title" style={{ marginBottom: 0 }}>Phase & Timeline</p>
          {lead && hasConfidence(lead) && (() => {
            const c = Math.round(Number(lead.confidence_score));
            const band = confBand(c), t = confidenceTrend(lead);
            const mark = t === 'up' ? <span style={{ color: '#16a34a' }}>▲ up</span>
              : t === 'down' ? <span style={{ color: '#dc2626' }}>▼ down</span>
              : t === 'hold' ? <span style={{ color: '#0ea5e9' }}>❄ frozen</span>
              : <span style={{ color: '#94a3b8' }}>● flat</span>;
            return (
              <span title="Win-confidence score (auto-computed from stage + SLA decay)"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: band.bg, color: band.fg, borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
                Confidence {c}% <span style={{ fontSize: 11, fontWeight: 600 }}>{mark} vs last week</span>
              </span>
            );
          })()}
        </div>
        <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 12px' }}>Confidence is calculated automatically from the phase and its SLA decay — it is not editable.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Current Phase" required>
            <select required className="input" value={form.phase} onChange={e => handlePhaseChange(e.target.value)}>
              {PHASES.map(p => <option key={p}>{p}</option>)}
            </select>
          </Field>
          {!inactivePhase && (
            <Field label="Next Follow-Up Date">
              <input type="date" className="input" value={form.next_followup_date} onChange={e => set('next_followup_date', e.target.value)} />
            </Field>
          )}
          {phaseChanged && (
            <Field label={`"${form.phase}" Date ${isNewPhase ? '(today to +2 days)' : '(±2 days)'}`}>
              <input type="date" className="input" value={phaseDate} min={minPhaseDate} max={maxPhaseDate} onChange={e => setPhaseDate(e.target.value)} />
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                {isNewPhase
                  ? 'Defaults to today. A new lead can be dated today up to 2 days ahead.'
                  : 'Defaults to today. Adjust ±2 days if this phase actually happened earlier or later.'}
              </p>
            </Field>
          )}
          {form.phase === 'On Hold' && (
            <Field label="Resume / Hold-until Date">
              <input type="date" className="input" value={form.hold_end_date} onChange={e => set('hold_end_date', e.target.value)} />
              <p style={{ fontSize: 11, color: '#0ea5e9', marginTop: 4 }}>Confidence is frozen while On Hold. Reaching this date does not auto-resume — move the phase back manually to restart the lead.</p>
            </Field>
          )}
          {form.phase === 'Lost' && (
            <Field label="Lost Reason" required>
              <select required className="input" value={form.lost_reason} onChange={e => set('lost_reason', e.target.value)}>
                <option value="">Select reason</option>
                {LOST_REASONS.map(r => <option key={r}>{r}</option>)}
              </select>
              {form.lost_reason === 'Other' && (
                <textarea className="input" rows={2} style={{ marginTop: 8, resize: 'none' }} value={lostOther} onChange={e => setLostOther(e.target.value)} placeholder="Please describe the reason…" />
              )}
            </Field>
          )}
          {form.phase === 'PO Received' && (
            <Field label="Actual PO Value (Lakhs)">
              <input type="number" step="0.01" min="0" className="input" value={form.po_actual_value_lakhs} onChange={e => set('po_actual_value_lakhs', e.target.value)} />
            </Field>
          )}
          {form.phase === 'PO Received' && (
            <Field label="Service Start Date" required>
              <input type="date" required className="input" value={form.service_start_date} onChange={e => set('service_start_date', e.target.value)} />
            </Field>
          )}
          {form.phase === 'PO Received' && (
            <Field label="Service End Date" required>
              <input type="date" required min={form.service_start_date || undefined} className="input" value={form.service_end_date} onChange={e => set('service_end_date', e.target.value)} />
            </Field>
          )}
          <Field label="PO Expected Date" required={form.phase !== 'Lost'}>
            <input type="date" required={form.phase !== 'Lost'} className="input" value={form.po_expected_date} onChange={e => set('po_expected_date', e.target.value)} />
          </Field>
        </div>
      </section>

      {/* Section 5: Contacts */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="section-title" style={{ margin: 0 }}>Contacts (POC) *</p>
          <button type="button" className="btn btn-sm" onClick={addContact}>+ Add Contact</button>
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>At least one contact is required — Name and Email are mandatory.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {contacts.map((c, i) => (
            <div key={i} className="card-sm" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
              <Field label="Name" required><input required className="input" value={c.name} onChange={e => updateContact(i, 'name', e.target.value)} /></Field>
              <Field label="Phone"><input className="input" value={c.phone} onChange={e => updateContact(i, 'phone', e.target.value)} /></Field>
              <Field label="Email" required><input required type="email" className="input" value={c.email} onChange={e => updateContact(i, 'email', e.target.value)} /></Field>
              <Field label="Designation"><input className="input" value={c.designation} onChange={e => updateContact(i, 'designation', e.target.value)} /></Field>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => removeContact(i)}>✕</button>
            </div>
          ))}
          {contacts.length === 0 && <p style={{ fontSize: 12, color: '#dc2626' }}>At least one contact (POC) is required — click “+ Add Contact”.</p>}
        </div>
      </section>

      {/* Section 6: PO Document */}
      <section>
        <p className="section-title">PO Document{form.phase === 'PO Received' ? ' *' : ''}</p>
        {form.phase === 'PO Received' && !existingPoUrl && !poFile && (
          <p style={{ fontSize: 12, color: '#dc2626', margin: '0 0 8px' }}>A PO document is required once the phase is PO Received.</p>
        )}
        {existingPoUrl && !poFile && (
          <div className="badge badge-green" style={{ marginBottom: 8, padding: '6px 12px' }}>
            <a href={fileUrl(existingPoUrl)} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>📄 View uploaded document</a>
          </div>
        )}
        <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e => setPoFile(e.target.files[0] || null)} />
        {/* PO Number is asked for ONLY after a PO document is attached (identifier for the received PO). */}
        {form.phase === 'PO Received' && (poFile || existingPoUrl) && (
          <div style={{ marginTop: 12 }}>
            <Field label="PO Number" required>
              <input required className="input" value={form.po_number} onChange={e => set('po_number', e.target.value)} placeholder="Enter PO number (identifier)" />
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>A unique identifier for the received PO — required once the document is attached.</p>
            </Field>
          </div>
        )}
      </section>

      {/* Section 7: Notes */}
      <section>
        <p className="section-title">Additional Notes</p>
        <ReactQuill
          theme="snow"
          value={form.additional_notes}
          onChange={val => set('additional_notes', val)}
          modules={{ toolbar: NOTES_TOOLBAR }}
          style={{ background: '#fff' }}
        />
      </section>
      </>)}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : (lead ? 'Save Changes' : (poType === 'global' ? 'Create Global PO' : 'Create Lead'))}</button>
      </div>
      </fieldset>
    </form>
  );
}
