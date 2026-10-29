// Yamazumi: atividades empilhadas por posto contra a linha do takt.

import Chart from 'chart.js/auto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cycleRows, effectiveTakt } from '../engine/balance';
import { ACTIVITY_LABEL, baseCycle, operationsTime, type ActivityKind } from '../engine/types';
import { useStore } from '../store';
import { lineSequence } from './CycleTakt';
import { Kpi } from './Modal';
import { fmt, pct, useCanvasColors } from './theme';

export const KIND_COLOR: Record<ActivityKind | 'none' | 'loss', string> = {
  va: '#22a06b',
  nva: '#e2a03f',
  walk: '#3b82f6',
  wait: '#9ca3af',
  machine: '#8b5cf6',
  none: '#64748b',
  loss: '#dc2626',
};

interface Seg {
  label: string;
  time: number;
  kind: ActivityKind | 'none' | 'loss';
}
interface Col {
  id: string;
  name: string;
  segs: Seg[];
  total: number;
}

/** Chave do estudo: por cycle time do posto ou por elementos (soma das atividades). */
export function StudyMode() {
  const mode = useStore((s) => s.model.settings.studyMode ?? 'cycle');
  const set = (studyMode: 'cycle' | 'elements') => useStore.getState().updateSettings({ studyMode });
  return (
    <div className="seg" role="group" aria-label="Estudo por">
      <button className={`btn${mode === 'cycle' ? ' on' : ''}`} onClick={() => set('cycle')} title="A simulação usa o tempo de ciclo de cada posto; no Yamazumi as atividades são repartidas na proporção desse ciclo.">
        Por cycle time
      </button>
      <button className={`btn${mode === 'elements' ? ' on' : ''}`} onClick={() => set('elements')} title="A simulação usa a soma das atividades de cada posto (postos sem atividades seguem com o tempo de ciclo).">
        Por elemento
      </button>
    </div>
  );
}

export function Yamazumi() {
  const model = useStore((s) => s.model);
  const colors = useCanvasColors();
  const takt = effectiveTakt(model);
  const [perPiece, setPerPiece] = useState(true);
  const [onlyOps, setOnlyOps] = useState(false);
  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model]);
  const all = useMemo(() => lineSequence(model, cycleRows(model)), [model]);
  const [pick, setPick] = useState<Set<string> | null>(null);
  const withOps = all.filter((r) => byId.get(r.id)?.operations?.length);

  const cols: Col[] = useMemo(
    () =>
      all
        .filter((r) => (pick ? pick.has(r.id) : true) && (!onlyOps || byId.get(r.id)?.operations?.length))
        .map((r) => {
          const n = byId.get(r.id)!;
          const eff = n.efficiency && n.efficiency < 1 ? n.efficiency : 1;
          // altura da barra sem a ineficiência: por peça da linha (escala do Cycle × Takt) ou o ciclo base do posto
          const target = perPiece ? r.plan * eff : baseCycle(n, model.settings);
          const ops = operationsTime(n.operations);
          // por cycle time, as atividades são repartidas na proporção do ciclo do posto
          const k = ops > 0 ? target / ops : 0;
          const segs: Seg[] = ops > 0
            ? n.operations!.flatMap((o) => o.activities.map((a) => ({ label: `${o.name} · ${a.name}`, time: a.time * k, kind: a.kind })))
            : [{ label: 'Ciclo (sem atividades)', time: target, kind: 'none' as const }];
          // ineficiência no topo da pilha: ciclo real = tempo ÷ eficiência
          if (eff < 1) segs.push({ label: `Ineficiência (eficiência ${pct(eff)})`, time: target * (1 / eff - 1), kind: 'loss' });
          return { id: r.id, name: r.name, segs, total: segs.reduce((s, x) => s + x.time, 0) };
        }),
    [all, pick, onlyOps, perPiece, byId, model.settings],
  );

  const ref = useRef<HTMLCanvasElement>(null);
  const colsRef = useRef<Col[]>([]);
  colsRef.current = cols;
  const chart = useRef<Chart | null>(null);
  useEffect(() => {
    chart.current = new Chart(ref.current!, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (c) => c.raw !== null && c.raw !== 0,
            callbacks: {
              label: (c) => {
                if (c.datasetIndex === 0) return `${c.dataset.label}`;
                const s = colsRef.current[c.dataIndex]?.segs[c.datasetIndex - 1];
                return s ? `${s.label}: ${fmt(s.time, 1)} s${s.kind === 'none' || s.kind === 'loss' ? '' : ` (${ACTIVITY_LABEL[s.kind]})`}` : '';
              },
              footer: (items) => {
                const col = colsRef.current[items[0]?.dataIndex ?? -1];
                return col ? `Total ${fmt(col.total, 1)} s${takt ? ` · ${pct(col.total / takt)} do takt` : ''}` : '';
              },
            },
          },
        },
        scales: {
          x: { stacked: true, ticks: { autoSkip: false, maxRotation: 70, minRotation: 45, font: { size: 10 } }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, title: { display: true, text: 'segundos', font: { size: 11 } }, ticks: { font: { size: 10 } } },
        },
      },
    });
    return () => chart.current?.destroy();
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const depth = Math.max(0, ...cols.map((x) => x.segs.length));
    c.data.labels = cols.map((x) => x.name);
    c.data.datasets = [
      { type: 'line', label: `Takt ${fmt(takt, 1)} s`, data: cols.map(() => takt), borderColor: colors.ink, borderWidth: 2, pointRadius: 0, order: 0, stack: 'takt' },
      ...Array.from({ length: depth }, (_, i) => ({
        type: 'bar' as const,
        label: `Atividade ${i + 1}`,
        data: cols.map((x) => x.segs[i]?.time ?? null),
        backgroundColor: cols.map((x) => KIND_COLOR[x.segs[i]?.kind ?? 'none'] + (x.segs[i]?.kind === 'none' ? '88' : x.segs[i]?.kind === 'loss' ? 'aa' : '')),
        borderColor: colors.canvas,
        borderWidth: 1,
        barPercentage: 0.85,
        categoryPercentage: 0.9,
        order: 1,
        stack: 'acts',
      })),
    ];
    const sc = c.options.scales!;
    for (const ax of [sc.x!, sc.y!]) {
      ax.ticks!.color = colors.muted;
      if (ax.grid) ax.grid.color = colors.line;
    }
    (sc.y as { title: { color?: string } }).title.color = colors.muted;
    c.update('none');
  });

  const over = cols.filter((x) => takt > 0 && x.total > takt);
  const maxT = Math.max(0, ...cols.map((x) => x.total));
  const va = cols.reduce((s, x) => s + x.segs.filter((g) => g.kind === 'va').reduce((a, g) => a + g.time, 0), 0);
  const tot = cols.reduce((s, x) => s + x.total, 0);
  const width = Math.max(640, cols.length * 34);
  const toggle = (id: string) => {
    const s = new Set(pick ?? all.map((r) => r.id));
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setPick(s);
  };

  return (
    <>
      <div className="tiles">
        <Kpi k="Takt" v={fmt(takt, 1)} u={`s · ${fmt(takt ? 3600 / takt : 0, 1)} pç/h`} />
        <Kpi k="Postos com atividades" v={`${withOps.length}/${all.length}`} u="postos" />
        <Kpi k="Maior posto" v={fmt(maxT, 1)} u="s" tone={maxT > takt ? 'bad' : undefined} />
        <Kpi k="Acima do takt" v={String(over.length)} u="postos" tone={over.length ? 'bad' : undefined} />
        <Kpi k="Agrega valor" v={pct(tot ? va / tot : 0)} u="do tempo mostrado" />
      </div>
      <div className="row-btns section">
        <span className="muted">Estudo</span>
        <StudyMode />
        <span className="muted">Escala</span>
        <div className="seg" role="group" aria-label="Escala">
          <button className={`btn${perPiece ? ' on' : ''}`} onClick={() => setPerPiece(true)} title="÷ postos paralelos, fração de peças e lote: a mesma escala do Cycle × Takt">Por peça da linha</button>
          <button className={`btn${!perPiece ? ' on' : ''}`} onClick={() => setPerPiece(false)} title="Tempo de cada atividade como cadastrado">Conteúdo de trabalho</button>
        </div>
        <button className="btn primary" onClick={() => useStore.getState().setOpsFor('')}>Editar atividades</button>
        <button className={`btn${onlyOps ? ' on' : ''}`} onClick={() => setOnlyOps(!onlyOps)}>Só postos com atividades</button>
        <details className="pick">
          <summary className="btn">Postos ({pick ? pick.size : all.length}/{all.length}) ▾</summary>
          <div className="pick-list">
            <div className="row-btns">
              <button className="btn small" onClick={() => setPick(null)}>Todos</button>
              <button className="btn small" onClick={() => setPick(new Set())}>Nenhum</button>
              <button className="btn small" onClick={() => setPick(new Set(all.filter((r) => !r.offline).map((r) => r.id)))}>Linha principal</button>
            </div>
            {all.map((r) => (
              <label key={r.id}>
                <input type="checkbox" checked={pick ? pick.has(r.id) : true} onChange={() => toggle(r.id)} />
                {r.name}
                {r.offline ? ' (off)' : ''}
              </label>
            ))}
          </div>
        </details>
      </div>
      <div className="yz-legend">
        {(Object.keys(ACTIVITY_LABEL) as ActivityKind[]).map((k) => (
          <span key={k}><i style={{ background: KIND_COLOR[k] }} />{ACTIVITY_LABEL[k]}</span>
        ))}
        <span><i style={{ background: KIND_COLOR.none + '88' }} />Sem atividades (ciclo do posto)</span>
        <span><i style={{ background: KIND_COLOR.loss }} />Ineficiência</span>
        <span><i className="line" style={{ background: colors.ink }} />Takt</span>
      </div>
      <div className="chart-scroll section">
        <div style={{ width, minWidth: '100%', height: 360 }}>
          <canvas ref={ref} role="img" aria-label="Yamazumi: atividades empilhadas por posto com a linha do takt" />
        </div>
      </div>
      <p className="hint">
        Cadastre operações e atividades no painel de cada posto (selecione o bloco). Por peça da linha divide pelos postos paralelos, pela fração de peças que passa e pelo lote, igual ao Cycle × Takt.
      </p>
    </>
  );
}
