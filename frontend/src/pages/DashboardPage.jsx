import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { getLeads, getStageHistory, getSettings, setSetting, getBds } from '../services/api';
import { STAGE_ORDER, STAGE_WIN_PCT, PHASE_BADGE } from '../utils/constants';
import { fmtDate, isOverdue, daysBetween, calcLeadScore, dealSizeThresholds } from '../utils/leadHelpers';

function Kpi({ icon, label, value, sub, onClick }) {
  return (
    <div className={`kpi-card ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div style={{ fontSize: 20, marginBottom: 6 }}>{icon}</div>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 2px' }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [leads, setLeads] = useState([]);
  const [stageHistory, setStageHistory] = useState([]);
  const [bds, setBds] = useState([]);
  const [settings, setSettings] = useState({});
  const [filterBD, setFilterBD] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingTarget, setEditingTarget] = useState(null); // bd name or 'weekly'
  const [targetInput, setTargetInput] = useState('');

  useEffect(() => {
    Promise.all([getLeads(), getStageHistory(), getSettings(), getBds(user.business_unit)])
      .then(([ld, sh, st, bl]) => { setLeads(ld); setStageHistory(sh); setSettings(st); setBds(bl); })
      .finally(() => setLoading(false));
  }, [user.business_unit]);

  const weeklyTarget = parseFloat(settings.weekly_target_lakhs) || 5.3;
  const bdTargets = useMemo(() => { try { return JSON.parse(settings.bd_weekly_targets || '{}'); } catch { return {}; } }, [settings]);

  const filtered = useMemo(() => isAdmin && filterBD ? leads.filter(l => l.owner?.name === filterBD) : leads, [leads, isAdmin, filterBD]);

  const navigateWithFilter = (filter) => {
    const params = new URLSearchParams({ filter });
    if (isAdmin && filterBD) params.set('bd', filterBD);
    navigate(`/leads?${params}`);
  };
  const navigateWithPhase = (phase) => {
    const params = new URLSearchParams({ phase });
    if (isAdmin && filterBD) params.set('bd', filterBD);
    navigate(`/leads?${params}`);
  };
  const navigateWithConf = (conf) => {
    const params = new URLSearchParams({ conf });
    if (isAdmin && filterBD) params.set('bd', filterBD);
    navigate(`/leads?${params}`);
  };
  // Funnel band click → Leads filtered to every phase at or beyond the clicked stage (the leads
  // counted as having "reached" it), so the resulting list matches the count shown on the band.
  const navigateReached = (stage) => {
    const reached = STAGE_ORDER.slice(STAGE_ORDER.indexOf(stage));
    const params = new URLSearchParams({ phase: reached.join(',') });
    if (isAdmin && filterBD) params.set('bd', filterBD);
    navigate(`/leads?${params}`);
  };
  const navigateWithSource = (source) => {
    const params = new URLSearchParams({ source });
    if (isAdmin && filterBD) params.set('bd', filterBD);
    navigate(`/leads?${params}`);
  };

  const active = filtered.filter(l => !['Lost', 'On Hold', 'PO Received'].includes(l.phase));
  const won = filtered.filter(l => l.phase === 'PO Received');
  const hot = filtered.filter(l => l.lead_temperature === 'Hot' && !['Lost', 'PO Received'].includes(l.phase));
  const overdue = filtered.filter(isOverdue);
  const openTCV = active.reduce((s, l) => s + (parseFloat(l.potential_tcv_lakhs) || 0), 0);
  const wonTCV = won.reduce((s, l) => s + (parseFloat(l.po_actual_value_lakhs) || parseFloat(l.potential_tcv_lakhs) || 0), 0);

  // --- Pipeline Confidence (win-probability) over the ACTIVE pipeline. Uses the per-lead confidence
  // score + last-week baseline from the Lead Confidence Scoring engine. ---
  const confScored = active.filter(l => l.confidence_score !== null && l.confidence_score !== undefined);
  const confAvg = confScored.length ? Math.round(confScored.reduce((s, l) => s + Number(l.confidence_score), 0) / confScored.length) : null;
  const confWithPrev = confScored.filter(l => l.confidence_prev !== null && l.confidence_prev !== undefined);
  const confCur = confWithPrev.length ? confWithPrev.reduce((s, l) => s + Number(l.confidence_score), 0) / confWithPrev.length : null;
  const confPrevAvg = confWithPrev.length ? confWithPrev.reduce((s, l) => s + Number(l.confidence_prev), 0) / confWithPrev.length : null;
  const confTrend = (confCur === null || confPrevAvg === null) ? 'flat' : (confCur > confPrevAvg + 0.5 ? 'up' : confCur < confPrevAvg - 0.5 ? 'down' : 'flat');
  const confBandOf = (l) => { const c = Number(l.confidence_score); return c >= 60 ? 'high' : c >= 30 ? 'medium' : 'low'; };
  const confHigh = confScored.filter(l => confBandOf(l) === 'high').length;
  const confMedium = confScored.filter(l => confBandOf(l) === 'medium').length;
  const confLow = confScored.filter(l => confBandOf(l) === 'low').length;
  const confLosing = confScored
    .filter(l => l.confidence_prev != null && Number(l.confidence_score) < Number(l.confidence_prev) - 0.5)
    .map(l => ({ id: l.id, customer_name: l.customer_name, phase: l.phase, score: Number(l.confidence_score), drop: Number(l.confidence_prev) - Number(l.confidence_score) }))
    .sort((a, b) => b.drop - a.drop)
    .slice(0, 5);

  // Data quality — only mandatory fields (State/City are optional, so excluded)
  const missingTCV = filtered.filter(l => !l.potential_tcv_lakhs || parseFloat(l.potential_tcv_lakhs) === 0).length;
  const missingFollowup = filtered.filter(l => !l.next_followup_date && !['PO Received', 'Lost', 'On Hold'].includes(l.phase)).length;
  const missingQuantity = filtered.filter(l => !l.quantity || l.quantity === 0).length;
  const dataQualityIssues = [
    { label: 'Missing TCV', count: missingTCV, badge: 'badge-red' },
    { label: 'No Follow-Up Date', count: missingFollowup, badge: 'badge-amber' },
    { label: 'Missing Quantity', count: missingQuantity, badge: 'badge-amber' },
  ].filter(d => d.count > 0);
  const totalDataIssues = dataQualityIssues.reduce((s, d) => s + d.count, 0);

  // Weekly won — Monday-anchored week
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)); weekStart.setHours(0,0,0,0);
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23,59,59,999);
  const weeklyWon = filtered.filter(l => l.phase === 'PO Received').filter(l => {
    const d = new Date(l.po_received_date || l.phase_changed_at);
    return d >= weekStart && d <= weekEnd;
  }).reduce((s, l) => s + (parseFloat(l.po_actual_value_lakhs) || parseFloat(l.potential_tcv_lakhs) || 0), 0);
  const weeklyPct = Math.min(100, Math.round((weeklyWon / weeklyTarget) * 100));

  const phaseCounts = STAGE_ORDER.concat(['Lost', 'On Hold']).map(p => ({ phase: p, count: filtered.filter(l => l.phase === p).length }));
  const funnelData = STAGE_ORDER.map(p => ({ name: p, count: filtered.filter(l => l.phase === p).length }));

  const filteredLeadIds = new Set(filtered.map(l => l.id));
  const scopedHistory = stageHistory.filter(sh => filteredLeadIds.has(sh.lead_id));

  // Conversion funnel — based on each lead's CURRENT phase, so it updates immediately as a stage
  // moves (no dependence on stage_history completeness, which was making it look stale). A lead
  // currently at stage N has reached every earlier stage, so each level counts leads at or beyond it.
  // Lost / On Hold aren't pipeline stages and are excluded. This yields a monotonically narrowing —
  // i.e. a true funnel — shape.
  const stageRank = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i]));
  // Funnel omits the Negotiation step by request. Counts still use each stage's TRUE rank, so a lead
  // sitting in Negotiation is correctly counted as having reached Proposal but not yet PO Expected.
  const funnelStages = STAGE_ORDER.filter(s => s !== 'Negotiation').map(stage => ({
    stage,
    count: filtered.filter(l => { const r = stageRank[l.phase]; return r !== undefined && r >= stageRank[stage]; }).length,
    winPct: STAGE_WIN_PCT[stage] || 0,
  }));
  const funnelWithConv = funnelStages.map((s, i) => ({
    ...s, conv: i === 0 || funnelStages[i-1].count === 0 ? null : Math.round((s.count / funnelStages[i-1].count) * 100),
  }));

  // Avg time-in-stage
  const byLead = {};
  for (const sh of scopedHistory) (byLead[sh.lead_id] ||= []).push(sh);
  const stageDurations = {};
  for (const list of Object.values(byLead)) {
    const sorted = [...list].sort((a,b) => new Date(a.changed_at) - new Date(b.changed_at));
    for (let i = 0; i < sorted.length - 1; i++) {
      const stage = sorted[i].to_stage;
      const days = daysBetween(sorted[i].changed_at, sorted[i+1].changed_at);
      if (days >= 0) (stageDurations[stage] ||= []).push(days);
    }
  }
  const avgTimeInStage = STAGE_ORDER.map(stage => {
    const arr = stageDurations[stage] || [];
    return { stage, avgDays: arr.length ? Math.round(arr.reduce((s,d)=>s+d,0)/arr.length) : null, samples: arr.length };
  });

  // Lead Source Effectiveness — which channels bring the best leads. Per source: volume, win rate
  // (won / closed), total pipeline TCV, and average lead score. Ranked by TCV so the most valuable
  // source is on top. Respects the active BD filter (via `filtered`).
  const scoreThresholds = useMemo(() => dealSizeThresholds(leads), [leads]);
  const sourceStats = useMemo(() => {
    const known = ['Channel Partner', 'KAM', 'Direct Sales'];
    const sources = Array.from(new Set([...known, ...filtered.map(l => l.lead_source).filter(Boolean)]));
    return sources.map(src => {
      const rows = filtered.filter(l => l.lead_source === src);
      const won = rows.filter(l => l.phase === 'PO Received').length;
      const lost = rows.filter(l => l.phase === 'Lost').length;
      const closed = won + lost;
      const tcv = rows.reduce((s, l) => s + (parseFloat(l.potential_tcv_lakhs) || 0), 0);
      const scores = rows.map(l => calcLeadScore(l, scoreThresholds)).filter(v => v !== null);
      const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      return { src, count: rows.length, won, winRate: closed ? Math.round((won / closed) * 100) : null, tcv, avgScore };
    }).filter(s => s.count > 0).sort((a, b) => b.tcv - a.tcv);
  }, [filtered, scoreThresholds]);

  // Ticker follows the same BD filter as the rest of the dashboard.
  const overdueForTicker = filtered.filter(isOverdue);
  // On Hold leads are surfaced on their own ticker for team-wide visibility (scoring spec Section 7.2).
  const onHoldForTicker = filtered.filter(l => l.phase === 'On Hold');

  // Annual BD performance — BDs see only their own; admin sees all BDs, or just the selected one.
  const currentYear = new Date().getFullYear();
  const bdsToShow = isAdmin ? (filterBD ? [filterBD] : bds.map(b => b.name)) : [user.name];
  // BD cards (weekly targets) follow the same selection.
  const bdCards = isAdmin && filterBD ? bds.filter(b => b.name === filterBD) : bds;
  const annualBDPerf = bdsToShow.map(name => {
    const bdLeads = leads.filter(l => l.owner?.name === name);
    const wonThisYear = bdLeads.filter(l => l.phase === 'PO Received' && new Date(l.po_received_date || l.phase_changed_at).getFullYear() === currentYear);
    const closedThisYear = bdLeads.filter(l => ['PO Received','Lost'].includes(l.phase) && new Date(l.po_received_date || l.phase_changed_at || l.createdAt).getFullYear() === currentYear);
    const wonTCVYear = wonThisYear.reduce((s,l) => s + (parseFloat(l.po_actual_value_lakhs) || parseFloat(l.potential_tcv_lakhs) || 0), 0);
    const convRate = closedThisYear.length ? Math.round((wonThisYear.length / closedThisYear.length) * 100) : 0;
    const activeNow = bdLeads.filter(l => !['Lost','On Hold','PO Received'].includes(l.phase));
    return { name, totalLeads: bdLeads.length, wonDeals: wonThisYear.length, wonTCV: wonTCVYear, convRate, activeLeads: activeNow.length };
  });

  // Renewal alerts
  const renewalAlerts = filtered.filter(l => l.new_or_renewal === 'Renewal' && l.po_received_date && l.contract_period_months).map(l => {
    const start = new Date(l.po_received_date);
    const expiry = new Date(start); expiry.setMonth(expiry.getMonth() + l.contract_period_months);
    return { ...l, daysToExpiry: daysBetween(new Date(), expiry) };
  }).filter(l => l.daysToExpiry >= 0 && l.daysToExpiry <= 90).sort((a,b) => a.daysToExpiry - b.daysToExpiry);

  const saveWeeklyTarget = async () => {
    const v = parseFloat(targetInput);
    if (isNaN(v) || v <= 0) return;
    await setSetting('weekly_target_lakhs', String(v));
    setSettings(s => ({ ...s, weekly_target_lakhs: String(v) }));
    setEditingTarget(null);
  };
  const saveBdTarget = async (bdName) => {
    const v = parseFloat(targetInput);
    if (isNaN(v) || v <= 0) return;
    const next = { ...bdTargets, [bdName]: v };
    await setSetting('bd_weekly_targets', JSON.stringify(next));
    setSettings(s => ({ ...s, bd_weekly_targets: JSON.stringify(next) }));
    setEditingTarget(null);
  };

  if (loading) return <Layout><div style={{ padding: 32, color: '#94a3b8' }}>Loading…</div></Layout>;

  return (
    <Layout>
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Dashboard</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>Pipeline overview & analytics</p>
        </div>
        {isAdmin && (
          <select className="input" style={{ width: 180 }} value={filterBD} onChange={e => setFilterBD(e.target.value)}>
            <option value="">All BDs</option>
            {bds.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
        )}
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {overdueForTicker.length > 0 && (() => {
          const text = overdueForTicker
            .map(l => `${l.customer_name} · ${l.owner?.name?.split(' ')[0]} · Due ${fmtDate(l.next_followup_date)}`)
            .join('     •     ');
          // Speed scales with content so the pace stays even regardless of how many items there are.
          const duration = Math.max(18, overdueForTicker.length * 6);
          return (
            <div style={{ background: '#dc2626', color: '#fff', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 700, flexShrink: 0 }}>⏰ OVERDUE</span>
              <div className="marquee" style={{ flex: 1 }}>
                <div className="marquee__track" style={{ animationDuration: `${duration}s` }}>
                  <span style={{ paddingRight: 48 }}>{text}</span>
                  <span style={{ paddingRight: 48 }} aria-hidden="true">{text}</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* On-Hold ticker — any On Hold lead is surfaced team-wide (Section 7.2 of the scoring spec). */}
        {onHoldForTicker.length > 0 && (() => {
          const text = onHoldForTicker
            .map(l => `${l.customer_name} · ${l.owner?.name?.split(' ')[0]}${l.hold_end_date ? ` · Resume ${fmtDate(l.hold_end_date)}` : ''}`)
            .join('     •     ');
          const duration = Math.max(18, onHoldForTicker.length * 6);
          return (
            <div style={{ background: '#0ea5e9', color: '#fff', borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 700, flexShrink: 0 }}>❄ ON HOLD</span>
              <div className="marquee" style={{ flex: 1 }}>
                <div className="marquee__track" style={{ animationDuration: `${duration}s` }}>
                  <span style={{ paddingRight: 48 }}>{text}</span>
                  <span style={{ paddingRight: 48 }} aria-hidden="true">{text}</span>
                </div>
              </div>
            </div>
          );
        })()}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Kpi icon="💰" label="Open Pipeline" value={`₹${openTCV.toFixed(1)}L`} sub={`${active.length} active`} onClick={() => navigateWithFilter('active')} />
          <Kpi icon="🏆" label="Won TCV" value={`₹${wonTCV.toFixed(1)}L`} sub={`${won.length} deals`} onClick={() => navigateWithFilter('won')} />
          <Kpi icon="🔥" label="Hot Leads" value={String(hot.length)} sub="Tap to view" onClick={() => navigateWithFilter('hot')} />
          <Kpi icon="⏰" label="Overdue Follow-Ups" value={String(overdue.length)} sub="Tap to view" onClick={() => navigateWithFilter('overdue')} />
        </div>

        {totalDataIssues > 0 && (
          <div className="card" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 16 }}>⚠️</span>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#92400e', margin: 0 }}>
                Data Quality — {totalDataIssues} incomplete field{totalDataIssues > 1 ? 's' : ''} across leads
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {dataQualityIssues.map(d => (
                <span key={d.label} className={`badge ${d.badge}`} style={{ padding: '6px 12px' }}>
                  {d.label}: <strong style={{ marginLeft: 4 }}>{d.count}</strong> lead{d.count > 1 ? 's' : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <p className="section-title">Leads by Phase</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {phaseCounts.map(pc => (
              <span key={pc.phase} className={`badge ${PHASE_BADGE[pc.phase]}`} style={{ cursor: 'pointer', padding: '6px 12px' }} onClick={() => navigateWithPhase(pc.phase)}>
                {pc.phase} <strong style={{ marginLeft: 6 }}>{pc.count}</strong>
              </span>
            ))}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <p className="section-title" style={{ margin: 0 }}>Weekly Pipeline Target</p>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>POs this week vs ₹{weeklyTarget}L target</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>₹{weeklyWon.toFixed(2)}L</p>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{weeklyPct}%</p>
            </div>
          </div>
          <div style={{ height: 8, background: '#f1f5f9', borderRadius: 99 }}>
            <div style={{ height: 8, width: `${weeklyPct}%`, background: weeklyPct >= 100 ? '#059669' : '#4f46e5', borderRadius: 99 }} />
          </div>
          {isAdmin && (
            editingTarget === 'weekly' ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <input className="input" style={{ width: 100 }} type="number" step="0.1" value={targetInput} onChange={e => setTargetInput(e.target.value)} />
                <button className="btn btn-sm btn-primary" onClick={saveWeeklyTarget}>Save</button>
                <button className="btn btn-sm" onClick={() => setEditingTarget(null)}>✕</button>
              </div>
            ) : <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => { setEditingTarget('weekly'); setTargetInput(String(weeklyTarget)); }}>Edit target</button>
          )}
          {isAdmin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
              {bdCards.map(b => {
                const target = bdTargets[b.name] ?? weeklyTarget;
                const bdWon = leads.filter(l => l.owner?.name === b.name && l.phase === 'PO Received').filter(l => {
                  const d = new Date(l.po_received_date || l.phase_changed_at); return d >= weekStart && d <= weekEnd;
                }).reduce((s,l) => s + (parseFloat(l.po_actual_value_lakhs) || parseFloat(l.potential_tcv_lakhs) || 0), 0);
                const pct = Math.min(100, Math.round((bdWon / target) * 100));
                return (
                  <div key={b.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ fontWeight: 700 }}>{b.name.split(' ')[0]}</span>
                      {editingTarget === b.name ? (
                        <span style={{ display: 'flex', gap: 4 }}>
                          <input className="input" style={{ width: 70 }} type="number" step="0.1" value={targetInput} onChange={e => setTargetInput(e.target.value)} />
                          <button className="btn btn-sm btn-primary" onClick={() => saveBdTarget(b.name)}>✓</button>
                        </span>
                      ) : (
                        <span style={{ color: '#64748b' }}>₹{bdWon.toFixed(1)}L / ₹{target}L <button className="btn btn-sm" style={{ marginLeft: 6, padding: '2px 6px' }} onClick={() => { setEditingTarget(b.name); setTargetInput(String(target)); }}>✏️</button></span>
                      )}
                    </div>
                    <div style={{ height: 6, background: '#f1f5f9', borderRadius: 99, marginTop: 4 }}>
                      <div style={{ height: 6, width: `${pct}%`, background: pct >= 100 ? '#059669' : '#818cf8', borderRadius: 99 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card">
            <p className="section-title">Pipeline by Phase</p>
            <ResponsiveContainer width="100%" height={330}>
              <BarChart data={funnelData} layout="vertical" margin={{ left: 0, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" radius={[0,6,6,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <p className="section-title">Conversion Funnel</p>
            {(() => {
              const hasData = (funnelWithConv[0]?.count || 0) > 0;
              if (!hasData) return <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No pipeline leads yet.</p>;
              // Segmented trapezoid funnel: dark navy → light blue ramp (6 bands, Negotiation removed),
              // with the stage-to-stage conversion % shown between bands. The lightest bands stay a
              // visible blue (not white) so they read on the white card, with dark text.
              const shades = ['#0d47a1', '#1565c0', '#1e88e5', '#42a5f5', '#7fb5ec', '#a9d0f5'];
              const n = funnelWithConv.length;
              // Gentle fixed taper (top 100% → base ~55%) so the shape always reads as a funnel AND
              // every label fits fully inside its trapezoid. Each band's bottom width equals the next
              // band's top width, so the segments line up into one continuous funnel silhouette.
              const widthAt = (i) => 1 - (i / n) * 0.45;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', padding: '4px 0' }}>
                  {funnelWithConv.map((f, i) => {
                    const wTop = widthAt(i);
                    const wBot = widthAt(i + 1);
                    const insetPct = Math.max(0, Math.min(45, (1 - wBot / wTop) / 2 * 100));
                    const darkText = i >= 4; // light blue bands need dark text for contrast
                    const nextConv = i < n - 1 ? funnelWithConv[i + 1].conv : null;
                    return (
                      <React.Fragment key={f.stage}>
                        <div
                          className="funnel-band"
                          onClick={() => navigateReached(f.stage)}
                          title={`View the ${f.count} lead${f.count === 1 ? '' : 's'} that reached ${f.stage}`}
                          style={{
                          width: `${Math.round(wTop * 100)}%`, margin: '0 auto', height: 44,
                          background: shades[i] || '#a9d0f5',
                          clipPath: `polygon(0 0, 100% 0, ${100 - insetPct}% 100%, ${insetPct}% 100%)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          color: darkText ? '#0d47a1' : '#fff', whiteSpace: 'nowrap', cursor: 'pointer', transition: 'width .3s ease',
                        }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{f.stage}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.9 }}>· {f.count} lead{f.count === 1 ? '' : 's'}</span>
                        </div>
                        {i < n - 1 && (
                          <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: '#94a3b8', padding: '2px 0' }}>
                            {nextConv === null ? '·' : `${nextConv}% conversion`}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <div className="card">
            <p className="section-title">Bottlenecks — Avg Days per Stage</p>
            {avgTimeInStage.every(s => s.avgDays === null) ? (
              <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>No completed stage transitions yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {avgTimeInStage.map(s => {
                  const maxAvg = Math.max(...avgTimeInStage.map(x => x.avgDays || 0), 1);
                  return (
                    <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                      <div style={{ width: 80, fontWeight: 600 }}>{s.stage}</div>
                      <div style={{ flex: 1, height: 16, background: '#f8fafc', borderRadius: 6 }}>
                        {s.avgDays !== null && <div style={{ height: '100%', width: `${Math.max(4, Math.round((s.avgDays/maxAvg)*100))}%`, background: s.avgDays > 21 ? '#f87171' : s.avgDays > 14 ? '#fbbf24' : '#34d399', borderRadius: 6 }} />}
                      </div>
                      <div style={{ width: 60, textAlign: 'right' }}>{s.avgDays === null ? '—' : `${s.avgDays}d (${s.samples})`}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <p className="section-title">Lead Source Effectiveness</p>
            {sourceStats.length === 0 ? (
              <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No leads to analyse yet.</p>
            ) : (
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Source</th>
                    <th style={{ textAlign: 'right' }}>Leads</th>
                    <th style={{ textAlign: 'right' }}>Win %</th>
                    <th style={{ textAlign: 'right' }}>TCV (₹L)</th>
                    <th style={{ textAlign: 'right' }}>Avg Score</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceStats.map(s => (
                    <tr key={s.src} onClick={() => navigateWithSource(s.src)} title={`View ${s.count} ${s.src} lead(s)`} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 600 }}>{s.src}</td>
                      <td style={{ textAlign: 'right' }}>{s.count}</td>
                      <td style={{ textAlign: 'right' }}>
                        {s.winRate === null
                          ? <span style={{ color: '#cbd5e1' }}>—</span>
                          : <span style={{ fontWeight: 700, color: s.winRate >= 50 ? '#059669' : s.winRate >= 25 ? '#b45309' : '#dc2626' }}>{s.winRate}%</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>₹{s.tcv.toFixed(1)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {s.avgScore === null
                          ? <span style={{ color: '#cbd5e1' }}>—</span>
                          : <span className={`badge ${s.avgScore >= 70 ? 'badge-green' : s.avgScore >= 40 ? 'badge-amber' : 'badge-gray'}`}>{s.avgScore}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <p className="section-title">Pipeline Confidence</p>
            {confScored.length === 0 ? (
              <p style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No active leads to score yet.</p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 34, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>{confAvg}%</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: confTrend === 'up' ? '#16a34a' : confTrend === 'down' ? '#dc2626' : '#94a3b8' }}>
                    {confTrend === 'up' ? '▲ up' : confTrend === 'down' ? '▼ down' : '● flat'} vs last week
                  </span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>avg win-confidence · {confScored.length} active</span>
                </div>
                {/* Band mix bar */}
                <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 10, background: '#f1f5f9' }}>
                  {confHigh > 0 && <div style={{ flex: confHigh, background: '#22c55e' }} />}
                  {confMedium > 0 && <div style={{ flex: confMedium, background: '#f59e0b' }} />}
                  {confLow > 0 && <div style={{ flex: confLow, background: '#cbd5e1' }} />}
                </div>
                {/* Clickable band tiles */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
                  {[['high', 'High ≥60', '#16a34a', confHigh], ['medium', 'Medium 30–59', '#b45309', confMedium], ['low', 'Low <30', '#64748b', confLow]].map(([key, label, color, count]) => (
                    <button key={key} onClick={() => navigateWithConf(key)} title={`View ${count} ${label} lead(s)`}
                      style={{ textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 10px', background: '#fff', cursor: 'pointer' }}>
                      <div style={{ fontSize: 20, fontWeight: 800, color }}>{count}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
                    </button>
                  ))}
                </div>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#334155', margin: '0 0 6px' }}>📉 Losing confidence this week</p>
                {confLosing.length === 0 ? (
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>No active leads dropped this week.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {confLosing.map(l => (
                      <div key={l.id} onClick={() => navigate('/leads')} title="Open Leads"
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.customer_name} <span style={{ color: '#94a3b8', fontWeight: 400 }}>· {l.phase}</span>
                        </span>
                        <span style={{ color: '#dc2626', fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{Math.round(l.score)}% ▼ −{Math.round(l.drop)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {renewalAlerts.length > 0 && (
            <div className="card">
              <p className="section-title">🔔 Renewal Alerts</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                {renewalAlerts.map(l => (
                  <div key={l.id} className="card-sm" style={{ display: 'flex', justifyContent: 'space-between', background: l.daysToExpiry <= 30 ? '#fef2f2' : '#fffbeb' }}>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, margin: 0 }}>{l.customer_name}</p>
                      <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>{l.owner?.name?.split(' ')[0]} · ₹{l.potential_tcv_lakhs}L</p>
                    </div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: l.daysToExpiry <= 30 ? '#dc2626' : '#92400e' }}>{l.daysToExpiry}d left</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <p className="section-title">🏅 Annual BD Performance — {currentYear}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {annualBDPerf.map(bd => (
              <div key={bd.name} className="card-sm">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <p style={{ fontWeight: 700, margin: 0, fontSize: 13 }}>{bd.name}</p>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{bd.totalLeads} total leads</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontWeight: 700, color: '#059669', margin: 0 }}>₹{bd.wonTCV.toFixed(1)}L won</p>
                    <p style={{ fontSize: 11, color: '#94a3b8', margin: 0 }}>{bd.wonDeals} deals</p>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 11 }}>
                  <div style={{ background: '#f8fafc', borderRadius: 8, padding: 6, textAlign: 'center' }}><div style={{ color: '#94a3b8' }}>Active</div><div style={{ fontWeight: 700 }}>{bd.activeLeads}</div></div>
                  <div style={{ background: '#ecfdf5', borderRadius: 8, padding: 6, textAlign: 'center' }}><div style={{ color: '#94a3b8' }}>Won {currentYear}</div><div style={{ fontWeight: 700 }}>{bd.wonDeals}</div></div>
                  <div style={{ background: '#eff6ff', borderRadius: 8, padding: 6, textAlign: 'center' }}><div style={{ color: '#94a3b8' }}>Conv. Rate</div><div style={{ fontWeight: 700 }}>{bd.convRate}%</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
