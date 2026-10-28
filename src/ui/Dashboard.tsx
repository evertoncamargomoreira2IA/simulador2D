// Dashboard: indicadores da linha e gráficos (estados por posto, throughput e WIP no tempo).

import Chart from 'chart.js/auto';
import { useEffect, useRef, useState } from 'react';
import type { LineKpi } from '../engine/metrics';
import type { NodeState } from '../engine/types';
import { useStore } from '../store';
import { fmt, fmtTime, pct, STATE_LABEL, useCanvasColors } from './theme';
import { POOL_LABEL } from '../engine/types';

const STATES: NodeState[] = ['working', 'starved', 'blocked', 'resource', 'down', 'setup'];

export function Dashboard() {
  const kpi = useStore((s) => s.kpi);
  const sim = useStore((s) => s.sim);
  const takt = useStore((s) => s.model.settings.takt);
  const warmup = useStore((s) => s.model.settings.warmup);
  const [open, setOpen] = useState(true);
  const bottleneck = kpi.nodes.find((n) => n.id === kpi.bottleneckId);

  return (
    <section className={`dash${open ? '' : ' collapsed'}`} aria-label="Dashboard">
      <div style={{ display: 'grid', gap: 6, alignContent: 'start', minWidth: 0 }}>
        <div className="dash-head">
          <p className="label" style={{ margin: 0 }}>
            Indicadores da linha
            {sim.now < warmup && <span className="warm"> · aquecimento até {fmtTime(warmup).slice(0, 5)}</span>}
          </p>
          <button className="btn" onClick={() => setOpen(!open)} style={{ padding: '1px 8px' }}>
            {open ? 'Recolher' : 'Expandir'}
          </button>
        </div>
        {open && (
          <div className="tiles">
            <Tile k="Produção" v={String(kpi.completed)} u="peças" />
            <Tile k="Throughput" v={fmt(kpi.throughputPerHour, 0)} u="pç/h" />
            <Tile k="Cycle time real" v={fmt(kpi.cycleTime, 1)} u={`s · takt ${fmt(takt, 1)}`} alert={kpi.completed > 5 && kpi.cycleTime > takt * 1.05} />
            <Tile k="Lead time" v={kpi.leadTime ? fmtTime(kpi.leadTime) : '–'} hint="Tempo de uma máquina desde a entrada até o fim da linha, com filas, esperas e transporte." />
            <Tile k="Total cycle time" v={kpi.totalCycleTime ? fmtTime(kpi.totalCycleTime) : '–'} hint="Soma dos tempos de ciclo para montar uma máquina, incluindo as submontagens." />
            <Tile k="WIP" v={String(kpi.wip)} u={`méd ${fmt(kpi.avgWip, 0)}`} />
            <Tile k="OEE linha" v={pct(kpi.oee)} />
            <Tile k="Aderência takt" v={pct(kpi.taktCompliance)} />
            <Tile k="Utilização média" v={pct(kpi.capacityUtilization)} />
            <Tile k="Expedido" v={String(kpi.shippedLoads)} u={kpi.shipped > kpi.shippedLoads ? `cargas · ${kpi.shipped} pç` : 'pç'} hint="Cargas (pallets) que chegaram ao destino final." />
            <Tile k="FPY" v={pct(kpi.firstPassYield)} hint="Primeira passada: peças sem retrabalho." />
            <Tile k="Gargalo" v={bottleneck && kpi.completed > 0 ? bottleneck.name : '–'} alert={!!bottleneck && kpi.completed > 0} />
          </div>
        )}
      </div>
      {open && <StateChart kpi={kpi} />}
      {open && <TimeChart tick={sim.timeline.length} sim={sim} takt={takt} />}
      {open && <People kpi={kpi} />}
    </section>
  );
}

function Tile({ k, v, u, alert, hint }: { k: string; v: string; u?: string; alert?: boolean; hint?: string }) {
  return (
    <div className={`tile${alert ? ' alert' : ''}`} title={hint ?? `${k}: ${v} ${u ?? ''}`}>
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {u && <small>{u}</small>}
      </div>
    </div>
  );
}

function StateChart({ kpi }: { kpi: LineKpi }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const colors = useCanvasColors();
  const procs = kpi.nodes.filter((n) => n.type !== 'source' && n.type !== 'sink');

  useEffect(() => {
    chart.current = new Chart(ref.current!, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(Number(c.raw), 1)}%` } },
        },
        scales: {
          x: { stacked: true, ticks: { autoSkip: true, maxRotation: 0, font: { size: 10 } }, grid: { display: false } },
          y: { stacked: true, max: 100, ticks: { stepSize: 25, callback: (v) => `${v}%`, font: { size: 10 } } },
        },
      },
    });
    return () => chart.current?.destroy();
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.data.labels = procs.map((n) => n.name);
    c.data.datasets = STATES.map((s) => ({
      label: STATE_LABEL[s],
      data: procs.map((n) => {
        const tot = Object.values(n.states).reduce((a, b) => a + b, 0) || 1;
        return (n.states[s] / tot) * 100;
      }),
      backgroundColor: colors.state[s],
      borderWidth: 0,
      barPercentage: 0.95,
      categoryPercentage: 0.95,
    }));
    const sc = c.options.scales!;
    for (const ax of [sc.x!, sc.y!]) {
      ax.ticks!.color = colors.muted;
      if (ax.grid) ax.grid.color = colors.line;
    }
    c.update('none');
  });

  return (
    <div className="chart">
      <p className="label">Estados por posto (% do tempo)</p>
      <div className="box">
        <canvas ref={ref} role="img" aria-label="Gráfico de barras empilhadas com o percentual de tempo em cada estado por posto" />
      </div>
    </div>
  );
}

function TimeChart({ sim, takt }: { tick: number; sim: ReturnType<typeof useStore.getState>['sim']; takt: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const colors = useCanvasColors();

  useEffect(() => {
    chart.current = new Chart(ref.current!, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        animation: false,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } },
        scales: {
          x: { ticks: { maxTicksLimit: 6, font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, position: 'left', ticks: { font: { size: 10 } }, title: { display: true, text: 'pç/h', font: { size: 10 } } },
          y2: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { font: { size: 10 } }, title: { display: true, text: 'WIP', font: { size: 10 } } },
        },
      },
    });
    return () => chart.current?.destroy();
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const tl = sim.timeline;
    c.data.labels = tl.map((p) => fmtTime(p.t).slice(0, 5));
    c.data.datasets = [
      { label: 'Throughput (pç/h)', data: tl.map((p) => p.throughputPerHour), borderColor: colors.state.working, backgroundColor: colors.state.working + '22', fill: true, pointRadius: 0, borderWidth: 2, tension: 0.25, yAxisID: 'y' },
      { label: `Meta takt (${Math.round(3600 / (takt || 1))} pç/h)`, data: tl.map(() => (takt > 0 ? 3600 / takt : 0)), borderColor: colors.muted, borderDash: [4, 4], pointRadius: 0, borderWidth: 1, yAxisID: 'y' },
      { label: 'WIP', data: tl.map((p) => p.wip), borderColor: colors.transport, pointRadius: 0, borderWidth: 1.5, yAxisID: 'y2' },
    ];
    const sc = c.options.scales!;
    for (const ax of [sc.x!, sc.y!, sc.y2!]) {
      ax.ticks!.color = colors.muted;
      if (ax.grid) ax.grid.color = colors.line;
      const t = (ax as { title?: { color?: string } }).title;
      if (t) t.color = colors.muted;
    }
    c.options.plugins!.legend!.labels!.color = colors.muted;
    c.update('none');
  });

  return (
    <div className="chart">
      <p className="label">Throughput e WIP no tempo</p>
      <div className="box">
        <canvas ref={ref} role="img" aria-label="Gráfico de linhas com throughput por hora e WIP ao longo do turno" />
      </div>
    </div>
  );
}

/** Faixa ergonômica de ocupação de pessoas e veículos. */
function band(u: number): { label: string; color: string } {
  if (u > 0.85) return { label: 'Sobrecarga', color: 'var(--st-down)' };
  if (u >= 0.5) return { label: 'Equilibrado', color: 'var(--st-working)' };
  return { label: 'Ocioso', color: 'var(--st-starved)' };
}

function People({ kpi }: { kpi: LineKpi }) {
  const top = kpi.ranking.slice(0, 5);
  const max = top[0]?.active || 1;
  return (
    <div className="people">
      <p className="label">Pessoas e recursos</p>
      {kpi.pools.length === 0 && <p className="hint">Sem recursos compartilhados no modelo. Adicione operadores ou veículos no painel Modelo.</p>}
      {kpi.pools.map((p) => {
        const b = band(p.utilization);
        return (
          <div key={p.id} className="meter" title={`${p.name}: ${pct(p.utilization, 1)} ocupado · ${b.label} · ${fmt(p.distance / 1000, 2)} km · ${p.tasks} tarefas`}>
            <div className="meter-row">
              <i className={`kind ${p.kind}`} />
              <span className="name">{p.name}</span>
              <span className="muted">{p.count}× {POOL_LABEL[p.kind].toLowerCase()}</span>
              <b>{pct(p.utilization)}</b>
            </div>
            <div className="bar"><div style={{ width: `${Math.min(100, p.utilization * 100)}%`, background: b.color }} /></div>
            <div className="meter-sub">
              <span style={{ color: b.color }}>{b.label}</span>
              <span>{fmt(p.distance / Math.max(1, p.count), 0)} m/pessoa</span>
              {p.waiting > 0 && <span>{p.waiting} esperando</span>}
            </div>
          </div>
        );
      })}
      <p className="label" style={{ marginTop: 8 }}>Ranking de gargalos</p>
      <ol className="rank">
        {kpi.completed > 0 &&
          top.map((r, i) => (
            <li key={r.id}>
              <span className="name">{i + 1}. {r.name}</span>
              <span className="bar"><span style={{ width: `${(r.active / max) * 100}%`, background: i === 0 ? 'var(--st-down)' : 'var(--accent)' }} /></span>
              <b>{pct(r.active)}</b>
            </li>
          ))}
        {kpi.completed === 0 && <li className="hint">Rode a simulação para ver o ranking.</li>}
      </ol>
    </div>
  );
}
