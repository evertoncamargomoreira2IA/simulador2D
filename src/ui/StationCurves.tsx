// Curva normal de cada posto com os dados reais: média, faixas de ±1 e ±2 desvios (68% e 95% das peças),
// SOE e takt. Mostra quanto o posto varia (discrepância) e o quanto dá para confiar no tempo dele.

import { useMemo, useState } from 'react';
import { splitOutliers, type RealEvent, type StationStudy } from '../engine/timeStudy';
import type { Model } from '../engine/types';
import { realCycles } from './FitCurve';
import { fmt, pct } from './theme';

export type Reliability = 'Alta' | 'Média' | 'Baixa';

/** Confiabilidade pelo coeficiente de variação: até 5% alta, até 10% média, acima disso baixa. */
export const reliabilityOf = (cv: number): Reliability => (cv <= 0.05 ? 'Alta' : cv <= 0.1 ? 'Média' : 'Baixa');

export interface CurveRow {
  id: string | null;
  name: string;
  xs: number[];
  mean: number;
  sd: number;
  cv: number;
  plan: number;
  /** Limite do posto contra o takt (s por giga = takt × gigas). */
  limit: number;
  /** Fração das peças dentro de SOE ± alerta e acima do limite do takt. */
  inSoe: number | null;
  overTakt: number | null;
  reliability: Reliability;
}

const gauss = (x: number, m: number, s: number) => (s > 0 ? Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)) : 0);

export function curveRows(rows: StationStudy[], events: RealEvent[], model: Model, sigma: number, alertPct: number, takt: number): CurveRow[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  return rows
    .map((r) => {
      const xs = splitOutliers(realCycles(events, r.name), sigma).kept;
      const cap = Math.max(1, (r.id && byId.get(r.id)?.capacity) || 1);
      const limit = takt > 0 ? takt * cap : 0;
      const cv = r.mean > 0 ? r.sd / r.mean : 0;
      return {
        id: r.id,
        name: r.name,
        xs,
        mean: r.mean,
        sd: r.sd,
        cv,
        plan: r.plan,
        limit,
        inSoe: r.plan > 0 && xs.length ? xs.filter((x) => Math.abs(x / r.plan - 1) <= alertPct).length / xs.length : null,
        overTakt: limit > 0 && xs.length ? xs.filter((x) => x > limit).length / xs.length : null,
        reliability: reliabilityOf(cv),
      };
    })
    .filter((c) => c.xs.length >= 3 && c.mean > 0);
}

/** Cartões por posto + comparação da dispersão de todos os postos. */
export function StationCurves({ rows }: { rows: CurveRow[] }) {
  const [mode, setMode] = useState<'postos' | 'comparar'>('postos');
  const [sort, setSort] = useState<'linha' | 'variacao'>('linha');
  const list = useMemo(() => (sort === 'variacao' ? [...rows].sort((a, b) => b.cv - a.cv) : rows), [rows, sort]);
  const count = (k: Reliability) => rows.filter((r) => r.reliability === k).length;
  return (
    <div className="section">
      <div className="row-btns" role="group" aria-label="Como ver as curvas">
        <button className={`btn${mode === 'postos' ? ' on' : ''}`} aria-pressed={mode === 'postos'} onClick={() => setMode('postos')}>Curva de cada posto</button>
        <button className={`btn${mode === 'comparar' ? ' on' : ''}`} aria-pressed={mode === 'comparar'} onClick={() => setMode('comparar')}>Comparar postos</button>
        {mode === 'postos' && (
          <label className="field inline">
            <span>Ordem</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as 'linha' | 'variacao')}>
              <option value="linha">da linha</option>
              <option value="variacao">mais variação primeiro</option>
            </select>
          </label>
        )}
        <span className="muted">
          Confiabilidade: <b className="good">{count('Alta')} alta</b> (CV ≤ 5%) · <b className="warn">{count('Média')} média</b> (≤ 10%) · <b className="bad">{count('Baixa')} baixa</b> (&gt; 10%)
        </span>
      </div>
      {mode === 'postos' ? (
        <div className="curve-grid">
          {list.map((r) => <CurveCard key={r.name} r={r} />)}
        </div>
      ) : (
        <CompareChart rows={rows} />
      )}
      <p className="hint">
        Faixa escura = média ± 1 desvio (cerca de 68% das peças). Faixa clara = ± 2 desvios (cerca de 95%). Curva estreita e alta = posto estável; larga e baixa = muita variação.
        Traço branco = SOE, linha vermelha = limite do takt (takt × gigas).
      </p>
    </div>
  );
}

function CurveCard({ r }: { r: CurveRow }) {
  const W = 300;
  const H = 150;
  const L = 8;
  const R = W - 8;
  const B = 118;
  const s = r.sd || r.mean * 0.01;
  let lo = r.mean - 3.5 * s;
  let hi = r.mean + 3.5 * s;
  // SOE e takt entram na escala quando estão perto (até 1,5× a faixa)
  for (const v of [r.plan, r.limit]) if (v > 0 && v > lo - (hi - lo) * 0.5 && v < hi + (hi - lo) * 0.5) [lo, hi] = [Math.min(lo, v - s * 0.3), Math.max(hi, v + s * 0.3)];
  lo = Math.max(0, lo);
  const x = (v: number) => L + ((v - lo) / (hi - lo)) * (R - L);
  // histograma das leituras em 16 faixas, na mesma escala da curva (peças por faixa)
  const k = 16;
  const bw = (hi - lo) / k;
  const counts = new Array(k).fill(0);
  for (const v of r.xs) if (v >= lo && v < hi) counts[Math.floor((v - lo) / bw)]++;
  const peak = gauss(r.mean, r.mean, s) * r.xs.length * bw;
  const maxY = Math.max(peak, ...counts) * 1.08 || 1;
  const y = (v: number) => B - (v / maxY) * (B - 8);
  const pts: string[] = [];
  for (let i = 0; i <= 90; i++) {
    const v = lo + ((hi - lo) * i) / 90;
    pts.push(`${x(v).toFixed(1)},${y(gauss(v, r.mean, s) * r.xs.length * bw).toFixed(1)}`);
  }
  const band = (a: number, b: number) => {
    const p: string[] = [`${x(a).toFixed(1)},${B}`];
    for (let i = 0; i <= 30; i++) {
      const v = a + ((b - a) * i) / 30;
      p.push(`${x(v).toFixed(1)},${y(gauss(v, r.mean, s) * r.xs.length * bw).toFixed(1)}`);
    }
    p.push(`${x(b).toFixed(1)},${B}`);
    return p.join(' ');
  };
  const cl = (v: number) => Math.min(hi, Math.max(lo, v));
  const dev = r.plan > 0 ? r.mean / r.plan - 1 : null;
  const tone = r.reliability === 'Alta' ? 'good' : r.reliability === 'Média' ? 'warn' : 'bad';
  return (
    <div className={`curve-card ${tone}`}>
      <div className="curve-head">
        <b>{r.name}</b>
        <span className={`rel ${tone}`}>{r.reliability}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Curva de ${r.name}: média ${fmt(r.mean, 1)} s, desvio ${fmt(r.sd, 1)} s`}>
        {counts.map((c, i) => c > 0 && <rect key={i} x={x(lo + i * bw) + 0.5} y={y(c)} width={Math.max(1, x(lo + bw) - x(lo) - 1)} height={B - y(c)} className="cv-hist" />)}
        <polygon points={band(cl(r.mean - 2 * s), cl(r.mean + 2 * s))} className="cv-band2" />
        <polygon points={band(cl(r.mean - s), cl(r.mean + s))} className="cv-band1" />
        <polyline points={pts.join(' ')} className="cv-curve" fill="none" />
        <line x1={x(r.mean)} x2={x(r.mean)} y1={8} y2={B} className="cv-mean" />
        {r.plan > 0 && r.plan >= lo && r.plan <= hi && <line x1={x(r.plan)} x2={x(r.plan)} y1={8} y2={B} className="pc-soe" strokeDasharray="4 3"><title>{`SOE ${fmt(r.plan, 1)} s`}</title></line>}
        {r.limit > 0 && r.limit >= lo && r.limit <= hi && <line x1={x(r.limit)} x2={x(r.limit)} y1={8} y2={B} className="pc-takt"><title>{`Limite do takt ${fmt(r.limit, 1)} s`}</title></line>}
        <line x1={L} x2={R} y1={B} y2={B} className="pc-grid" />
        {[-2, -1, 0, 1, 2].map((z) => {
          const v = r.mean + z * s;
          if (v < lo || v > hi) return null;
          return (
            <g key={z}>
              <line x1={x(v)} x2={x(v)} y1={B} y2={B + 4} className="pc-grid" />
              <text x={x(v)} y={B + 14} textAnchor="middle" className="pc-label">{z === 0 ? `${fmt(v, 1)}` : fmt(v, 1)}</text>
              <text x={x(v)} y={B + 26} textAnchor="middle" className="pc-label dim">{z === 0 ? 'média' : `${z > 0 ? '+' : '−'}${Math.abs(z)}σ`}</text>
            </g>
          );
        })}
      </svg>
      <dl className="curve-stats">
        <div><dt>Média</dt><dd>{fmt(r.mean, 1)} s</dd></div>
        <div><dt>Desvio (σ)</dt><dd>± {fmt(r.sd, 1)} s · {pct(r.cv, 1)}</dd></div>
        <div><dt>68% das peças</dt><dd>{fmt(r.mean - r.sd, 1)} a {fmt(r.mean + r.sd, 1)} s</dd></div>
        <div><dt>95% das peças</dt><dd>{fmt(Math.max(0, r.mean - 2 * r.sd), 1)} a {fmt(r.mean + 2 * r.sd, 1)} s</dd></div>
        <div><dt>Real × SOE</dt><dd className={dev === null ? '' : Math.abs(dev) > 0.1 ? 'bad' : 'good'}>{dev === null ? '–' : `${dev > 0 ? '+' : ''}${pct(dev, 1)} (${fmt(r.mean - r.plan, 1)} s)`}</dd></div>
        <div><dt>Dentro do SOE ± alerta</dt><dd>{r.inSoe === null ? '–' : pct(r.inSoe)}</dd></div>
        <div><dt>Acima do takt</dt><dd className={r.overTakt ? (r.overTakt > 0.05 ? 'bad' : 'warn') : 'good'}>{r.overTakt === null ? '–' : pct(r.overTakt, 1)}</dd></div>
        <div><dt>Leituras</dt><dd>{r.xs.length}</dd></div>
      </dl>
    </div>
  );
}

/** Todas as curvas na mesma régua (% em relação à média do posto): quem é estreito confia, quem é largo varia. */
function CompareChart({ rows }: { rows: CurveRow[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 720;
  const H = 300;
  const L = 40;
  const R = W - 170;
  const B = 260;
  const span = Math.min(0.6, Math.max(0.15, ...rows.map((r) => r.cv * 3.2)));
  const x = (d: number) => L + ((d + span) / (2 * span)) * (R - L);
  const peak = Math.max(...rows.map((r) => gauss(0, 0, Math.max(r.cv, 0.004))));
  const y = (v: number) => B - (v / (peak * 1.05)) * (B - 16);
  const sorted = [...rows].sort((a, b) => b.cv - a.cv);
  const color = (r: CurveRow) => (r.reliability === 'Alta' ? 'var(--st-working)' : r.reliability === 'Média' ? '#e8913a' : 'var(--st-down)');
  return (
    <div className="chart-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img" aria-label="Dispersão de todos os postos na mesma régua">
        <line x1={L} x2={R} y1={B} y2={B} className="pc-grid" />
        {[-span, -span / 2, 0, span / 2, span].map((d) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={16} y2={B} className="pc-grid" />
            <text x={x(d)} y={B + 16} textAnchor="middle" className="pc-label">{d === 0 ? 'média' : `${d > 0 ? '+' : '−'}${pct(Math.abs(d))}`}</text>
          </g>
        ))}
        {[0.05, 0.1].map((c) => (
          <rect key={c} x={x(-c)} y={16} width={x(c) - x(-c)} height={B - 16} className="cv-zone" />
        ))}
        <text x={x(0)} y={30} textAnchor="middle" className="pc-label">zona ±5% · ±10%</text>
        {sorted.map((r) => {
          const s = Math.max(r.cv, 0.004);
          const p: string[] = [];
          for (let i = 0; i <= 120; i++) {
            const d = -span + (2 * span * i) / 120;
            p.push(`${x(d).toFixed(1)},${y(gauss(d, 0, s)).toFixed(1)}`);
          }
          const on = hover === r.name;
          return (
            <polyline key={r.name} points={p.join(' ')} fill="none" stroke={color(r)} strokeWidth={on ? 3 : 1.4} opacity={hover && !on ? 0.25 : 0.9} onMouseEnter={() => setHover(r.name)} onMouseLeave={() => setHover(null)}>
              <title>{`${r.name}: CV ${pct(r.cv, 1)} (± ${fmt(r.sd, 1)} s em ${fmt(r.mean, 1)} s)`}</title>
            </polyline>
          );
        })}
        <text x={R + 12} y={20} className="pc-label">Mais variação primeiro</text>
        {sorted.slice(0, 12).map((r, i) => (
          <g key={r.name} onMouseEnter={() => setHover(r.name)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
            <rect x={R + 12} y={30 + i * 19} width={10} height={10} rx={2} fill={color(r)} />
            <text x={R + 28} y={39 + i * 19} className="pc-label" fontWeight={hover === r.name ? 700 : 400}>{r.name.length > 18 ? `${r.name.slice(0, 17)}…` : r.name} · {pct(r.cv, 1)}</text>
          </g>
        ))}
        {sorted.length > 12 && <text x={R + 12} y={30 + 12 * 19 + 10} className="pc-label dim">+ {sorted.length - 12} postos</text>}
      </svg>
    </div>
  );
}
