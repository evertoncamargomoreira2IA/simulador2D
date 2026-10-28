// Gráfico cycle time × takt por posto (balanceamento da linha).

import Chart from 'chart.js/auto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cycleRows, effectiveTakt, type CtRow } from '../engine/balance';
import { chartSequence, type Model } from '../engine/types';
import { useStore } from '../store';
import { Kpi } from './Modal';
import { fmt, pct, useCanvasColors } from './theme';

export { cycleRows, effectiveTakt, type CtRow } from '../engine/balance';

const flowCache = new WeakMap<Model['nodes'], Map<string, number>>();

/** Posição de cada posto na linha: principal na ordem do fluxo, depois os off-lines, depois o resto. */
export function flowRank(model: Model): Map<string, number> {
  let r = flowCache.get(model.nodes);
  if (!r) {
    const rows = cycleRows(model);
    const ids = [...rows.filter((x) => !x.offline), ...rows.filter((x) => x.offline)].map((x) => x.id);
    r = new Map(ids.map((id, i) => [id, i]));
    flowCache.set(model.nodes, r);
  }
  return r;
}

/** Ordem dos gráficos: a sequência editada pelo usuário ou, sem ela, a da linha principal. */
export function lineSequence<T extends { id: string }>(model: Model, items: T[], keepHidden = false): T[] {
  const rank = flowRank(model);
  const base = items
    .map((x, i) => ({ x, k: rank.get(x.id) ?? rank.size + i }))
    .sort((a, b) => a.k - b.k)
    .map((e) => e.x);
  return chartSequence(model, base, keepHidden);
}

export function CycleTakt() {
  const model = useStore((s) => s.model);
  const kpi = useStore((s) => s.kpi);
  useStore((s) => s.tick);
  const colors = useCanvasColors();
  const [sorted, setSorted] = useState(false);
  const [scope, setScope] = useState<'all' | 'main' | 'off'>('all');
  const takt = effectiveTakt(model);
  const all = useMemo(() => cycleRows(model, kpi), [model, kpi]);
  const rows = useMemo(() => {
    const r = lineSequence(model, all).filter((x) => (scope === 'all' ? true : scope === 'off' ? x.offline : !x.offline));
    return sorted ? [...r].sort((a, b) => b.plan - a.plan) : r;
  }, [all, scope, sorted, model]);
  const hasReal = rows.some((r) => r.real !== undefined);

  const ref = useRef<HTMLCanvasElement>(null);
  const rowsRef = useRef<CtRow[]>([]);
  rowsRef.current = rows;
  const chart = useRef<Chart | null>(null);
  useEffect(() => {
    chart.current = new Chart(ref.current!, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        animation: false,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (c) => `${c.dataset.label}: ${fmt(Number(c.raw), 1)} s`,
              afterBody: (items) => {
                const r = rowsRef.current[items[0]?.dataIndex ?? -1];
                if (!r || (r.share > 0.999 && r.load === 1)) return '';
                return `Tempo da giga ÷ gigas ${fmt(r.raw, 1)} s${r.share < 0.999 ? ` · passa ${pct(r.share, 1)} das peças` : ''}${r.load > 1 ? ` · carga de ${r.load} peças` : ''}`;
              },
            },
          },
        },
        scales: {
          x: { ticks: { autoSkip: false, maxRotation: 70, minRotation: 45, font: { size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: 'segundos por peça', font: { size: 11 } }, ticks: { font: { size: 10 } } },
        },
      },
    });
    return () => chart.current?.destroy();
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const tone = (v: number) => (takt > 0 && v > takt ? colors.state.down : takt > 0 && v > 0.9 * takt ? colors.state.blocked : colors.state.working);
    c.data.labels = rows.map((r) => (r.offline ? `${r.name} (off)` : r.name));
    c.data.datasets = [
      { type: 'bar', label: 'Cycle time planejado', data: rows.map((r) => r.plan), backgroundColor: rows.map((r) => tone(r.plan)), borderWidth: 0, barPercentage: 0.9, categoryPercentage: 0.85, order: 2 },
      ...(hasReal
        ? [{ type: 'bar' as const, label: 'Medido na simulação', data: rows.map((r) => r.real ?? null), backgroundColor: colors.muted + '66', borderColor: colors.muted, borderWidth: 1, barPercentage: 0.9, categoryPercentage: 0.85, order: 3 }]
        : []),
      { type: 'line', label: `Takt ${fmt(takt, 1)} s`, data: rows.map(() => takt), borderColor: colors.ink, borderWidth: 2, pointRadius: 0, order: 0 },
      { type: 'line', label: '90% do takt', data: rows.map(() => takt * 0.9), borderColor: colors.muted, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, order: 1 },
    ];
    const sc = c.options.scales!;
    for (const ax of [sc.x!, sc.y!]) {
      ax.ticks!.color = colors.muted;
      if (ax.grid) ax.grid.color = colors.line;
    }
    (sc.y as { title: { color?: string } }).title.color = colors.muted;
    c.options.plugins!.legend!.labels!.color = colors.muted;
    c.update('none');
  });

  const over = all.filter((r) => takt > 0 && r.plan > takt);
  const near = all.filter((r) => takt > 0 && r.plan > 0.9 * takt && r.plan <= takt);
  const main = all.filter((r) => !r.offline);
  const maxCt = Math.max(0, ...main.map((r) => r.plan));
  const balance = main.length && maxCt ? main.reduce((s, r) => s + r.plan, 0) / (main.length * maxCt) : 0;
  const width = Math.max(640, rows.length * 26);

  return (
    <>
      <div className="tiles">
        <Kpi k="Takt" v={fmt(takt, 1)} u={`s · ${fmt(takt ? 3600 / takt : 0, 1)} pç/h`} />
        <Kpi k="Maior cycle time" v={fmt(maxCt, 1)} u="s (linha principal)" tone={maxCt > takt ? 'bad' : undefined} />
        <Kpi k="Balanceamento" v={pct(balance)} u="linha principal" />
        <Kpi k="Acima do takt" v={String(over.length)} u="postos" tone={over.length ? 'bad' : undefined} />
        <Kpi k="Entre 90% e 100%" v={String(near.length)} u="postos" />
      </div>
      <div className="row-btns section">
        <div className="seg" role="group" aria-label="Postos">
          {([['all', 'Todos'], ['main', 'Linha principal'], ['off', 'Off-lines']] as const).map(([k, l]) => (
            <button key={k} className={`btn${scope === k ? ' on' : ''}`} onClick={() => setScope(k)}>{l}</button>
          ))}
        </div>
        <button className={`btn${sorted ? ' on' : ''}`} onClick={() => setSorted(!sorted)}>{sorted ? 'Ordem da sequência' : 'Ordenar do maior para o menor'}</button>
        <button className="btn" onClick={() => useStore.getState().setShowOrder(true)}>Sequência dos postos…</button>
      </div>
      <div className="chart-scroll section">
        <div style={{ width, height: 340 }}>
          <canvas ref={ref} role="img" aria-label="Barras do cycle time de cada posto com a linha do takt" />
        </div>
      </div>
      <p className="hint">
        Cycle time planejado = tempo da giga ÷ número de gigas, por peça da linha: em amostras (OBA), reparo e lotes (carrinho, pallet) o tempo é dividido pela fração de peças que passa e pelo tamanho da carga. Vermelho passa do takt, amarelo está entre 90% e 100%.
        {hasReal ? ' A barra cinza é o tempo ocupado por peça produzida, medido na simulação (inclui variação, falhas e reparo).' : ' Rode a simulação para ver também o tempo medido.'} Balanceamento = soma dos tempos ÷ (postos × maior tempo).
      </p>
      {over.length > 0 && (
        <p className="hint">Acima do takt: {over.map((r) => `${r.name} (${fmt(r.plan, 1)} s)`).join(', ')}.</p>
      )}
    </>
  );
}
