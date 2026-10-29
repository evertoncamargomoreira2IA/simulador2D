// "Como usar" didático: botão que abre um cartão com para que serve, passo a passo e dica.

import { useState } from 'react';

export function HowTo({ title, why, steps, tip, open: start = false }: { title: string; why: string; steps: string[]; tip?: string; open?: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <div className={`howto${open ? ' open' : ''}`}>
      <button className="howto-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden>💡</span> Como usar {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="howto-card">
          <b>{title}</b>
          <p>{why}</p>
          <ol>
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {tip && (
            <p className="howto-tip">
              <span aria-hidden>👉</span> {tip}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
