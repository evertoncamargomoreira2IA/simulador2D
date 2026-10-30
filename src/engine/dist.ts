// Curvas do tempo de ciclo: sorteio no simulador e ajuste a partir de tempos medidos.
// Todas as curvas têm a média do posto; a variação vem do cv (ou de min/max na triangular e uniforme).

import type { Rng } from './rng';
import type { DistKind, TimeDist } from './types';

export const DIST_LABEL: Record<DistKind, string> = {
  lognormal: 'Lognormal (padrão)',
  normal: 'Normal',
  triangular: 'Triangular (mín, moda, máx)',
  uniform: 'Uniforme (mín a máx)',
  exponential: 'Exponencial',
  constant: 'Constante (sem variação)',
  empirical: 'Empírica (tempos medidos)',
};

const SQ6 = Math.sqrt(6);
const SQ3 = Math.sqrt(3);

/** Limites da triangular/uniforme: os informados ou, sem eles, simétricos com o mesmo cv. */
export function bounds(mean: number, cv: number, d?: TimeDist): [number, number] {
  const k = d?.kind === 'uniform' ? SQ3 : SQ6;
  const lo = d?.min ?? Math.max(0, mean * (1 - k * cv));
  const hi = d?.max ?? mean * (1 + k * cv);
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/** Moda da triangular que mantém a média do posto: (mín + moda + máx) / 3 = média. */
export const triMode = (mean: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, 3 * mean - lo - hi));

function triangular(u: number, a: number, c: number, b: number): number {
  if (b <= a) return a;
  const f = (c - a) / (b - a);
  return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/** Sorteia um tempo com média `mean`. Sem curva: lognormal com o cv (como sempre foi). */
export function sampleTime(rng: Rng, mean: number, cv: number, d?: TimeDist): number {
  if (mean <= 0) return 0;
  switch (d?.kind ?? 'lognormal') {
    case 'constant':
      return mean;
    case 'normal':
      return Math.max(mean * 0.05, mean + mean * cv * rng.normal());
    case 'uniform': {
      const [a, b] = bounds(mean, cv, d);
      return a + (b - a) * rng.next();
    }
    case 'triangular': {
      const [a, b] = bounds(mean, cv, d);
      return triangular(rng.next(), a, triMode(mean, a, b), b);
    }
    case 'exponential':
      return rng.exponential(mean);
    case 'empirical': {
      const xs = d?.samples ?? [];
      if (!xs.length) return rng.lognormal(mean, cv);
      const m = avg(xs);
      return m > 0 ? (xs[Math.floor(rng.next() * xs.length)] * mean) / m : mean;
    }
    default:
      return rng.lognormal(mean, cv);
  }
}

// ---------- ajuste de curva a partir de tempos medidos ----------

export interface FitResult {
  kind: DistKind;
  /** Média e cv que vão para o posto; min/max quando a curva usa limites. */
  mean: number;
  cv: number;
  min?: number;
  max?: number;
  /** Maior distância entre a curva e os dados (Kolmogorov-Smirnov): menor = melhor. */
  ks: number;
  /** A curva passa no teste KS a 95% (D < 1,36/√n). */
  ok: boolean;
}

export interface Fit {
  n: number;
  mean: number;
  sd: number;
  cv: number;
  min: number;
  max: number;
  /** Curvas da melhor para a pior. */
  ranking: FitResult[];
  /** Histograma: início de cada faixa, largura e contagens. */
  bins: { start: number; width: number; counts: number[] };
}

// função erro (Abramowitz-Stegun 7.1.26), suficiente para o teste KS
function erf(x: number): number {
  const s = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Função acumulada de cada curva com média `m`, desvio `sd` e limites a..b. */
export function cdf(kind: DistKind, x: number, m: number, sd: number, a: number, b: number): number {
  switch (kind) {
    case 'normal':
      return sd > 0 ? phi((x - m) / sd) : +(x >= m);
    case 'lognormal': {
      if (x <= 0) return 0;
      const s2 = Math.log(1 + (sd / m) ** 2);
      return s2 > 0 ? phi((Math.log(x) - (Math.log(m) - s2 / 2)) / Math.sqrt(s2)) : +(x >= m);
    }
    case 'uniform':
      return b > a ? Math.min(1, Math.max(0, (x - a) / (b - a))) : +(x >= a);
    case 'triangular': {
      if (x <= a) return 0;
      if (x >= b) return 1;
      const c = triMode(m, a, b);
      return x <= c ? ((x - a) ** 2) / ((b - a) * (c - a || 1e-9)) : 1 - ((b - x) ** 2) / ((b - a) * (b - c || 1e-9));
    }
    case 'exponential':
      return x <= 0 ? 0 : 1 - Math.exp(-x / m);
    default:
      return +(x >= m);
  }
}

/** Densidade (para desenhar a curva sobre o histograma). */
export function pdf(kind: DistKind, x: number, m: number, sd: number, a: number, b: number): number {
  const h = Math.max(1e-6, (b - a) / 400, sd / 50);
  return (cdf(kind, x + h, m, sd, a, b) - cdf(kind, x - h, m, sd, a, b)) / (2 * h);
}

/** Ajusta normal, lognormal, triangular, uniforme e exponencial aos tempos e ordena pelo KS. */
export function fitTimes(raw: number[]): Fit | null {
  const xs = raw.filter((x) => Number.isFinite(x) && x > 0).sort((p, q) => p - q);
  const n = xs.length;
  if (n < 3) return null;
  const mean = avg(xs);
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  const min = xs[0];
  const max = xs[n - 1];
  // limites da triangular e uniforme um pouco além do medido (o menor e o maior raramente são os extremos reais)
  const pad = (max - min) / Math.max(1, n - 1);
  const a = Math.max(0, min - pad);
  const b = max + pad;
  const ks = (kind: DistKind, lo: number, hi: number) => {
    let d = 0;
    xs.forEach((x, i) => {
      const f = cdf(kind, x, mean, sd, lo, hi);
      d = Math.max(d, Math.abs(f - i / n), Math.abs((i + 1) / n - f));
    });
    return d;
  };
  const crit = 1.36 / Math.sqrt(n);
  const cv = mean > 0 ? sd / mean : 0;
  const cand: FitResult[] = [
    { kind: 'normal', mean, cv, ks: ks('normal', a, b), ok: false },
    { kind: 'lognormal', mean, cv, ks: ks('lognormal', a, b), ok: false },
    { kind: 'triangular', mean, cv, min: a, max: b, ks: ks('triangular', a, b), ok: false },
    { kind: 'uniform', mean, cv, min: a, max: b, ks: ks('uniform', a, b), ok: false },
    { kind: 'exponential', mean, cv: 1, ks: ks('exponential', a, b), ok: false },
  ];
  // triangular com moda fora de [a, b] não mantém a média: fica no fim da lista
  for (const c of cand) {
    if (c.kind === 'triangular' && Math.abs(3 * mean - a - b - triMode(mean, a, b)) > 1e-6) c.ks = Math.max(c.ks, 1);
    c.ok = c.ks < crit;
  }
  cand.sort((p, q) => p.ks - q.ks);
  const k = Math.min(30, Math.max(5, Math.ceil(Math.sqrt(n))));
  const width = (max - min) / k || 1;
  const counts = new Array(k).fill(0);
  for (const x of xs) counts[Math.min(k - 1, Math.floor((x - min) / width))]++;
  return { n, mean, sd, cv, min, max, ranking: cand, bins: { start: min, width, counts } };
}

/** Converte o resultado escolhido na curva do posto (empírica guarda até 500 tempos). */
export function toDist(r: FitResult | 'empirical', xs: number[]): TimeDist {
  if (r === 'empirical') return { kind: 'empirical', samples: xs.filter((x) => x > 0).slice(0, 500).map((x) => Math.round(x * 100) / 100) };
  const round = (v?: number) => (v === undefined ? undefined : Math.round(v * 100) / 100);
  return r.kind === 'triangular' || r.kind === 'uniform' ? { kind: r.kind, min: round(r.min), max: round(r.max) } : { kind: r.kind };
}

/** Lê tempos colados (Excel, uma coluna, separados por espaço, ; ou quebra de linha; aceita vírgula decimal). */
export function parseTimes(text: string): number[] {
  return text
    .split(/[\s;\t]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const hms = /^(\d+):(\d{2})(?:[.,](\d+))?$/.exec(t);
      if (hms) return Number(hms[1]) * 60 + Number(hms[2]) + (hms[3] ? Number(`0.${hms[3]}`) : 0);
      return Number(t.replace(',', '.'));
    })
    .filter((x) => Number.isFinite(x) && x > 0);
}
