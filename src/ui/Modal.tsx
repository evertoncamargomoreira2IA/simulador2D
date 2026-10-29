// Janela sobreposta (pop-up) usada pelos indicadores do posto e pelo painel de análises.

import { useEffect, type ReactNode } from 'react';

export function Modal({ title, sub, onClose, children, wide }: { title: string; sub?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <p className="sub">{sub}</p>}
          </div>
          <button className="btn icon" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export interface BarRow {
  label: string;
  value: number;
  color?: string;
  note?: string;
}

/** Barras horizontais simples (rótulo, barra proporcional ao maior valor, valor formatado). */
export function Bars({ rows, format, max }: { rows: BarRow[]; format: (v: number) => string; max?: number }) {
  const top = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div key={i} className="bar-row" title={r.note ?? `${r.label}: ${format(r.value)}`}>
          <span className="bl">{r.label}</span>
          <span className="bt"><span style={{ width: `${Math.max(0, Math.min(100, (r.value / top) * 100))}%`, background: r.color ?? 'var(--accent)' }} /></span>
          <b>{format(r.value)}</b>
        </div>
      ))}
    </div>
  );
}

export function Kpi({ k, v, u, tone }: { k: string; v: string; u?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`tile${tone === 'bad' ? ' alert' : ''}`}>
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {u && <small>{u}</small>}
      </div>
    </div>
  );
}
