import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import LeadForm from '../components/LeadForm';
import CustomLeadForm from '../components/CustomLeadForm';
import ActivityLogView from '../components/ActivityLogView';
import MultiSelect from '../components/MultiSelect';
import KanbanView from '../components/KanbanView';
import GlobalPosView from '../components/GlobalPosView';
import BulkUploadModal from '../components/BulkUploadModal';
import { useAuth } from '../context/AuthContext';
import { getLeads, getLead, deleteLead, updateLead, getBds, bulkUpdateLeads, getStageHistory, getDropdowns, getBusinessUnitConfig } from '../services/api';
import { PHASE_BADGE } from '../utils/constants';
import { fmtDate, isTATBreached, isOverdue, getPOExpiryDays, hasConfidence, confidenceTrend, buildRotMetrics, getRotState, stripHtml, primaryContact, formatOtherContacts } from '../utils/leadHelpers';
import { sortWithWonLast } from '../utils/leadPriority';
import { exportRowsToPdf } from '../utils/pdfExport';
import { writeFormattedSheet } from '../utils/excelExport';

const PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];
const RATINGS = ['Hot', 'Warm', 'Cold'];
const SOURCES = ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate'];

// Confidence band of a lead (matches the Dashboard's Pipeline Confidence card).
const leadConfBand = (l) => {
  if (l.confidence_score === null || l.confidence_score === undefined) return null;
  const c = Number(l.confidence_score);
  return c >= 60 ? 'high' : c >= 30 ? 'medium' : 'low';
};

// Week-over-week confidence trend indicator shown beside the score.
function TrendArrow({ trend }) {
  if (trend === 'up')   return <span title="Up vs last week"   style={{ color: '#16a34a', fontSize: 12, fontWeight: 700 }}>▲</span>;
  if (trend === 'down') return <span title="Down vs last week" style={{ color: '#dc2626', fontSize: 12, fontWeight: 700 }}>▼</span>;
  if (trend === 'hold') return <span title="Frozen (On Hold)"  style={{ color: '#0ea5e9', fontSize: 12 }}>❄</span>;
  return <span title="No change vs last week" style={{ color: '#94a3b8', fontSize: 9 }}>●</span>;
}

export default function LeadsPage() {
  const { user, isAdmin, canEdit, canFull, canAct } = useAuth();
  // Custom (wizard-built) businesses render a schema-driven lead form from their template; the three
  // originals keep their hand-built LeadForm unchanged.
  const isCustomBusiness = !['signage', 'jhes', 'surveillance'].includes(user.business_unit);
  // Create and delete are Full-Access capabilities. Chains is module-level configuration, which
  // Edit deliberately excludes. Bulk update mutates records, so it needs Edit.
  // canAct is false for a Read-only Super Admin, who sees no action affordance on any platform.
  const leadsCanEdit = canAct && canEdit('leads');
  const leadsCanFull = canAct && canFull('leads');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [leads, setLeads] = useState([]);
  const [stageHistory, setStageHistory] = useState([]);
  const [bds, setBds] = useState([]);
  const [dropdowns, setDropdowns] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPhases, setFilterPhases] = useState([]);
  const [filterTemps, setFilterTemps] = useState([]);
  const [filterSources, setFilterSources] = useState([]);
  const [filterBDs, setFilterBDs] = useState([]);
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [filterConf, setFilterConf] = useState('');   // '' | 'high' | 'medium' | 'low' (from the Dashboard)
  const [view, setView] = useState('table');
  const [showForm, setShowForm] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [tab, setTab] = useState('form');
  const [deleteId, setDeleteId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkValue, setBulkValue] = useState('');
  const [cameFromDashboard, setCameFromDashboard] = useState(false);
  const [showChains, setShowChains] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [buConfig, setBuConfig] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [ld, sh] = await Promise.all([getLeads(), getStageHistory()]);
    setLeads(ld); setStageHistory(sh);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { getBds(user.business_unit).then(setBds); }, [user.business_unit]);
  useEffect(() => { getBusinessUnitConfig(user.business_unit).then(setBuConfig).catch(() => {}); }, [user.business_unit]);
  useEffect(() => { getDropdowns().then(setDropdowns).catch(() => {}); }, []);

  // Pre-filter from dashboard KPI/phase-chip clicks
  useEffect(() => {
    const f = searchParams.get('filter');
    const phase = searchParams.get('phase');
    const bd = searchParams.get('bd');
    const source = searchParams.get('source');
    const conf = searchParams.get('conf');
    if (!f && !phase && !bd && !source && !conf) return;
    setCameFromDashboard(true);
    if (f === 'hot') setFilterTemps(['Hot']);
    else if (f === 'won') setFilterPhases(['PO Received']);
    else if (f === 'overdue') setFilterOverdue(true);
    else if (f === 'active') setFilterPhases(['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected']);
    if (phase) setFilterPhases(phase.split(','));
    if (source) setFilterSources(source.split(','));
    if (bd && isAdmin) setFilterBDs([bd]);
    if (conf) setFilterConf(conf);
  }, [searchParams, isAdmin]);

  // Deep link from the Forecast dashboard (?lead=<id>&from=forecast): open that lead's detail
  // straight away, and offer a way back. The forecast's column selection is persisted client-side,
  // so returning there restores the view the user left.
  const deepLinkId = searchParams.get('lead');
  const cameFromForecast = searchParams.get('from') === 'forecast';
  const cameFromActivity = searchParams.get('from') === 'activity';
  const [deepLinkError, setDeepLinkError] = useState('');
  useEffect(() => {
    if (!deepLinkId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const full = await getLead(deepLinkId);
        if (cancelled) return;
        setTab('form'); setEditLead(full); setShowForm(true);
      } catch {
        // The forecast spans the whole business unit, but a Team Member may only read their own leads.
        if (!cancelled) setDeepLinkError('That lead could not be opened — it may belong to another team member.');
      }
    })();
    return () => { cancelled = true; };
  }, [deepLinkId]);

  const { lastEntry: rotLastEntry, teamAvg: rotTeamAvg } = useMemo(() => buildRotMetrics(stageHistory), [stageHistory]);

  // Ranked with the shared prioritization order (stage → confidence → chain → TCV), with
  // won leads pushed to the very end — see utils/leadPriority.js. Re-derived per render, so
  // the list always reflects current scores rather than the server's sr_no ordering.
  const filtered = useMemo(() => sortWithWonLast(leads.filter(l => {
    const s = search.toLowerCase();
    const matchSearch = !s || [l.customer_name, l.city, l.state, l.lead_source, l.competitor, l.device_sku]
      .some(f => f?.toLowerCase().includes(s));
    return matchSearch
      && (!filterPhases.length || filterPhases.includes(l.phase))
      && (!filterTemps.length || filterTemps.includes(l.lead_temperature))
      && (!filterSources.length || filterSources.includes(l.lead_source))
      && (!filterBDs.length || filterBDs.includes(l.owner?.name))
      && (!filterOverdue || isOverdue(l))
      && (!filterConf || leadConfBand(l) === filterConf);
  })), [leads, search, filterPhases, filterTemps, filterSources, filterBDs, filterOverdue, filterConf]);

  const openCount = filtered.filter(l => !['Lost', 'On Hold', 'PO Received'].includes(l.phase)).length;

  const openNew = () => { setEditLead(null); setTab('form'); setShowForm(true); };
  // Fetch the FULL lead (the list row from GET /leads omits contacts, stage history, etc.) so the
  // edit form shows the saved POC contacts instead of an empty section.
  const openEdit = async (l) => {
    setTab('form');
    const full = await getLead(l.id).catch(() => l);
    setEditLead(full);
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditLead(null); };
  const onSaved = () => { closeForm(); fetchAll(); };

  const handlePhaseChangeKanban = async (leadId, newPhase) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead || lead.phase === newPhase) return;
    await updateLead(leadId, {
      customer_name: lead.customer_name, owner_id: lead.owner_id, business_unit: lead.business_unit,
      lead_source: lead.lead_source, channel_partner_name: lead.channel_partner_name, kam_name: lead.kam_name,
      new_or_renewal: lead.new_or_renewal, lead_temperature: lead.lead_temperature, competitor: lead.competitor,
      potential_tcv_lakhs: lead.potential_tcv_lakhs, tcv_manual: lead.tcv_manual, contract_period_months: lead.contract_period_months,
      po_validity_months: lead.po_validity_months, phase: newPhase, phase_date: undefined,
      includes_platform: lead.includes_platform, platform_rate: lead.platform_rate, platform_qty: lead.platform_qty,
      includes_cms: lead.includes_cms, cms_rate: lead.cms_rate, cms_qty: lead.cms_qty,
      includes_connectivity: lead.includes_connectivity, connectivity_rate: lead.connectivity_rate, connectivity_qty: lead.connectivity_qty,
      includes_amc: lead.includes_amc, amc_rate: lead.amc_rate, amc_qty: lead.amc_qty,
      includes_display: lead.includes_display, display_rate: lead.display_rate, display_qty: lead.display_qty,
      includes_installation: lead.includes_installation, installation_rate: lead.installation_rate, installation_qty: lead.installation_qty,
      includes_device: lead.includes_device, device_sku: lead.device_sku, device_cost_type: lead.device_cost_type, device_rate: lead.device_rate,
      device_qty: lead.device_qty, device_requested_date: lead.device_requested_date,
      jhes_product: lead.jhes_product, additional_notes: lead.additional_notes,
    });
    fetchAll();
  };

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAll = () => setSelectedIds(new Set(filtered.map(l => l.id)));
  const clearSelect = () => setSelectedIds(new Set());

  const executeBulk = async () => {
    if (!bulkValue || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    if (bulkAction === 'reassign') await bulkUpdateLeads(ids, { owner_id: bulkValue });
    else if (bulkAction === 'phase') await bulkUpdateLeads(ids, { phase: bulkValue });
    setBulkAction(null); setBulkValue(''); clearSelect(); fetchAll();
  };

  const exportExcel = async () => {
    const toExport = selectedIds.size > 0 ? filtered.filter(l => selectedIds.has(l.id)) : filtered;
    const XLSX = await import('xlsx');

    // Which service columns belong in this sheet depends on the business unit(s) being exported.
    // Signage's per-service columns (Platform, CMS, AMC…) are meaningless on a JHES lead and
    // vice-versa, so a single-business export only carries that business's services. Surveillance
    // stores its services as a JSON list rather than per-service columns, so it gets one summary
    // column. Device (hardware) is common to every business, so it rides along whenever any lead
    // has one. A mixed super-admin export shows the union — still relevant to some row in the sheet.
    const busPresent = new Set(toExport.map(l => l.business_unit).filter(Boolean));
    const SERVICE_GROUPS = [
      { key: 'platform',     bu: 'signage', label: 'Platform' },
      { key: 'cms',          bu: 'signage', label: 'CMS' },
      { key: 'connectivity', bu: 'signage', label: 'Connectivity' },
      { key: 'amc',          bu: 'signage', label: 'AMC' },
      { key: 'display',      bu: 'signage', label: 'Display' },
      { key: 'installation', bu: 'signage', label: 'Installation' },
      { key: 'jhes',         bu: 'jhes',    label: 'JHES' },
      { key: 'iptv',         bu: 'jhes',    label: 'IPTV' },
    ];
    const activeServices = SERVICE_GROUPS.filter(g => busPresent.has(g.bu));
    const showDevice = toExport.some(l => l.includes_device);
    const showSurv = busPresent.has('surveillance');
    const showJhesProduct = busPresent.has('jhes');

    // Surveillance services (services_json: [{ label, nature, rate, qty }]) -> one readable cell.
    const survServices = (l) => {
      try {
        const arr = l.services_json ? JSON.parse(l.services_json) : [];
        return arr.filter(s => s && s.label).map(s => `${s.label} (₹${s.rate ?? 0} × ${s.qty ?? 0})`).join('; ');
      } catch { return ''; }
    };

    const rows = toExport.map(l => {
      const poc = primaryContact(l);
      const row = {
        'Sr No': l.sr_no, 'Business Unit': (l.business_unit || '').toUpperCase(), 'Customer': l.customer_name,
        'City': l.city || '', 'State': l.state || '', 'Lead Owner': l.owner?.name || '',
        // Contact / POC details (primary contact; any additional POCs listed in "Other Contacts").
        'Contact Name': poc.name, 'Contact Phone': poc.phone, 'Contact Email': poc.email, 'Contact Designation': poc.designation,
        'Other Contacts': formatOtherContacts(l),
        'Lead Source': l.lead_source, 'Channel Partner': l.channel_partner_name || '', 'KAM Name': l.kam_name || '', 'Affiliate Name': l.affiliate_name || '',
        'New/Renewal': l.new_or_renewal, 'Lead Rating': l.lead_temperature, 'Competitor': l.competitor || '',
        'Quantity (Total)': l.quantity, 'Potential TCV (L)': l.potential_tcv_lakhs, 'Contract Period (Mo)': l.contract_period_months,
        'PO Validity (Mo)': l.po_validity_months || '', 'ACV (L/yr)': l.acv_lakhs, 'Contract Value (L)': l.contract_value_lakhs || '',
        'Phase': l.phase, 'Confidence %': l.confidence_score ?? '', 'Next Follow-Up': l.next_followup_date || '', 'PO Expected Date': l.po_expected_date || '',
        'Service Start': l.service_start_date || '', 'Service End': l.service_end_date || '',
      };

      // Business-relevant per-service columns only.
      for (const g of activeServices) {
        row[g.label] = l[`includes_${g.key}`] ? 'Yes' : '';
        row[`${g.label} Rate (₹)`] = l[`${g.key}_rate`] || '';
        row[`${g.label} Qty`] = l[`${g.key}_qty`] || '';
      }
      if (showSurv) row['Surveillance Services'] = survServices(l);
      if (showDevice) {
        row['Device'] = l.includes_device ? 'Yes' : '';
        row['Device SKU'] = l.device_sku || '';
        row['Device Cost Type'] = l.device_cost_type ? l.device_cost_type.toUpperCase() : '';
        row['Device Rate (₹)'] = l.device_rate || '';
        row['Device Qty'] = l.device_qty || '';
        row['Device Requested Date'] = l.device_requested_date || '';
      }
      if (showJhesProduct) row['JHES Product'] = l.jhes_product || '';
      row['Actual PO Value (L)'] = l.po_actual_value_lakhs || '';
      row['Lost Reason'] = l.lost_reason || '';
      row['Additional Notes'] = stripHtml(l.additional_notes);
      row['Created At'] = l.createdAt ? fmtDate(l.createdAt) : '';
      return row;
    });
    writeFormattedSheet(XLSX, rows, 'Leads', `Sales_CRM_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // PDF export shows a curated, readable column set (not all 30+ Excel columns —
  // full detail belongs in Excel; PDF is for a quick printable summary).
  const exportPdf = () => {
    const toExport = selectedIds.size > 0 ? filtered.filter(l => selectedIds.has(l.id)) : filtered;
    if (!toExport.length) return;
    exportRowsToPdf({
      title: 'Sales CRM — Leads',
      subtitle: `${toExport.length} lead${toExport.length > 1 ? 's' : ''} · generated ${fmtDate(new Date())}`,
      tables: [{
        columns: ['Sr', 'Customer', 'BD', 'Phase', 'Rating', 'TCV (₹L)', 'Conf %', 'Source', 'Next Follow-Up'],
        rows: toExport.map(l => [
          l.sr_no, l.customer_name, l.owner?.name?.split(' ')[0] || '', l.phase, l.lead_temperature,
          l.potential_tcv_lakhs, hasConfidence(l) ? `${Math.round(Number(l.confidence_score))}%` : '—', l.lead_source,
          ['On Hold', 'Lost', 'PO Received'].includes(l.phase) ? '—' : (l.next_followup_date ? fmtDate(l.next_followup_date) : '—'),
        ]),
      }],
      filename: `Sales_CRM_${new Date().toISOString().slice(0, 10)}.pdf`,
    });
  };

  const bdNames = bds.map(b => b.name);
  // Filter options come from the per-business dropdowns, unioned with any values present in the data.
  const sourceOpts = [...new Set([...(dropdowns.lead_source || SOURCES), ...leads.map(l => l.lead_source).filter(Boolean)])];
  const ratingOpts = [...new Set([...(dropdowns.lead_temperature || RATINGS), ...leads.map(l => l.lead_temperature).filter(Boolean)])];

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {cameFromDashboard && <button className="btn btn-sm" onClick={() => navigate('/dashboard')}>← Dashboard</button>}
          {cameFromForecast && <button className="btn btn-sm" onClick={() => navigate('/forecast')}>← Inventory Pipeline</button>}
          {cameFromActivity && <button className="btn btn-sm" onClick={() => navigate('/activity')}>← Activity</button>}
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Leads</h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{openCount} active · {filtered.length} total</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {leadsCanFull && <button className="btn" onClick={() => setShowChains(true)}>🏢 Chains</button>}
          <button className="btn" onClick={exportExcel}>Export Excel</button>
          <button className="btn" onClick={exportPdf}>Export PDF</button>
          <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: view === 'table' ? '#eef2ff' : '#fff' }} onClick={() => setView('table')}>Table</button>
            <button className="btn btn-sm" style={{ border: 'none', borderRadius: 0, background: view === 'kanban' ? '#eef2ff' : '#fff' }} onClick={() => setView('kanban')}>Kanban</button>
          </div>
          {isAdmin && <button className="btn" onClick={() => setShowBulkUpload(true)}>⬆ Bulk Import</button>}
          {leadsCanFull && <button className="btn btn-primary" onClick={openNew}>+ New Lead</button>}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {deepLinkError && (
          <div style={{ marginBottom: 16, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: '10px 14px', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span>{deepLinkError}</span>
            <button className="btn btn-sm" onClick={() => setDeepLinkError('')}>Dismiss</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginRight: 2 }}>Filters</span>
          <input className="input" style={{ width: 240 }} placeholder="Search customer, city, competitor…" value={search} onChange={e => setSearch(e.target.value)} />
          <MultiSelect label="Phase" options={PHASES} selected={filterPhases} onChange={setFilterPhases} />
          <MultiSelect label="Rating" options={ratingOpts} selected={filterTemps} onChange={setFilterTemps} />
          <MultiSelect label="Source" options={sourceOpts} selected={filterSources} onChange={setFilterSources} />
          {isAdmin && <MultiSelect label="BD" options={bdNames} selected={filterBDs} onChange={setFilterBDs} />}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#334155' }}>
            <input type="checkbox" checked={filterOverdue} onChange={e => setFilterOverdue(e.target.checked)} /> Overdue only
          </label>
          {filterConf && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 999, padding: '4px 10px', color: '#3730a3' }}>
              Confidence: {filterConf === 'high' ? 'High ≥60' : filterConf === 'medium' ? 'Medium 30–59' : 'Low <30'}
              <button type="button" onClick={() => setFilterConf('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#4f46e5', fontWeight: 700, padding: 0 }}>✕</button>
            </span>
          )}
        </div>

        {isAdmin && selectedIds.size > 0 && (
          <div className="card-sm" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, background: '#eef2ff', borderColor: '#c7d2fe' }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>{selectedIds.size} selected</span>
            <button className="btn btn-sm" onClick={() => { setBulkAction('reassign'); setBulkValue(''); }}>Reassign</button>
            <button className="btn btn-sm" onClick={() => { setBulkAction('phase'); setBulkValue(''); }}>Change Phase</button>
            {bulkAction && (
              <>
                <select className="input" style={{ width: 160 }} value={bulkValue} onChange={e => setBulkValue(e.target.value)}>
                  <option value="">Select…</option>
                  {(bulkAction === 'reassign' ? bds.map(b => ({ id: b.id, label: b.name })) : PHASES.map(p => ({ id: p, label: p })))
                    .map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <button className="btn btn-sm btn-primary" onClick={executeBulk}>Apply</button>
              </>
            )}
            <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={clearSelect}>Clear</button>
          </div>
        )}

        {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : view === 'kanban' ? (
          <KanbanView leads={filtered} onOpen={openEdit} onPhaseChange={handlePhaseChangeKanban} />
        ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {isAdmin && <th></th>}
                  <th>Sr</th><th>Customer</th>{isAdmin && <th>BD</th>}<th>Phase</th><th>Location</th>
                  <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>TCV (₹L)</th><th>Scoring</th><th>Next Follow-Up</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(l => {
                  const tatBad = isTATBreached(l);
                  const overdue = isOverdue(l);
                  const poExpiry = getPOExpiryDays(l);
                  const showExpiry = poExpiry !== null && poExpiry <= 60;
                  const rot = getRotState(l, rotLastEntry, rotTeamAvg);
                  const isClosed = ['On Hold', 'Lost', 'PO Received'].includes(l.phase);
                  const isLost = l.phase === 'Lost';
                  const conf = hasConfidence(l) ? Number(l.confidence_score) : null;
                  return (
                    <tr key={l.id} onClick={() => openEdit(l)} style={{ background: isLost ? '#f1f5f9' : (tatBad ? '#fef2f2' : undefined), color: isLost ? '#94a3b8' : undefined, opacity: isLost ? 0.75 : 1 }}>
                      {isAdmin && <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleSelect(l.id)} /></td>}
                      <td style={{ color: '#94a3b8' }}>{l.sr_no}</td>
                      <td>
                        <p style={{ fontWeight: 700, margin: 0 }}>{l.customer_name}</p>
                        <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{l.new_or_renewal} · {l.lead_source}</p>
                        {showExpiry && (
                          <span className={`badge ${poExpiry < 30 ? 'badge-red' : 'badge-amber'}`} style={{ marginTop: 4, marginRight: 4 }}>
                            {poExpiry < 0 ? `⚠ PO expired ${Math.abs(poExpiry)}d ago` : `⏳ PO expires in ${poExpiry}d`}
                          </span>
                        )}
                        {rot && (
                          <span className={`badge ${rot.severity === 'red' ? 'badge-red' : 'badge-amber'}`} style={{ marginTop: 4 }}>
                            🥀 Stuck {rot.ageDays}d
                          </span>
                        )}
                      </td>
                      {isAdmin && <td>{l.owner?.name?.split(' ')[0]}</td>}
                      <td><span className={`badge ${PHASE_BADGE[l.phase]}`}>{l.phase}</span></td>
                      <td>{l.state || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={{ textAlign: 'right' }}>{l.quantity || <span style={{ color: '#cbd5e1' }}>—</span>}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{l.potential_tcv_lakhs}</td>
                      <td>
                        {conf === null ? <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>—</span> : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span className={`badge ${conf >= 60 ? 'badge-green' : conf >= 30 ? 'badge-amber' : 'badge-gray'}`} style={{ minWidth: 46, justifyContent: 'center' }} title="Win-confidence score">{Math.round(conf)}%</span>
                            <TrendArrow trend={confidenceTrend(l)} />
                          </span>
                        )}
                      </td>
                      <td>
                        {isClosed ? <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>—</span> :
                          l.next_followup_date ? <span style={{ color: overdue ? '#dc2626' : '#334155', fontWeight: overdue ? 700 : 400 }}>{overdue && '⚠ '}{fmtDate(l.next_followup_date)}</span> :
                          <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && <tr><td colSpan={isAdmin ? 10 : 8} style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>No leads match your filters.</td></tr>}
              </tbody>
            </table>
            {isAdmin && filtered.length > 0 && (
              <div style={{ padding: 10 }}>
                {leadsCanEdit && <button className="btn btn-sm" onClick={selectAll}>Select all ({filtered.length})</button>}
              </div>
            )}
          </div>
        )}
      </div>

      {showForm && (
        // Deliberately NO close-on-backdrop-click here: a stray click outside must not discard a
        // half-filled lead. Only the ✕ or Cancel button closes the form.
        <div className="modal-overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', gap: 4 }}>
                <span className={`tab ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>{editLead ? 'Edit Lead' : 'New Lead'}</span>
                {editLead && <span className={`tab ${tab === 'activity' ? 'active' : ''}`} onClick={() => setTab('activity')}>Activity</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {editLead && isAdmin && leadsCanFull && <button className="btn btn-sm btn-danger" onClick={() => setDeleteId(editLead.id)}>Delete</button>}
                <button className="btn btn-sm" onClick={closeForm}>✕</button>
              </div>
            </div>
            <div className="modal-body">
              {tab === 'form'
                ? (isCustomBusiness
                    ? <CustomLeadForm lead={editLead} onSave={onSaved} onCancel={closeForm} />
                    : <LeadForm lead={editLead} onSave={onSaved} onCancel={closeForm} />)
                : <ActivityLogView leadId={editLead.id} />}
            </div>
          </div>
        </div>
      )}

      {showChains && <GlobalPosView onClose={() => setShowChains(false)} />}

      {showBulkUpload && (
        <BulkUploadModal
          businessUnit={user.business_unit}
          config={buConfig}
          onClose={() => setShowBulkUpload(false)}
          onImported={fetchAll}
        />
      )}

      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="modal-body">
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Delete this lead?</p>
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>This permanently removes the lead, its contacts, and its activity history. This cannot be undone.</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setDeleteId(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={async () => { await deleteLead(deleteId); setDeleteId(null); closeForm(); fetchAll(); }}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
