import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import MultiSelect from '../components/MultiSelect';
import { useAuth } from '../context/AuthContext';
import { getLeads, getBds, getDropdowns } from '../services/api';
import { fmtDate, fmtMonthYear } from '../utils/leadHelpers';
import { exportRowsToPdf } from '../utils/pdfExport';
import { writeFormattedSheet } from '../utils/excelExport';

const PHASES = ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold'];
const SOURCES = ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate'];
const RENEWALS = ['New', 'Renewal', 'Expansion'];
const SERVICES = ['Platform', 'CMS', 'Connectivity', 'AMC', 'Display', 'Installation', 'Device'];
const SERVICE_KEY = { Platform: 'includes_platform', CMS: 'includes_cms', Connectivity: 'includes_connectivity', AMC: 'includes_amc', Display: 'includes_display', Installation: 'includes_installation', Device: 'includes_device' };

export default function ReportsPage() {
  const { user } = useAuth();
  const [allLeads, setAllLeads] = useState([]);
  const [bds, setBds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);
  const [view, setView] = useState('pipeline');   // 'pipeline' | 'customers'

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selBDs, setSelBDs] = useState([]);
  const [selPhases, setSelPhases] = useState([]);
  const [selSources, setSelSources] = useState([]);
  const [selRenewals, setSelRenewals] = useState([]);
  const [selServices, setSelServices] = useState([]);
  const [selStates, setSelStates] = useState([]);
  const [selPOMonths, setSelPOMonths] = useState([]);

  const [dropdowns, setDropdowns] = useState({});
  useEffect(() => { getBds(user.business_unit).then(setBds); }, [user.business_unit]);
  useEffect(() => { getDropdowns().then(setDropdowns).catch(() => {}); }, []);
  const sourceOpts  = [...new Set([...(dropdowns.lead_source || SOURCES), ...allLeads.map(l => l.lead_source).filter(Boolean)])];
  const renewalOpts = [...new Set([...(dropdowns.new_or_renewal || RENEWALS), ...allLeads.map(l => l.new_or_renewal).filter(Boolean)])];

  const availableStates = useMemo(() => [...new Set(allLeads.map(l => l.state).filter(Boolean))].sort(), [allLeads]);
  const poMonths = useMemo(() => {
    const now = new Date(); const set = new Set();
    for (let i = -12; i <= 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); set.add(fmtMonthYear(d)); }
    return [...set];
  }, []);

  const runReport = async () => {
    setLoading(true);
    const data = await getLeads({ business_unit: user.business_unit });
    setAllLeads(data);
    setLoading(false); setRan(true);
  };

  const filtered = useMemo(() => allLeads.filter(l => {
    if (dateFrom && new Date(l.createdAt) < new Date(dateFrom)) return false;
    if (dateTo && new Date(l.createdAt) > new Date(dateTo + 'T23:59:59')) return false;
    if (selBDs.length && !selBDs.includes(l.owner?.name)) return false;
    if (selPhases.length && !selPhases.includes(l.phase)) return false;
    if (selSources.length && !selSources.includes(l.lead_source)) return false;
    if (selRenewals.length && !selRenewals.includes(l.new_or_renewal)) return false;
    if (selStates.length && !selStates.includes(l.state)) return false;
    if (selServices.length && !selServices.every(s => l[SERVICE_KEY[s]])) return false;
    if (selPOMonths.length) {
      if (!l.po_expected_date || !selPOMonths.includes(fmtMonthYear(l.po_expected_date))) return false;
    }
    return true;
  }), [allLeads, dateFrom, dateTo, selBDs, selPhases, selSources, selRenewals, selStates, selServices, selPOMonths]);

  const totalTCV = filtered.reduce((s, l) => s + (parseFloat(l.potential_tcv_lakhs) || 0), 0);
  const wonLeads = filtered.filter(l => l.phase === 'PO Received');
  const wonTCV = wonLeads.reduce((s, l) => s + (parseFloat(l.po_actual_value_lakhs) || parseFloat(l.potential_tcv_lakhs) || 0), 0);

  const activeFilterCount = [selBDs, selPhases, selSources, selRenewals, selStates, selServices, selPOMonths].reduce((s,a) => s + a.length, 0) + (dateFrom?1:0) + (dateTo?1:0);
  const clearAll = () => { setDateFrom(''); setDateTo(''); setSelBDs([]); setSelPhases([]); setSelSources([]); setSelRenewals([]); setSelStates([]); setSelServices([]); setSelPOMonths([]); };

  // Primary (first) contact on a lead — used by the Customer Details view.
  const pc = (l) => (Array.isArray(l.contacts) && l.contacts[0]) || {};

  const exportExcel = async () => {
    if (!filtered.length) return;
    const XLSX = await import('xlsx');
    const rows = view === 'customers'
      ? filtered.map(l => ({
          Customer: l.customer_name, 'Business Unit': (l.business_unit || '').toUpperCase(),
          City: l.city || '', State: l.state || '', Owner: l.owner?.name || '',
          'Contact Name': pc(l).name || '', Phone: pc(l).phone || '', Email: pc(l).email || '', Designation: pc(l).designation || '',
        }))
      : filtered.map(l => ({
          'Sr No': l.sr_no, 'Business Unit': (l.business_unit || '').toUpperCase(), Customer: l.customer_name,
          State: l.state || '', BD: l.owner?.name || '', 'Lead Source': l.lead_source, 'KAM Name': l.kam_name || '',
          'New/Renewal': l.new_or_renewal, 'TCV (₹L)': l.potential_tcv_lakhs, 'PO Expected': l.po_expected_date ? fmtMonthYear(l.po_expected_date) : '',
          Phase: l.phase, 'Created At': fmtDate(l.createdAt),
        }));
    writeFormattedSheet(XLSX, rows, view === 'customers' ? 'Customers' : 'Report', `CRM_${view === 'customers' ? 'Customers' : 'Report'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const exportPdf = () => {
    if (!filtered.length) return;
    const table = view === 'customers'
      ? {
          columns: ['Customer', 'Business', 'City', 'State', 'Owner', 'Contact', 'Phone', 'Email', 'Designation'],
          rows: filtered.map(l => [l.customer_name, (l.business_unit || '').toUpperCase(), l.city || '—', l.state || '—', l.owner?.name || '', pc(l).name || '—', pc(l).phone || '—', pc(l).email || '—', pc(l).designation || '—']),
        }
      : {
          columns: ['Sr', 'Customer', 'State', 'BD', 'Phase', 'New/Renewal', 'TCV (₹L)', 'PO Expected', 'Source', 'Created'],
          rows: filtered.map(l => [l.sr_no, l.customer_name, l.state || '—', l.owner?.name?.split(' ')[0] || '', l.phase, l.new_or_renewal, l.potential_tcv_lakhs, l.po_expected_date ? fmtMonthYear(l.po_expected_date) : '—', l.lead_source, fmtDate(l.createdAt)]),
        };
    exportRowsToPdf({
      title: view === 'customers' ? 'Sales CRM — Customer Details' : 'Sales CRM — Custom Report',
      subtitle: `${filtered.length} record${filtered.length > 1 ? 's' : ''} · generated ${fmtDate(new Date())}`,
      tables: [table],
      filename: `CRM_${view === 'customers' ? 'Customers' : 'Report'}_${new Date().toISOString().slice(0,10)}.pdf`,
    });
  };

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Custom Reports</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{activeFilterCount > 0 ? `${activeFilterCount} filters active` : 'Filter leads and export to Excel'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={runReport} disabled={loading}>{loading ? 'Running…' : 'Run Report'}</button>
          {ran && filtered.length > 0 && <button className="btn btn-success" onClick={exportExcel}>Export Excel ({filtered.length})</button>}
          {ran && filtered.length > 0 && <button className="btn" onClick={exportPdf}>Export PDF</button>}
        </div>
      </div>

      <div style={{ display: 'flex' }}>
        <div style={{ width: 240, flexShrink: 0, background: '#fff', borderRight: '1px solid #e2e8f0', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="field-label" style={{ marginBottom: 6 }}>Report View</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[{ key: 'pipeline', label: 'Pipeline' }, { key: 'customers', label: 'Customer Details' }].map(v => (
                <button key={v.key} type="button" onClick={() => setView(v.key)}
                  style={{ border: view === v.key ? '1.5px solid #4f46e5' : '1.5px solid #e2e8f0', borderRadius: 8,
                    padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                    background: view === v.key ? '#eef2ff' : '#fff', color: view === v.key ? '#4f46e5' : '#64748b' }}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
            <label className="field-label">Date Range (Created)</label>
            <input type="date" className="input" style={{ marginBottom: 6 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <input type="date" className="input" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <MultiSelect label="BD" options={bds.map(b => b.name)} selected={selBDs} onChange={setSelBDs} width={200} />
          <MultiSelect label="Phase" options={PHASES} selected={selPhases} onChange={setSelPhases} width={200} />
          <MultiSelect label="Lead Source" options={sourceOpts} selected={selSources} onChange={setSelSources} width={200} />
          <MultiSelect label="New/Renewal" options={renewalOpts} selected={selRenewals} onChange={setSelRenewals} width={200} />
          <MultiSelect label="Services" options={SERVICES} selected={selServices} onChange={setSelServices} width={200} />
          {availableStates.length > 0 && <MultiSelect label="State" options={availableStates} selected={selStates} onChange={setSelStates} width={200} />}
          <MultiSelect label="PO Expected Month" options={poMonths} selected={selPOMonths} onChange={setSelPOMonths} width={200} />
          {activeFilterCount > 0 && <button className="btn btn-sm btn-danger" onClick={clearAll}>✕ Clear all</button>}
        </div>

        <div style={{ flex: 1, padding: 20 }}>
          {!ran ? (
            <p style={{ textAlign: 'center', color: '#94a3b8', padding: 60 }}>Set your filters and click Run Report.</p>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total Leads</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>{filtered.length}</p></div>
                <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Total TCV</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0' }}>₹{totalTCV.toFixed(1)}L</p></div>
                <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Won Leads</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>{wonLeads.length}</p></div>
                <div className="kpi-card"><p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Won TCV</p><p style={{ fontSize: 20, fontWeight: 700, margin: '4px 0 0', color: '#059669' }}>₹{wonTCV.toFixed(1)}L</p></div>
              </div>
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                {view === 'pipeline' ? (
                  <table className="data-table">
                    <thead><tr><th>Sr</th><th>Customer</th><th>State</th><th>BD</th><th>Phase</th><th>New/Renewal</th><th style={{textAlign:'right'}}>TCV (₹L)</th><th>PO Expected</th><th>Source</th><th>Created</th></tr></thead>
                    <tbody>
                      {filtered.map(l => (
                        <tr key={l.id}>
                          <td>{l.sr_no}</td><td>{l.customer_name}</td><td>{l.state || '—'}</td><td>{l.owner?.name?.split(' ')[0]}</td>
                          <td>{l.phase}</td><td>{l.new_or_renewal}</td><td style={{textAlign:'right', fontWeight:700}}>₹{l.potential_tcv_lakhs}</td>
                          <td>{l.po_expected_date ? fmtMonthYear(l.po_expected_date) : '—'}</td><td>{l.lead_source}</td><td>{fmtDate(l.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="data-table">
                    <thead><tr><th>Customer</th><th>Business</th><th>City</th><th>State</th><th>Owner</th><th>Contact</th><th>Phone</th><th>Email</th><th>Designation</th></tr></thead>
                    <tbody>
                      {filtered.map(l => (
                        <tr key={l.id}>
                          <td>{l.customer_name}</td><td>{(l.business_unit || '').toUpperCase()}</td><td>{l.city || '—'}</td><td>{l.state || '—'}</td>
                          <td>{l.owner?.name || '—'}</td><td>{pc(l).name || '—'}</td><td>{pc(l).phone || '—'}</td><td>{pc(l).email || '—'}</td><td>{pc(l).designation || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
