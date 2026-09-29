import React, { useEffect, useRef, useState } from 'react';

export default function MultiSelect({ label, options, selected, onChange, width = 150 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = (val) => onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);

  return (
    <div ref={ref} style={{ position: 'relative', width }}>
      <button type="button" className="input" onClick={() => setOpen(o => !o)}
        style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
          borderColor: selected.length ? '#6366f1' : '#cbd5e1', background: selected.length ? '#eef2ff' : '#fff' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: selected.length ? '#4338ca' : '#334155' }}>
          {selected.length ? `${label} (${selected.length})` : label}
        </span>
        <span style={{ fontSize: 11, color: '#64748b' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff',
          border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.08)',
          zIndex: 20, minWidth: width, maxHeight: 220, overflowY: 'auto', padding: 6,
        }}>
          {options.map(opt => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 12, cursor: 'pointer', borderRadius: 6 }}>
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" className="btn btn-sm" style={{ width: '100%', marginTop: 4, justifyContent: 'center' }} onClick={() => onChange([])}>Clear</button>
          )}
        </div>
      )}
    </div>
  );
}
