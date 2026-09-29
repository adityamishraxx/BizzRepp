import React, { useEffect, useState } from 'react';
import { getBusinessUnitConfig, getBuCatalog, updateBusinessUnit } from '../services/api';
import { SectionCard, SelectAllRow, ov } from './BuWizard';

// Edit an existing business unit's lead-intake TEMPLATE (its sectioned fields). Works for every
// business: the three originals get a template generated from their current fields (so they're
// editable too), and wizard-built units load their saved schema. Saving writes config.formSchema via
// PUT /business-units/:slug. Custom fields added here store their values in leads.custom_fields.
const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);

export default function BuTemplateEditor({ bu, onClose, onSaved }) {
  const [catalog, setCatalog] = useState(null);
  const [sections, setSections] = useState(null);
  const [services, setServices] = useState([]);   // [{ slug, label, nature, enabled, custom }]
  const [svcDraft, setSvcDraft] = useState({ label: '', nature: 'opex' });
  const [isOriginal, setIsOriginal] = useState(false);
  const [newSection, setNewSection] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([getBusinessUnitConfig(bu.slug), getBuCatalog()])
      .then(([cfg, cat]) => {
        setCatalog(cat);
        setIsOriginal(cfg.isOriginal);
        setSections((cfg.formSchema.sections || []).map(s => ({ ...s, collapsed: true, fields: s.fields.map(f => ({ ...f })) })));
        // Services: the union catalog with this unit's currently-enabled ones ticked, plus any of the
        // unit's custom services that aren't in the union.
        const current = new Map((cfg.services || []).map(s => [s.slug, s]));
        const union = (cat.services || []).map(s => ({ slug: s.slug, label: s.label, nature: current.get(s.slug)?.nature || s.nature, enabled: current.has(s.slug) }));
        for (const s of (cfg.services || [])) if (!union.some(u => u.slug === s.slug)) union.push({ slug: s.slug, label: s.label, nature: s.nature, enabled: true, custom: true });
        setServices(union);
      })
      .catch(e => setErr(e.response?.data?.message || 'Could not load the template.'));
  }, [bu.slug]);

  const toggleService = (slug) => setServices(ss => ss.map(s => s.slug === slug ? { ...s, enabled: !s.enabled } : s));
  const setServiceNature = (slug, nature) => setServices(ss => ss.map(s => s.slug === slug ? { ...s, nature } : s));
  const addCustomService = () => {
    const label = svcDraft.label.trim();
    if (!label) return;
    const slug = slugify(label);
    if (services.some(s => s.slug === slug)) { setSvcDraft({ label: '', nature: 'opex' }); return; }
    setServices(ss => [...ss, { slug, label, nature: svcDraft.nature, enabled: true, custom: true }]);
    setSvcDraft({ label: '', nature: 'opex' });
  };

  const patchSection = (key, fn) => setSections(secs => secs.map(s => s.key === key ? fn(s) : s));
  const toggleSection = (key) => patchSection(key, s => ({ ...s, enabled: !s.enabled }));
  const collapseSection = (key) => patchSection(key, s => ({ ...s, collapsed: !s.collapsed }));
  const setAllFields = (key, val) => patchSection(key, s => ({ ...s, fields: s.fields.map(f => ({ ...f, enabled: val })) }));
  const toggleField = (key, slug) => patchSection(key, s => ({ ...s, fields: s.fields.map(f => f.slug === slug ? { ...f, enabled: !f.enabled } : f) }));
  const toggleMandatory = (key, slug) => patchSection(key, s => ({ ...s, fields: s.fields.map(f => f.slug === slug ? { ...f, mandatory: !f.mandatory } : f) }));
  const removeField = (key, slug) => patchSection(key, s => ({ ...s, fields: s.fields.filter(f => !(f.slug === slug && f.custom)) }));
  const addCustomField = (key, draft) => {
    const label = draft.label.trim();
    if (!label) return false;
    const slug = slugify(label);
    if (sections.some(s => s.fields.some(f => f.slug === slug))) return false;
    const opts = (draft.type === 'select' || draft.type === 'multiselect') ? draft.options.split(',').map(o => o.trim()).filter(Boolean) : undefined;
    patchSection(key, s => ({ ...s, fields: [...s.fields, { slug, label, type: draft.type, options: opts, core: false, custom: true, enabled: true, mandatory: false }] }));
    return true;
  };
  const addCustomSection = () => {
    const label = newSection.trim();
    if (!label) return;
    const key = slugify(label) || `section_${sections.length + 1}`;
    if (sections.some(s => s.key === key)) { setNewSection(''); return; }
    setSections(secs => [...secs, { key, label, enabled: true, custom: true, collapsed: false, fields: [] }]);
    setNewSection('');
  };
  const removeSection = (key) => setSections(secs => secs.filter(s => !(s.key === key && s.custom)));

  const save = async () => {
    setBusy(true); setErr('');
    try {
      const formSchema = { sections: sections.map(sec => ({
        key: sec.key, label: sec.label, enabled: sec.enabled, custom: !!sec.custom,
        fields: sec.fields.map(f => ({ slug: f.slug, label: f.label, type: f.type, options: f.options || null, core: !!f.core, custom: !!f.custom, enabled: f.enabled, mandatory: f.mandatory })),
      })) };
      const svc = services.map(s => ({ slug: s.slug, label: s.label, nature: s.nature, enabled: s.enabled }));
      await updateBusinessUnit(bu.slug, { config: { formSchema, services: svc } });
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.message || 'Could not save the template.');
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={ov.backdrop}>
      <div onClick={e => e.stopPropagation()} style={{ ...ov.modal, maxWidth: 580 }}>
        <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Edit Lead Template — {bu.name}</h2>
            <button onClick={onClose} style={ov.x}>×</button>
          </div>
          <p style={{ fontSize: 12.5, color: '#64748b', margin: '6px 0 0' }}>
            Turn sections on/off, toggle fields, mark mandatory, and add custom fields/sections. Changes apply to this business's New Lead form.
            {isOriginal && ' This is an original business — its built-in fields stay; your edits (hidden fields, custom fields) layer on top.'}
          </p>
        </div>

        <div style={{ padding: 22, overflowY: 'auto', flex: 1 }}>
          {err && <div style={ov.error}>{err}</div>}
          {!sections && !err && <p style={{ fontSize: 13, color: '#64748b' }}>Loading template…</p>}
          {sections && catalog && sections.map(sec => (
            <SectionCard key={sec.key} sec={sec} catalog={catalog}
              onToggle={() => toggleSection(sec.key)} onCollapse={() => collapseSection(sec.key)}
              onToggleField={(slug) => toggleField(sec.key, slug)} onToggleMandatory={(slug) => toggleMandatory(sec.key, slug)}
              onRemoveField={(slug) => removeField(sec.key, slug)} onAddField={(draft) => addCustomField(sec.key, draft)}
              onSetAllFields={(val) => setAllFields(sec.key, val)} onRemoveSection={() => removeSection(sec.key)} />
          ))}
          {sections && (
            <div style={ov.addRow}>
              <input style={{ ...ov.input, margin: 0 }} value={newSection} onChange={e => setNewSection(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomSection(); } }} placeholder="Add a custom section…" />
              <button type="button" className="btn btn-sm" style={ov.ghost} onClick={addCustomSection}>+ Section</button>
            </div>
          )}

          {sections && (
            <div style={{ border: '1px solid #e5e9f0', borderRadius: 10, marginTop: 16 }}>
              <div style={{ padding: '9px 12px', background: '#f8fafc', borderRadius: '10px 10px 0 0', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                Services Offered <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>({services.filter(s => s.enabled).length} selected)</span>
              </div>
              <div style={{ padding: '8px 12px' }}>
                <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>Tick the services this business sells (with OPEX/CAPEX), or add your own. These appear on its New Lead form with rate/qty.</p>
                {services.map(s => (
                  <div key={s.slug} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '5px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}>
                      <input type="checkbox" checked={s.enabled} onChange={() => toggleService(s.slug)} />
                      <span style={{ fontSize: 13, color: s.enabled ? '#0f172a' : '#94a3b8' }}>{s.label}{s.custom && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, background: '#ecfdf5', color: '#047857', padding: '1px 6px', borderRadius: 999 }}>CUSTOM</span>}</span>
                    </label>
                    <select value={s.nature} disabled={!s.enabled} onChange={e => setServiceNature(s.slug, e.target.value)} style={{ ...ov.input, margin: 0, width: 100, padding: '5px 8px' }}>
                      <option value="opex">OPEX</option><option value="capex">CAPEX</option>
                    </select>
                  </div>
                ))}
                <div style={ov.addRow}>
                  <input style={{ ...ov.input, margin: 0, flex: 1 }} value={svcDraft.label} onChange={e => setSvcDraft(d => ({ ...d, label: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomService(); } }} placeholder="Add a custom service…" />
                  <select style={{ ...ov.input, margin: 0, width: 100 }} value={svcDraft.nature} onChange={e => setSvcDraft(d => ({ ...d, nature: e.target.value }))}>
                    <option value="opex">OPEX</option><option value="capex">CAPEX</option>
                  </select>
                  <button type="button" className="btn btn-sm" style={ov.ghost} onClick={addCustomService}>+ Add</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 22px', borderTop: '1px solid #f1f5f9' }}>
          <button className="btn" style={ov.ghost} onClick={onClose}>Cancel</button>
          <button className="btn" style={ov.primary} disabled={busy || !sections} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>
    </div>
  );
}
