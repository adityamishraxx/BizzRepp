import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getBds, getDropdowns, getBusinessUnitConfig, createLead, updateLead, getGlobalPos, createGlobalPo } from '../services/api';
import { STAGE_ORDER, INDIAN_STATES, UNION_TERRITORIES } from '../utils/constants';
import { todayStr, addDaysStr } from '../utils/leadHelpers';

// Schema-driven lead form for CUSTOM (wizard-built) business units. It renders exactly the sections
// and fields configured for that business (business_units.config.formSchema): predefined ("core")
// fields map to their leads columns, custom fields save to leads.custom_fields (JSON), and the
// services chosen in the wizard render with rate/qty and auto-calc TCV (stored the JSON way). The
// three original businesses keep their own hand-built LeadForm instead of this.
const STATE_OPTIONS = [...INDIAN_STATES, ...UNION_TERRITORIES];
const SOURCE_KINDS = ['Channel Partner', 'KAM', 'Lead Affiliate'];
// Source kind -> { the lead column, the dropdown field it's stored under, the label }.
const SOURCE_META = {
  'Channel Partner': { field: 'channel_partner_name', dd: 'channel_partner', label: 'Channel Partner Name' },
  'KAM': { field: 'kam_name', dd: 'kam', label: 'KAM Name' },
  'Lead Affiliate': { field: 'affiliate_name', dd: 'lead_affiliate', label: 'Affiliate Name' },
};
// Fields rendered by dedicated controls (not the generic section loop): stage, PO type (shown as
// cards), PO document, and the three lead-source name fields (shown inline under Lead Source).
const SKIP = new Set(['phase', 'next_followup_date', 'po_expected_date', 'lost_reason', 'po_type', 'po_document_url', 'channel_partner_name', 'kam_name', 'affiliate_name']);
const LOST_REASONS = ['Pricing', 'Competition', 'No Budget', 'No Decision', 'Timing', 'Product Fit', 'Other'];
// Sections that come AFTER Phase & Timeline in the original form layout.
const AFTER_PHASE = new Set(['po', 'dates', 'other']);

export default function CustomLeadForm({ lead, onSave, onCancel }) {
  const { user } = useAuth();
  const [cfg, setCfg] = useState(null);
  const [bds, setBds] = useState([]);
  const [dropdowns, setDropdowns] = useState({});
  const [form, setForm] = useState({});       // core field slug -> value (also owner_id, phase, contract_period_months)
  const [custom, setCustom] = useState({});   // custom field slug -> value
  const [services, setServices] = useState([]); // [{ slug, label, nature, rate, qty, enabled }]
  const [poType, setPoType] = useState('individual');   // individual (a lead) | global (a chain record)
  const [linkToChain, setLinkToChain] = useState(false);
  const [chains, setChains] = useState([]);
  const [globalForm, setGlobalForm] = useState({ chain_name: '', device_total: '', price_lakhs: '', expected_start_date: '', expected_end_date: '' });
  const [contacts, setContacts] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getBusinessUnitConfig(user.business_unit), getBds(user.business_unit), getDropdowns(), getGlobalPos().catch(() => [])])
      .then(([config, bdList, dd, chainList]) => {
        setCfg(config);
        setBds(bdList || []);
        setDropdowns(dd || {});
        setChains(chainList || []);
        // Seed services from the business catalogue, merging any values already on the lead.
        const existingSvc = lead && lead.services_json ? safeParse(lead.services_json) : [];
        const byLabel = new Map(existingSvc.map(s => [s.label, s]));
        setServices((config.services || []).map(s => {
          const e = byLabel.get(s.label);
          return { slug: s.slug, label: s.label, nature: (e && e.nature) || s.nature, rate: e ? e.rate : '', qty: e ? e.qty : '', enabled: !!e };
        }));
        // Seed form + custom values from an existing lead (edit) or blanks (create).
        if (lead) {
          setForm({ owner_id: lead.owner_id || '', phase: lead.phase || 'New', contract_period_months: lead.contract_period_months || '', global_po_id: lead.global_po_id || '', next_followup_date: lead.next_followup_date || '', po_expected_date: lead.po_expected_date || '', lost_reason: lead.lost_reason || '', ...pickCore(lead, config) });
          setCustom(lead.custom_fields || {});
          setContacts((lead.contacts || []).map(c => ({ name: c.name, phone: c.phone || '', email: c.email || '', designation: c.designation || '' })));
          if (lead.global_po_id) setLinkToChain(true);
        } else {
          setForm({ owner_id: '', phase: 'New', contract_period_months: '', next_followup_date: '', po_expected_date: '', lost_reason: '' });
          setCustom({});
          setContacts([{ name: '', phone: '', email: '', designation: '' }]);
        }
      })
      .catch(e => setErr(e.response?.data?.message || 'Could not load this business template.'));
  }, [user.business_unit, lead]);

  const sections = useMemo(() => (cfg ? cfg.formSchema.sections.filter(s => s.enabled) : []), [cfg]);

  const setF = (slug, v) => setForm(f => ({ ...f, [slug]: v }));
  const setC = (slug, v) => setCustom(c => ({ ...c, [slug]: v }));
  const setSvc = (slug, patch) => setServices(ss => ss.map(s => s.slug === slug ? { ...s, ...patch } : s));
  const addContact = () => setContacts(c => [...c, { name: '', phone: '', email: '', designation: '' }]);
  const updateContact = (i, key, val) => setContacts(c => c.map((row, idx) => idx === i ? { ...row, [key]: val } : row));
  const removeContact = (i) => setContacts(c => c.filter((_, idx) => idx !== i));

  // Options for a select field: lead_source (and channel/kam) come from managed dropdowns; state from
  // the states list; everything else from the field's own options.
  const optionsFor = (f) => {
    if (f.slug === 'lead_source' || f.optionsFrom === 'dropdown:lead_source') {
      return [...new Set([...(dropdowns.lead_source || []), ...SOURCE_KINDS])];
    }
    if (f.slug === 'state') return STATE_OPTIONS;
    return Array.isArray(f.options) ? f.options : [];
  };
  const setGlobal = (k, v) => setGlobalForm(g => ({ ...g, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');

    // Global PO (chain) path: create a chain reference record, not a funnel lead.
    if (!lead && poType === 'global') {
      if (!globalForm.chain_name.trim()) { setErr('Chain Name is required.'); return; }
      setBusy(true);
      try {
        await createGlobalPo({
          chain_name: globalForm.chain_name.trim(),
          device_total: parseInt(globalForm.device_total, 10) || 0,
          price_lakhs: globalForm.price_lakhs ? parseFloat(globalForm.price_lakhs) : null,
          expected_start_date: globalForm.expected_start_date || null,
          expected_end_date: globalForm.expected_end_date || null,
        });
        onSave();
      } catch (e2) { setErr(e2.response?.data?.message || 'Could not create the chain.'); setBusy(false); }
      return;
    }

    // Mandatory validation across enabled fields.
    for (const sec of sections) {
      for (const f of sec.fields) {
        if (!f.enabled || !f.mandatory || SKIP.has(f.slug)) continue;
        const val = f.core ? form[f.slug] : custom[f.slug];
        if (val === undefined || val === null || String(val).trim() === '') {
          setErr(`${f.label} is required.`); return;
        }
      }
    }
    if (!form.owner_id) { setErr('Lead Owner is required.'); return; }
    if (!form.customer_name || !String(form.customer_name).trim()) { setErr('Customer / Account Name is required.'); return; }
    if (form.lead_source === 'Channel Partner' && !String(form.channel_partner_name || '').trim()) { setErr('Channel Partner Name is required.'); return; }
    if (form.lead_source === 'KAM' && !String(form.kam_name || '').trim()) { setErr('KAM Name is required.'); return; }
    if (form.lead_source === 'Lead Affiliate' && !String(form.affiliate_name || '').trim()) { setErr('Affiliate Name is required.'); return; }
    if (contacts.length === 0 || contacts.some(c => !c.name.trim() || !c.email.trim())) {
      setErr('At least one contact (POC) with Name and Email is required.'); return;
    }

    // Services → the JSON line-item shape the backend expects (surveillance_services).
    const chosen = services.filter(s => s.enabled).map(s => ({
      label: s.label, nature: s.nature, rate: parseFloat(s.rate) || 0, qty: parseInt(s.qty, 10) || 0,
    }));
    const hasServiceValues = chosen.some(s => s.rate > 0 && s.qty > 0);
    const manualTcv = !hasServiceValues && form.potential_tcv_lakhs;

    const body = {
      ...form,
      business_unit: user.business_unit,
      global_po_id: linkToChain ? (form.global_po_id || null) : null,
      surveillance_services: chosen,        // custom BUs use the JSON services path server-side
      custom_fields: custom,
      contacts,
      tcv_manual: !!manualTcv,
      potential_tcv_lakhs: manualTcv ? form.potential_tcv_lakhs : undefined,
    };

    setBusy(true);
    try {
      if (lead) await updateLead(lead.id, body);
      else await createLead(body);
      onSave();
    } catch (e2) {
      setErr(e2.response?.data?.message || 'Could not save the lead.');
      setBusy(false);
    }
  };

  if (err && !cfg) return <div style={{ padding: 16, color: '#b91c1c', fontSize: 13 }}>{err}</div>;
  if (!cfg) return <div style={{ padding: 24, color: '#64748b' }}>Loading {user.business_unit} template…</div>;

  // The PO section / po_type field must be enabled in this business's template for the PO-type cards
  // and chain mapping to appear. Disabling PO Type in Edit Template hides them here.
  const poSection = sections.find(s => s.key === 'po');
  const poTypeField = poSection && poSection.fields.find(f => f.slug === 'po_type');
  const poEnabled = !!(poSection && poSection.enabled && poTypeField && poTypeField.enabled);

  // PO Type chooser (only when creating): an Individual PO is a funnel lead; a Global PO is a chain
  // reference record. Shown in both branches so the user can switch back.
  const poCards = poEnabled && !lead && (
    <div>
      <p className="section-title">PO TYPE</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button type="button" onClick={() => setPoType('individual')} style={poCardStyle(poType === 'individual')}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Individual PO</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>A property-level deal — enters the funnel and is scored.</div>
        </button>
        <button type="button" onClick={() => setPoType('global')} style={poCardStyle(poType === 'global')}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Global PO (chain)</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>A chain/account reference record — not tracked in the funnel.</div>
        </button>
      </div>
    </div>
  );

  // Services Offered block (reused; injected before Commercials in the main form).
  const servicesBlock = services.length > 0 ? (
    <div key="__services__">
      <p className="section-title">SERVICES OFFERED</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {services.map(s => (
          <div key={s.slug} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 90px 70px 90px', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={s.enabled} onChange={e => setSvc(s.slug, { enabled: e.target.checked })} />
            <span style={{ fontSize: 13 }}>{s.label}</span>
            <select className="input" value={s.nature} disabled={!s.enabled} onChange={e => setSvc(s.slug, { nature: e.target.value })} style={{ padding: '6px 8px' }}>
              <option value="opex">OPEX</option><option value="capex">CAPEX</option>
            </select>
            <input className="input" type="number" placeholder="Qty" value={s.qty} disabled={!s.enabled} onChange={e => setSvc(s.slug, { qty: e.target.value })} style={{ padding: '6px 8px' }} />
            <input className="input" type="number" placeholder="Rate" value={s.rate} disabled={!s.enabled} onChange={e => setSvc(s.slug, { rate: e.target.value })} style={{ padding: '6px 8px' }} />
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0 0' }}>TCV is auto-calculated from the ticked services × contract period.</p>
    </div>
  ) : null;

  // Global PO branch — create a chain reference record instead of a lead.
  if (!lead && poType === 'global') {
    return (
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {poCards}
        <div>
          <p className="section-title">GLOBAL PO — CHAIN REFERENCE</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label className="field-label">Chain Name *</label><input className="input" value={globalForm.chain_name} onChange={e => setGlobal('chain_name', e.target.value)} placeholder="e.g. Sunrise Hotels" /></div>
            <div><label className="field-label">Number of Devices</label><input className="input" type="number" min="0" value={globalForm.device_total} onChange={e => setGlobal('device_total', e.target.value)} /></div>
            <div><label className="field-label">Price (₹ Lakhs)</label><input className="input" type="number" step="0.01" value={globalForm.price_lakhs} onChange={e => setGlobal('price_lakhs', e.target.value)} /></div>
            <div />
            <div><label className="field-label">Expected Start Date</label><input className="input" type="date" value={globalForm.expected_start_date} onChange={e => setGlobal('expected_start_date', e.target.value)} /></div>
            <div><label className="field-label">Expected End Date</label><input className="input" type="date" value={globalForm.expected_end_date} onChange={e => setGlobal('expected_end_date', e.target.value)} /></div>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>Saved for reference only — a Global PO does not enter the sales funnel and has no stage or confidence score.</p>
        </div>
        {err && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create Chain'}</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {poCards}

      {/* Chain mapping — only when the PO Type is enabled in this business's template. */}
      {poEnabled && (
      <div>
        <p className="section-title">CHAIN MAPPING</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: '#334155' }}>
          <input type="checkbox" checked={linkToChain} onChange={e => { setLinkToChain(e.target.checked); if (!e.target.checked) setF('global_po_id', ''); }} />
          This property belongs to a chain
        </label>
        {linkToChain ? (
          <div style={{ marginTop: 10 }}>
            <label className="field-label">Chain (Global PO)</label>
            <select className="input" value={form.global_po_id || ''} onChange={e => setF('global_po_id', e.target.value)}>
              <option value="">Select a chain…</option>
              {chains.map(c => <option key={c.id} value={c.id}>{c.chain_name}</option>)}
            </select>
            {chains.length === 0 && <p style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>No chains yet — create one via New Lead → PO Type → Global PO.</p>}
          </div>
        ) : <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Standalone property — no chain mapping.</p>}
      </div>
      )}

      {/* Structural: owner, always present at the top */}
      <div>
        <p className="section-title">LEAD OWNER</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="field-label">Lead Owner *</label>
            <select className="input" value={form.owner_id} onChange={e => setF('owner_id', e.target.value)}>
              <option value="">Select owner</option>
              {bds.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Configured sections BEFORE Phase & Timeline (Account, Source, Services, Commercials). */}
      {sections.filter(s => !AFTER_PHASE.has(s.key)).map(sec => {
        const fields = sec.fields.filter(f => f.enabled && !SKIP.has(f.slug));
        const sectionEl = fields.length === 0 ? null : (
          <div key={sec.key}>
            <p className="section-title">{sec.label.toUpperCase()}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {fields.flatMap(f => {
                const el = (
                  <FieldInput key={f.slug} field={f}
                    value={f.core ? (form[f.slug] ?? '') : (custom[f.slug] ?? '')}
                    onChange={(v) => (f.core ? setF(f.slug, v) : setC(f.slug, v))}
                    options={optionsFor(f)} />
                );
                if (f.slug === 'lead_source' && SOURCE_KINDS.includes(form.lead_source)) {
                  return [el, <SourceNameField key={`srcname-${form.lead_source}`} leadSource={form.lead_source} form={form} setF={setF} dropdowns={dropdowns} />];
                }
                return [el];
              })}
            </div>
          </div>
        );
        if (sec.key === 'commercials') {
          return <React.Fragment key={sec.key}>{servicesBlock}{sectionEl}</React.Fragment>;
        }
        return sectionEl;
      })}
      {!sections.some(s => s.key === 'commercials') && servicesBlock}

      {/* Phase & Timeline — between Commercials and Contacts, matching original LeadForm */}
      {(() => {
        const inactivePhase = ['PO Received', 'Lost'].includes(form.phase);
        return (
          <div>
            <p className="section-title">PHASE & TIMELINE</p>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '-6px 0 12px' }}>Confidence is calculated automatically from the phase and its SLA decay — it is not editable.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label className="field-label">Current Phase *</label>
                <select className="input" value={form.phase} onChange={e => setF('phase', e.target.value)}>
                  {STAGE_ORDER.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>
              {!inactivePhase && (
                <div>
                  <label className="field-label">Next Follow-Up Date</label>
                  <input type="date" className="input" value={form.next_followup_date} onChange={e => setF('next_followup_date', e.target.value)} />
                </div>
              )}
              {form.phase === 'Lost' && (
                <div>
                  <label className="field-label">Lost Reason *</label>
                  <select required className="input" value={form.lost_reason} onChange={e => setF('lost_reason', e.target.value)}>
                    <option value="">Select reason</option>
                    {LOST_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              )}
              {form.phase === 'On Hold' && (
                <div>
                  <label className="field-label">Resume / Hold-until Date</label>
                  <input type="date" className="input" value={form.hold_end_date || ''} onChange={e => setF('hold_end_date', e.target.value)} />
                  <p style={{ fontSize: 11, color: '#0ea5e9', marginTop: 4 }}>Confidence is frozen while On Hold.</p>
                </div>
              )}
              <div>
                <label className="field-label">PO Expected Date{form.phase !== 'Lost' ? ' *' : ''}</label>
                <input type="date" className="input" value={form.po_expected_date} onChange={e => setF('po_expected_date', e.target.value)} required={form.phase !== 'Lost'} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* Section: Contacts (POC) — between Phase & Timeline and PO/Dates/Other */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="section-title" style={{ margin: 0 }}>Contacts (POC) *</p>
          <button type="button" className="btn btn-sm" onClick={addContact}>+ Add Contact</button>
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>At least one contact is required — Name and Email are mandatory.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {contacts.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
              <div><label className="field-label">Name *</label><input required className="input" value={c.name} onChange={e => updateContact(i, 'name', e.target.value)} /></div>
              <div><label className="field-label">Phone</label><input className="input" value={c.phone} onChange={e => updateContact(i, 'phone', e.target.value)} /></div>
              <div><label className="field-label">Email *</label><input required type="email" className="input" value={c.email} onChange={e => updateContact(i, 'email', e.target.value)} /></div>
              <div><label className="field-label">Designation</label><input className="input" value={c.designation} onChange={e => updateContact(i, 'designation', e.target.value)} /></div>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => removeContact(i)} style={{ marginBottom: 2 }}>✕</button>
            </div>
          ))}
          {contacts.length === 0 && <p style={{ fontSize: 12, color: '#dc2626' }}>At least one contact (POC) is required — click "+ Add Contact".</p>}
        </div>
      </div>

      {/* Sections AFTER Phase & Timeline (PO, Dates, Other). */}
      {sections.filter(s => AFTER_PHASE.has(s.key)).map(sec => {
        const fields = sec.fields.filter(f => f.enabled && !SKIP.has(f.slug));
        if (fields.length === 0) return null;
        return (
          <div key={sec.key}>
            <p className="section-title">{sec.label.toUpperCase()}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {fields.map(f => (
                <FieldInput key={f.slug} field={f}
                  value={f.core ? (form[f.slug] ?? '') : (custom[f.slug] ?? '')}
                  onChange={(v) => (f.core ? setF(f.slug, v) : setC(f.slug, v))}
                  options={optionsFor(f)} />
              ))}
            </div>
          </div>
        );
      })}

      {err && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>{err}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : (lead ? 'Save changes' : 'Create Lead')}</button>
      </div>
    </form>
  );
}

// The name field shown inline under Lead Source. A dropdown of previously-saved names for this
// business (stored on save) plus "Other" to enter a new one.
function SourceNameField({ leadSource, form, setF, dropdowns }) {
  const meta = SOURCE_META[leadSource];
  const opts = (dropdowns && dropdowns[meta.dd]) || [];
  const val = form[meta.field] || '';
  const [other, setOther] = useState(!!val && !opts.includes(val));
  return (
    <div>
      <label className="field-label">{meta.label} *</label>
      <select className="input" value={other ? '__other__' : val}
        onChange={e => {
          if (e.target.value === '__other__') { setOther(true); setF(meta.field, ''); }
          else { setOther(false); setF(meta.field, e.target.value); }
        }}>
        <option value="">Select…</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
        <option value="__other__">Other (enter name)…</option>
      </select>
      {other && <input className="input" style={{ marginTop: 8 }} placeholder="Enter new name" value={val} onChange={e => setF(meta.field, e.target.value)} />}
    </div>
  );
}

function FieldInput({ field, value, onChange, options }) {
  const label = <label className="field-label">{field.label}{field.mandatory ? ' *' : ''}</label>;
  const common = { className: 'input', value: value ?? '', onChange: e => onChange(e.target.value) };
  let control;
  switch (field.type) {
    case 'textarea': control = <textarea {...common} rows={2} />; break;
    case 'number':   control = <input {...common} type="number" />; break;
    case 'decimal':  control = <input {...common} type="number" step="0.01" />; break;
    case 'date':     control = <input {...common} type="date" />; break;
    case 'checkbox': control = (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, height: 38 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> Yes
      </label>); break;
    case 'select': control = (
      <select {...common}>
        <option value="">Select…</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>); break;
    case 'multiselect': control = (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map(o => {
          const arr = Array.isArray(value) ? value : [];
          return (
            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5 }}>
              <input type="checkbox" checked={arr.includes(o)} onChange={e => onChange(e.target.checked ? [...arr, o] : arr.filter(x => x !== o))} /> {o}
            </label>
          );
        })}
      </div>); break;
    default:         control = <input {...common} type="text" />;
  }
  return <div>{label}{control}</div>;
}

// Copy the enabled core (column-backed) field values off an existing lead for editing.
function pickCore(lead, config) {
  const out = {};
  for (const sec of config.formSchema.sections) {
    for (const f of sec.fields) {
      if (f.core && lead[f.slug] !== undefined) out[f.slug] = lead[f.slug] ?? '';
    }
  }
  return out;
}
function safeParse(s) { try { return JSON.parse(s) || []; } catch { return []; } }
function poCardStyle(active) {
  return { textAlign: 'left', padding: 14, borderRadius: 12, cursor: 'pointer',
    border: active ? '2px solid #4f46e5' : '2px solid #e2e8f0', background: active ? '#eef2ff' : '#fff' };
}
