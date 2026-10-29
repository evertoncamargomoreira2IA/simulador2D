// Pop-up com todos os indicadores de um posto (breakdown por posto).

import { effLabel } from '../engine/types';
import { footprint } from '../engine/analytics';
import { nodeKpi } from '../engine/metrics';
import type { NodeState } from '../engine/types';
import { TYPE_LABEL } from '../engine/types';
import { useStore } from '../store';
import { Bars, Kpi, Modal } from './Modal';
import { fmt, fmtTime, pct, STATE_LABEL } from './theme';

const STATES: NodeState[] = ['working', 'starved', 'blocked', 'resource', 'down', 'setup', 'break', 'off'];

export function StationDetail() {
  const id = useStore((s) => s.detailId);
  const sim = useStore((s) => s.sim);
  const kpi = useStore((s) => s.kpi);
  const real = useStore((s) => s.real);
  useStore((s) => s.tick);
  if (!id) return null;
  const rt = sim.byId.get(id);
  if (!rt) return null;
  const d = rt.def;
  const k = nodeKpi(sim, rt);
  const elapsed = Math.max(1e-9, kpi.elapsed);
  const total = STATES.reduce((a, s) => a + k.states[s], 0) || 1;
  const fp = footprint(sim, kpi).nodes.find((n) => n.id === id);
  const rank = kpi.ranking.findIndex((r) => r.id === id);
  const cap = Math.max(1, d.capacity);
  const realCt = k.processed > 0 ? (elapsed * cap * k.utilization) / k.processed : 0;
  const takt = sim.model.settings.takt;
  const effCt = d.cycleTime / cap;
  const r = real[norm(d.name)];
  const close = () => useStore.getState().setDetail(null);
  return (
    <Modal title={d.name} sub={`${TYPE_LABEL[d.type]} · ${d.capacity} posto(s) · ${d.poolId ? 'operadores compartilhados' : `${d.operators} operador(es)`}${rank >= 0 ? ` · gargalo nº ${rank + 1}` : ''}`} onClose={close}>
      <div className="tiles">
        <Kpi k="Produzidas" v={String(k.processed)} u={`${fmt((k.processed * 3600) / elapsed, 1)} pç/h`} />
        <Kpi k="Tempo de ciclo" v={fmt(d.cycleTime, 1)} u={`s · real ${fmt(realCt, 1)}`} />
        <Kpi k="Tempo por peça" v={fmt(effCt, 1)} u={`s · takt ${fmt(takt, 1)}`} tone={effCt > takt ? 'bad' : undefined} />
        <Kpi k="Utilização" v={pct(k.utilization, 1)} />
        <Kpi k={effLabel(d)} v={pct(k.oee, 1)} u={`D ${pct(k.availability)} · P ${pct(k.performance)} · Q ${pct(k.quality)}`} />
        <Kpi k="WIP no posto" v={String(k.wip)} u={`fila méd. ${fmt(k.avgQueue, 0)} s`} />
        <Kpi k="Falhas" v={String(k.failures)} u={`MTTR ${fmt(d.mttr, 0)} s`} />
        <Kpi k="Reprovadas" v={String(rt.rejected)} />
        <Kpi k="Energia" v={fmt(fp?.kWh ?? 0, 2)} u={`kWh · ${fmt(k.processed ? ((fp?.kWh ?? 0) * 1000) / k.processed : 0, 0)} Wh/pç`} />
        <Kpi k="CO2e" v={fmt((fp?.co2 ?? 0) * 1000, 0)} u="g no período" />
        <Kpi k="Custo" v={`R$ ${fmt(fp?.cost ?? 0, 0)}`} u={k.processed ? `R$ ${fmt((fp?.cost ?? 0) / k.processed, 2)}/pç` : ''} />
        <Kpi k="Ativo" v={pct(kpi.ranking[rank]?.active ?? k.utilization)} u="do tempo" />
      </div>
      <p className="label section">Tempo em cada estado ({fmtTime(elapsed)})</p>
      <Bars
        rows={STATES.filter((s) => k.states[s] > 0).map((s) => ({ label: STATE_LABEL[s], value: k.states[s] / total, color: `var(--st-${s})` }))}
        format={(v) => pct(v, 1)}
        max={1}
      />
      {r && (
        <>
          <p className="label section">Real × simulado</p>
          <dl className="kv">
            <dt>Produzidas (real)</dt><dd>{r.produced ?? '–'} {r.produced !== undefined && k.processed ? `(${pct(r.produced / k.processed - 1, 1)})` : ''}</dd>
            <dt>Ciclo real (s)</dt><dd>{r.cycle !== undefined ? fmt(r.cycle, 1) : '–'}</dd>
            <dt>Estado (real)</dt><dd>{r.state ?? '–'}</dd>
          </dl>
        </>
      )}
      <div className="section row-btns">
        <button className="btn" onClick={() => { useStore.getState().select([id]); close(); }}>Editar parâmetros</button>
      </div>
    </Modal>
  );
}

export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
