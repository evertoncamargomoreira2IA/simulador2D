// Ajustar curva: tempos cronometrados (colados) ou dados reais do posto viram a curva do tempo de ciclo.
// Mostra o histograma com as curvas candidatas e a melhor pelo teste de Kolmogorov-Smirnov.

import { useMemo, useState } from 'react';
import { DIST_LABEL, fitTimes, parseTimes, pdf, toDist, type FitResult } from '../engine/dist';
import type { DistKind } from '../engine/types';
import { splitOutliers } from '../engine/timeStudy';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Kpi, Modal } from './Modal';
import { fmt, pct } from './theme';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const CURVE_COLOR: Partial<Record<DistKind, string>> = {
  normal: '#22d3ee',
  lognormal: '#e8913a',
  triangular: '#a78bfa',
  uniform: '#94a3b8',
  exponential: '#f472b6',
};

/** Ciclo real do posto por peça (fim da última operação − início da primeira). */
export function realCycles(events: { posto: string; serie: string; inicio: number; fim: number }[], name: string): number[] {
  const key = norm(name);
  const by = new Map<string, [number, number]>();
  for (const e of events) {
    if (norm(e.posto) !== key) continue;
    const r = by.get(e.serie);
    by.set(e.serie, r ? [Math.min(r[0], e.inicio), Math.max(r[1], e.fim)] : [e.inicio, e.fim]);
  }
  return [...by.values()].map(([a, b]) => b - a).filter((x) => x > 0);
}

export function FitCurve({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const node = useStore((s) => s.model.nodes.find((n) => n.id === nodeId));
  const events = useStore((s) => s.realEvents);
  const fromReal = useMemo(() => (node ? realCycles(events, node.name) : []), [events, node]);
  const [text, setText] = useState(() => (fromReal.length ? '' : node?.dist?.samples?.join('\n') ?? ''));
  const [src, setSrc] = useState<'real' | 'colar'>(fromReal.length ? 'real' : 'colar');
  const [clean, setClean] = useState(true);
  const raw = useMemo(() => (src === 'real' ? fromReal : parseTimes(text)), [src, fromReal, text]);
  // paradas curtas (falta de material, dúvida) não fazem parte da curva do posto: descarta além de ±2 desvios
  const { kept: xs, out } = useMemo(() => (clean ? splitOutliers(raw, 2) : { kept: raw, out: [] as number[] }), [raw, clean]);
  const fit = useMemo(() => fitTimes(xs), [xs]);
  const [pick, setPick] = useState<DistKind | null>(null);
  const [msg, setMsg] = useState('');
  if (!node) return null;
  const best = fit?.ranking[0];
  const chosen = fit ? (pick === 'empirical' ? null : fit.ranking.find((r) => r.kind === (pick ?? best?.kind)) ?? best ?? null) : null;

  const apply = (r: FitResult | 'empirical') => {
    if (!fit) return;
    const d = toDist(r, xs);
    useStore.getState().updateNode(node.id, {
      cycleTime: Math.round(fit.mean * 10) / 10,
      cv: Math.round((r === 'empirical' ? fit.cv : r.cv) * 100) / 100,
      cycleFromOps: false,
      dist: d.kind === 'lognormal' ? undefined : d,
    });
    setMsg(`Aplicado em ${node.name}: ${DIST_LABEL[d.kind]}, média ${fmt(fit.mean, 1)} s, CV ${pct(fit.cv, 0)}. Rode a simulação de novo para ver o efeito.`);
  };

  return (
    <Modal title={`📈 Curva do tempo · ${node.name}`} sub="Transforme tempos medidos na curva que o simulador sorteia a cada peça." onClose={onClose} wide>
      <HowTo
        title="Ajustar curva: por que e como"
        why="O tempo de um posto nunca é sempre igual. A forma da variação (simétrica, com cauda longa, com mínimo e máximo) muda filas, bloqueios e o UPH. Aqui o simulador compara as curvas com os seus tempos e escolhe a que melhor representa."
        steps={[
          'Escolha a fonte: os dados reais do posto (aba Dados reais) ou cole os tempos cronometrados, um por linha ou separados por espaço (aceita vírgula e mm:ss).',
          'Veja o histograma: as barras são os seus tempos e as linhas são as curvas candidatas.',
          'A tabela ordena as curvas pela distância KS (quanto menor, melhor). "Passa" quer dizer que a curva representa os dados com 95% de confiança.',
          'Clique em Aplicar na curva escolhida. O tempo de ciclo vira a média medida e o CV vem dos dados. Empírica sorteia direto entre os tempos medidos.',
        ]}
        tip="Use pelo menos 30 tempos. Com poucos tempos várias curvas passam no teste; nesse caso fique com a lognormal (padrão) ou a triangular."
      />
      <div className="row-btns section" role="group" aria-label="Fonte dos tempos">
        <button className={`btn${src === 'real' ? ' on' : ''}`} aria-pressed={src === 'real'} disabled={!fromReal.length} onClick={() => setSrc('real')}>
          Dados reais do posto{fromReal.length ? ` (${fromReal.length})` : ' (sem leituras)'}
        </button>
        <button className={`btn${src === 'colar' ? ' on' : ''}`} aria-pressed={src === 'colar'} onClick={() => setSrc('colar')}>Colar tempos</button>
        <label className="chip-toggle">
          <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} /> Descartar discrepantes (±2 desvios){out.length ? ` · ${out.length} fora` : ''}
        </label>
        <span className="muted">Atual: {DIST_LABEL[node.dist?.kind ?? 'lognormal']} · média {fmt(node.cycleTime, 1)} s · CV {pct(node.cv, 0)}</span>
      </div>
      {src === 'colar' && (
        <textarea className="fit-text" rows={4} placeholder={'Cole aqui os tempos (s), ex.:\n33,2\n35,8\n31,9'} value={text} onChange={(e) => setText(e.target.value)} aria-label="Tempos cronometrados" />
      )}
      {!fit && <p className="hint">Preciso de pelo menos 3 tempos para ajustar uma curva.</p>}
      {fit && (
        <>
          <div className="tiles section">
            <Kpi k="Tempos" v={String(fit.n)} />
            <Kpi k="Média" v={fmt(fit.mean, 1)} u="s" />
            <Kpi k="Desvio" v={fmt(fit.sd, 2)} u={`s · CV ${pct(fit.cv, 0)}`} />
            <Kpi k="Mín · máx" v={`${fmt(fit.min, 1)} · ${fmt(fit.max, 1)}`} u="s" />
            <Kpi k="Melhor curva" v={best ? DIST_LABEL[best.kind].split(' (')[0] : '–'} />
          </div>
          <Histogram fit={fit} focus={pick ?? best?.kind ?? null} />
          <table className="grid-table section">
            <thead>
              <tr><th>Curva</th><th>Distância KS</th><th>Teste 95%</th><th>Parâmetros</th><th /></tr>
            </thead>
            <tbody>
              {fit.ranking.map((r, i) => (
                <tr key={r.kind} className={chosen?.kind === r.kind ? 'sel' : ''} onMouseEnter={() => setPick(r.kind)}>
                  <td><i className="sw" style={{ background: CURVE_COLOR[r.kind] }} /> {DIST_LABEL[r.kind].split(' (')[0]}{i === 0 && <b className="good"> · melhor</b>}</td>
                  <td>{fmt(r.ks, 3)}</td>
                  <td className={r.ok ? 'good' : 'bad'}>{r.ok ? 'Passa' : 'Não passa'}</td>
                  <td>{r.min !== undefined ? `mín ${fmt(r.min, 1)} · máx ${fmt(r.max ?? 0, 1)} s` : r.kind === 'exponential' ? `média ${fmt(r.mean, 1)} s` : `média ${fmt(r.mean, 1)} s · CV ${pct(r.cv, 0)}`}</td>
                  <td><button className="btn" onClick={() => apply(r)}>Aplicar</button></td>
                </tr>
              ))}
              <tr onMouseEnter={() => setPick('empirical')}>
                <td>Empírica (sorteia entre os {fit.n} tempos)</td>
                <td>0</td>
                <td className="good">Igual aos dados</td>
                <td>{Math.min(500, fit.n)} tempos guardados no posto</td>
                <td><button className="btn" onClick={() => apply('empirical')}>Aplicar</button></td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      {msg && <p className="hint">{msg}</p>}
    </Modal>
  );
}

function Histogram({ fit, focus }: { fit: NonNullable<ReturnType<typeof fitTimes>>; focus: DistKind | null }) {
  const W = 640;
  const H = 200;
  const L = 36;
  const B = 172;
  const { start, width, counts } = fit.bins;
  const k = counts.length;
  const lo = start - width;
  const hi = start + width * (k + 1);
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (W - L - 8);
  // altura em "peças por faixa": densidade × n × largura da faixa
  const curves = fit.ranking.map((r) => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const v = lo + ((hi - lo) * i) / 120;
      pts.push(`${x(v).toFixed(1)},${pdf(r.kind, v, fit.mean, fit.sd, r.min ?? lo, r.max ?? hi) * fit.n * width}`);
    }
    return { r, pts };
  });
  const maxY = Math.max(...counts, ...curves.flatMap((c) => c.pts.map((p) => Number(p.split(',')[1])).filter(Number.isFinite))) || 1;
  const y = (v: number) => B - (Math.min(v, maxY * 1.05) / (maxY * 1.05)) * (B - 10);
  return (
    <div className="chart-scroll section">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img" aria-label="Histograma dos tempos com as curvas ajustadas">
        <line x1={L} x2={W - 8} y1={B} y2={B} className="pc-grid" />
        {counts.map((c, i) => (
          <rect key={i} x={x(start + i * width) + 1} y={y(c)} width={Math.max(1, x(start + width) - x(start) - 2)} height={B - y(c)} className="fit-bar">
            <title>{`${fmt(start + i * width, 1)} a ${fmt(start + (i + 1) * width, 1)} s: ${c} peças`}</title>
          </rect>
        ))}
        {curves.map(({ r, pts }) => (
          <polyline
            key={r.kind}
            fill="none"
            stroke={CURVE_COLOR[r.kind]}
            strokeWidth={focus === r.kind ? 2.6 : 1.2}
            opacity={focus && focus !== r.kind ? 0.35 : 1}
            points={pts.map((p) => { const [a, b] = p.split(','); return `${a},${y(Number(b) || 0).toFixed(1)}`; }).join(' ')}
          />
        ))}
        {[lo + width, fit.mean, hi - width].map((v, i) => (
          <text key={i} x={x(v)} y={B + 14} textAnchor="middle" className="pc-label">{fmt(v, 1)} s</text>
        ))}
        <line x1={x(fit.mean)} x2={x(fit.mean)} y1={10} y2={B} className="pc-soe" strokeDasharray="3 3" />
      </svg>
    </div>
  );
}
