// Turno e paradas planejadas (almoço, ginástica laboral, troca de modelo) entrando no UPH real.

import { useEffect, useState } from 'react';
import { effectiveTakt } from '../engine/balance';
import { STOP_PRESETS, stopMinutes, type ShiftStop } from '../engine/types';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Kpi } from './Modal';
import { runScenario } from './scenarios';
import { fmt, pct } from './theme';

const hhmm = (min: number, startH: number) => {
  const t = Math.round(startH * 60 + min);
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export function Shifts() {
  const model = useStore((s) => s.model);
  const s = model.settings;
  const stops = s.stops ?? [];
  const shiftMin = s.duration / 60;
  const lost = stopMinutes(s);
  const takt = effectiveTakt(model);
  const target = takt > 0 ? (3600 / takt) * (1 - lost / (shiftMin || 1)) : 0;
  const [startH, setStartH] = useState(6);
  const set = (next: ShiftStop[]) => useStore.getState().updateSettings({ stops: next.length ? next : undefined });
  const upd = (i: number, p: Partial<ShiftStop>) => set(stops.map((x, j) => (j === i ? { ...x, ...p } : x)));

  // UPH sem paradas × com paradas (turno inteiro), recalculado ao mudar
  const [r, setR] = useState<{ gross?: number; net?: number; busy: boolean }>({ busy: false });
  useEffect(() => {
    setR((x) => ({ ...x, busy: true }));
    const t = setTimeout(() => {
      const gross = runScenario({ ...model, settings: { ...s, stops: undefined } }).uph;
      const net = stops.length ? runScenario(model).uph : gross;
      setR({ gross, net, busy: false });
    }, 300);
    return () => clearTimeout(t);
  }, [model, s, stops.length]);

  return (
    <>
      <HowTo
        title="Turno e paradas: o UPH que a linha entrega de verdade"
        why="Almoço, ginástica laboral e troca de modelo param a linha. A simulação para os postos nesses horários e o UPH real cai na proporção do tempo parado."
        steps={[
          'Ajuste a duração do turno no painel Modelo (Duração em horas).',
          'Clique em "Usar paradas padrão" ou em "+ parada" e preencha nome, início (minutos depois do começo do turno) e duração.',
          'Tipo Pausa: param só os postos com gente (máquina automática continua). Tipo Troca de modelo: a linha toda para.',
          'Veja abaixo o UPH sem paradas × com paradas. Os indicadores da tela principal e as réplicas já usam as paradas.',
        ]}
        tip="Para planejar a meta do turno, use o UPH com paradas × horas do turno. Para balancear postos, o takt continua sendo o do tempo disponível."
        open={stops.length === 0}
      />
      <div className="tiles section">
        <Kpi k="Turno" v={`${fmt(shiftMin / 60, 1)} h`} u={`${fmt(shiftMin, 0)} min`} />
        <Kpi k="Paradas" v={`${fmt(lost, 0)} min`} u={pct(lost / (shiftMin || 1))} />
        <Kpi k="Tempo disponível" v={`${fmt((shiftMin - lost) / 60, 2)} h`} u={`${fmt(shiftMin - lost, 0)} min`} />
        <Kpi k="UPH sem paradas" v={r.busy || r.gross === undefined ? '…' : fmt(r.gross, 1)} u="pç/h" />
        <Kpi k="UPH real (com paradas)" v={r.busy || r.net === undefined ? '…' : fmt(r.net, 1)} u={target ? `meta no turno ${fmt(target, 1)}` : 'pç/h'} tone={r.net !== undefined && target > 0 && r.net < target ? 'bad' : undefined} />
        <Kpi k="Peças no turno" v={r.net === undefined ? '…' : fmt((r.net * shiftMin) / 60, 0)} u={r.gross !== undefined ? `sem paradas ${fmt((r.gross * shiftMin) / 60, 0)}` : ''} />
      </div>

      <div className="shift-bar section" aria-label="Linha do tempo do turno">
        {stops.map((x, i) => (
          <span
            key={i}
            className={`shift-stop k-${x.kind}`}
            style={{ left: `${(Math.max(0, x.start) / shiftMin) * 100}%`, width: `${(Math.min(x.duration, shiftMin - x.start) / shiftMin) * 100}%` }}
            title={`${x.name}: ${hhmm(x.start, startH)}–${hhmm(x.start + x.duration, startH)}`}
          >
            {x.name}
          </span>
        ))}
        <small className="shift-a">{hhmm(0, startH)}</small>
        <small className="shift-b">{hhmm(shiftMin, startH)}</small>
      </div>

      <div className="row-btns section">
        <button className="btn" onClick={() => set([...stops, { name: `Parada ${stops.length + 1}`, start: Math.min(shiftMin - 10, 120), duration: 10, kind: 'break' }])}>+ parada</button>
        <button className="btn" onClick={() => set(STOP_PRESETS.map((x) => ({ ...x })))}>Usar paradas padrão</button>
        {stops.length > 0 && <button className="btn ghost" onClick={() => set([])}>Tirar todas</button>}
        <label className="field inline">
          <span>Turno começa às</span>
          <input type="number" min={0} max={23} value={startH} onChange={(e) => setStartH(Math.max(0, Math.min(23, Number(e.target.value))))} />
        </label>
      </div>
      {stops.length > 0 && (
        <table className="grid-table section">
          <thead>
            <tr>
              <th>Parada</th>
              <th>Tipo</th>
              <th>Início (min do turno)</th>
              <th>Duração (min)</th>
              <th>Horário</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stops.map((x, i) => (
              <tr key={i}>
                <td><input aria-label="Nome da parada" value={x.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
                <td>
                  <select aria-label="Tipo da parada" value={x.kind} onChange={(e) => upd(i, { kind: e.target.value as ShiftStop['kind'] })}>
                    <option value="break">Pausa (param as pessoas)</option>
                    <option value="changeover">Troca de modelo (para a linha)</option>
                  </select>
                </td>
                <td><input aria-label="Início em minutos" type="number" min={0} max={shiftMin} value={x.start} onChange={(e) => upd(i, { start: Math.max(0, Number(e.target.value)) })} /></td>
                <td><input aria-label="Duração em minutos" type="number" min={0} value={x.duration} onChange={(e) => upd(i, { duration: Math.max(0, Number(e.target.value)) })} /></td>
                <td className="muted">{hhmm(x.start, startH)}–{hhmm(x.start + x.duration, startH)}</td>
                <td><button className="btn icon" aria-label={`Apagar ${x.name}`} onClick={() => set(stops.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
