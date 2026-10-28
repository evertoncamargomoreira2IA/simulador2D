// Throughput por intervalo (15, 30 ou 60 min): total da linha no tempo e média por posto.

import Chart from 'chart.js/auto';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Simulator } from '../engine/simulator';
import { chartSequence } from '../engine/types';
import { useStore } from '../store';
import { Kpi } from './Modal';
import { fmt, fmtTime, useCanvasColors } from './theme';

export interface IntervalSeries {
  /** Fim de cada intervalo, em segundos do relógio da simulação. */
  ends: number[];
  /** Peças que saíram da linha em cada intervalo. */
  line: number[];
  /** Por nó (ordem de model.nodes): peças/cargas terminadas em cada intervalo. */
  nodes: number[][];
}

/** Recorta a linha do tempo em intervalos fechados de `step` segundos, a partir do início das estatísticas. */
export function intervals(sim: Simulator, step: number): IntervalSeries {
  const pts = sim.timeline.filter((p) => p.t >= sim.statsStart);
  const n = sim.model.nodes.length;
  const out: IntervalSeries = { ends: [], line: [], nodes: Array.from({ length: n }, () => []) };
  let prevC = 0;
  let prevP = new Array<number>(n).fill(0);
  for (let end = sim.statsStart + step; end <= sim.now + 1e-6; end += step) {
    // último ponto amostrado até o fim do intervalo
    let p = undefined as (typeof pts)[number] | undefined;
    for (const q of pts) {
      if (q.t <= end + 1e-6) p = q;
      else break;
    }
    if (!p) continue;
    const proc = p.processed ?? prevP;
    out.ends.push(end - sim.t0);
    out.line.push(p.completed - prevC);
    proc.forEach((v, i) => out.nodes[i].push(v - (prevP[i] ?? 0)));
    prevC = p.completed;
    prevP = proc;
  }
  return out;
}

const STEPS = [
  [900, '15 min'],
  [1800, '30 min'],
  [3600, '1 h'],
] as const;

export function ThroughputTab() {
  const sim = useStore((s) => s.sim);
  const model = useStore((s) => s.model);
  const kpi = useStore((s) => s.kpi);
  const tick = useStore((s) => s.tick);
  const colors = useCanvasColors();
  const [step, setStep] = useState(1800);
  const [sorted, setSorted] = useState(false);
  const label = STEPS.find((s) => s[0] === step)![1];
  const series = useMemo(() => intervals(sim, step), [sim, step, tick]);
  const elapsed = Math.max(1, kpi.elapsed);
  const stations = useMemo(() => {
    const r = chartSequence(
      model,
      sim.model.nodes
        .map((n) => ({ n, k: kpi.nodes.find((x) => x.id === n.id) }))
        .filter((x) => x.n.type !== 'source' && x.k)
        .map(({ n, k }) => ({ id: n.id, name: n.name, per: (k!.processed * step) / elapsed, batch: (n.batchSize ?? 0) > 1 })),
    );
    return sorted ? [...r].sort((a, b) => b.per - a.per) : r;
  }, [sim, kpi, step, sorted, elapsed, model]);
  const lineAvg = series.line.length ? series.line.reduce((a, b) => a + b, 0) / series.line.length : (kpi.completed * step) / elapsed;
  const target = sim.model.settings.takt > 0 ? step / sim.model.settings.takt : 0;
  const worst = series.line.length ? Math.min(...series.line) : 0;
  const best = series.line.length ? Math.max(...series.line) : 0;

  const timeRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const tc = useRef<Chart | null>(null);
  const bc = useRef<Chart | null>(null);
  useEffect(() => {
    tc.current = new Chart(timeRef.current!, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: { beginAtZero: true, ticks: { font: { size: 10 } } } },
      },
    });
    bc.current = new Chart(barRef.current!, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        indexAxis: 'y',
        animation: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmt(Number(c.raw), 1)} por ${label}` } } },
        scales: { x: { beginAtZero: true, ticks: { font: { size: 10 } } }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 10 } } } },
      },
    });
    return () => {
      tc.current?.destroy();
      bc.current?.destroy();
    };
  }, []);

  useEffect(() => {
    const t = tc.current;
    const b = bc.current;
    if (!t || !b) return;
    t.data.labels = series.ends.map((e) => fmtTime(e).slice(0, 5));
    t.data.datasets = [
      { type: 'bar', label: `Peças da linha por ${label}`, data: series.line, backgroundColor: series.line.map((v) => (target && v < target * 0.95 ? colors.state.blocked : colors.state.working)), borderWidth: 0, order: 1 },
      { type: 'line', label: `Meta pelo takt (${fmt(target, 1)})`, data: series.line.map(() => target), borderColor: colors.ink, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, order: 0 },
    ];
    b.data.labels = stations.map((s) => (s.batch ? `${s.name} (cargas)` : s.name));
    b.data.datasets = [{ data: stations.map((s) => s.per), backgroundColor: colors.accent, borderWidth: 0, barPercentage: 0.8 }];
    (b.options.plugins!.tooltip!.callbacks as { label: (c: { raw: unknown }) => string }).label = (c) => `${fmt(Number(c.raw), 1)} por ${label}`;
    for (const ch of [t, b]) {
      const sc = ch.options.scales!;
      for (const ax of [sc.x!, sc.y!]) {
        ax.ticks!.color = colors.muted;
        if (ax.grid) ax.grid.color = colors.line;
      }
    }
    t.options.plugins!.legend!.labels!.color = colors.muted;
    t.update('none');
    b.update('none');
  });

  return (
    <>
      <div className="row-btns">
        <div className="seg" role="group" aria-label="Intervalo">
          {STEPS.map(([s, l]) => (
            <button key={s} className={`btn${step === s ? ' on' : ''}`} onClick={() => setStep(s)}>{l}</button>
          ))}
        </div>
        <button className={`btn${sorted ? ' on' : ''}`} onClick={() => setSorted(!sorted)}>{sorted ? 'Ordem da sequência' : 'Ordenar do maior para o menor'}</button>
        <button className="btn" onClick={() => useStore.getState().setShowOrder(true)}>Sequência dos postos…</button>
      </div>
      <div className="tiles section">
        <Kpi k={`Linha por ${label}`} v={fmt(lineAvg, 1)} u="peças (média)" />
        <Kpi k="Meta pelo takt" v={fmt(target, 1)} u={`peças por ${label}`} />
        <Kpi k="Pior intervalo" v={series.line.length ? fmt(worst, 0) : '–'} u="peças" tone={target && series.line.length && worst < target * 0.95 ? 'bad' : undefined} />
        <Kpi k="Melhor intervalo" v={series.line.length ? fmt(best, 0) : '–'} u="peças" />
        <Kpi k="Por hora" v={fmt((kpi.completed * 3600) / elapsed, 1)} u="pç/h" />
      </div>
      {kpi.completed === 0 && <p className="hint section">Rode a simulação (ou ⏭ Fim) para preencher os gráficos.</p>}
      <p className="label section">Throughput da linha a cada {label}</p>
      <div className="chart-scroll">
        <div style={{ width: Math.max(560, series.ends.length * 30), height: 220 }}>
          <canvas ref={timeRef} role="img" aria-label={`Barras com as peças produzidas pela linha a cada ${label}`} />
        </div>
      </div>
      <p className="label section">Média por posto a cada {label}</p>
      <div className="chart-scroll">
        <div style={{ height: Math.max(200, stations.length * 18 + 40) }}>
          <canvas ref={barRef} role="img" aria-label={`Barras horizontais com a média de peças por ${label} em cada posto`} />
        </div>
      </div>
      <p className="hint">
        Barras amarelas na linha do tempo ficaram abaixo de 95% da meta do takt. Postos de amostra (OBA) e de reparo passam só parte das peças, e
        postos com lote (carrinho, pallet) contam cargas.
      </p>
    </>
  );
}
