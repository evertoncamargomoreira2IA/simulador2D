// Montar a linha a partir das leituras: mostra o que foi descoberto (postos, setas, gigas, tempos, mix)
// e abre como trabalho novo. A posição na planta, as pessoas e o abastecimento ficam para ajustar depois.

import { useMemo, useState } from 'react';
import { discoverLine } from '../engine/discover';
import type { RealEvent } from '../engine/timeStudy';
import { useStore } from '../store';
import { fmt, pct } from './theme';

export function DiscoverLine({ events, source }: { events: RealEvent[]; source: string }) {
  const [show, setShow] = useState(false);
  const d = useMemo(() => (show ? discoverLine(events, `Linha montada das leituras (${source || 'leituras'})`) : null), [show, events, source]);
  if (!events.length) return null;
  return (
    <div className="section discover">
      <div className="row-btns">
        <button className={`btn${show ? ' on' : ''}`} aria-expanded={show} onClick={() => setShow(!show)}>🧱 Montar linha a partir das leituras</button>
        <span className="muted">Segue cada número de série de posto em posto e cria os blocos, as setas, as gigas, os tempos e o mix.</span>
      </div>
      {show && !d && <p className="hint">Poucas leituras para montar a linha: preciso de pelo menos 3 números de série.</p>}
      {show && d && (
        <>
          <p className="hint">
            {d.serials} peças seguidas, {d.stations.length} postos, {d.flows.length} setas, ritmo medido de {fmt(d.uph, 1)} peças/h
            {d.products.length > 1 ? `, mix ${d.products.map((p) => `${p.name} ${fmt(p.share, 0)}%`).join(' · ')}` : ''}.
          </p>
          <table className="grid-table">
            <thead>
              <tr><th>Posto (na ordem)</th><th>Peças</th><th>Tempo médio (s)</th><th>Variação</th><th>Gigas</th><th>Espera antes (s)</th><th>Fila sugerida</th></tr>
            </thead>
            <tbody>
              {d.stations.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.pieces}</td>
                  <td>{fmt(s.mean, 1)}</td>
                  <td>{pct(s.cv, 1)}</td>
                  <td>{s.capacity}</td>
                  <td>{fmt(s.wait, 0)}</td>
                  <td>{s.queue}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Setas: {d.flows.map((f) => `${f.from} → ${f.to} (${f.count})`).join(' · ')}</p>
          {d.notes.map((n) => <p key={n} className="hint warn">⚠ {n}</p>)}
          <div className="row-btns section">
            <button
              className="btn primary"
              onClick={() => {
                const st = useStore.getState();
                st.setModel(d.model, `Linha montada a partir de ${d.serials} peças: ${d.stations.length} postos. Confira as gigas e arraste os blocos para a posição da planta.`);
                st.setAnalysis(null);
              }}
            >
              Abrir como trabalho novo
            </button>
            <span className="muted">O trabalho atual não é apagado: salve antes se precisar. Depois rode ▶ Start e compare o UPH com o ritmo medido.</span>
          </div>
        </>
      )}
    </div>
  );
}
