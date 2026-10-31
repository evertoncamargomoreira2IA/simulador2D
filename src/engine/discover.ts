// Monta a linha a partir das leituras dos postos: seguindo cada número de série de posto em posto,
// descobre os postos, a ordem (setas e quanto passa por cada uma), as gigas, os tempos e o mix.
// O que as leituras não dizem (posição na planta, pessoas, abastecimento) fica para ajustar depois.

import { fitTimes, toDist } from './dist';
import { splitOutliers, type RealEvent } from './timeStudy';
import { DEFAULT_SETTINGS, makeNode, MANUAL_PATCH, type LinkDef, type Model, type NodeDef, type ProductDef } from './types';

const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const COLORS = ['#22d3ee', '#e8913a', '#a78bfa', '#4ade80', '#f472b6', '#facc15'];

export interface DiscoveredStation {
  name: string;
  /** Posição média na rota das peças (0 = primeiro posto). */
  rank: number;
  pieces: number;
  mean: number;
  cv: number;
  /** Gigas: peças ao mesmo tempo no posto (percentil 90). */
  capacity: number;
  /** Espera média antes do posto (s) e fila sugerida. */
  wait: number;
  queue: number;
}

export interface Discovery {
  model: Model;
  stations: DiscoveredStation[];
  /** Setas descobertas: de → para, peças que passaram. */
  flows: { from: string; to: string; count: number }[];
  serials: number;
  uph: number;
  products: { name: string; share: number }[];
  /** Avisos para conferir (rotas raras ignoradas, retrabalho, nomes). */
  notes: string[];
}

/** Monta o modelo a partir das leituras. Rotas usadas por menos de `minShare` das peças de um posto são ignoradas. */
export function discoverLine(events: RealEvent[], name = 'Linha montada das leituras', minShare = 0.03): Discovery | null {
  // 1) agrupa por série: cada peça passa pelos postos em ordem de início
  const label = new Map<string, string>();
  const bySerial = new Map<string, Map<string, { a: number; b: number; modelo?: string }>>();
  for (const e of events) {
    if (!(e.fim >= e.inicio)) continue;
    const k = key(e.posto);
    if (!label.has(k)) label.set(k, e.posto);
    let m = bySerial.get(e.serie);
    if (!m) bySerial.set(e.serie, (m = new Map()));
    const c = m.get(k);
    if (c) {
      c.a = Math.min(c.a, e.inicio);
      c.b = Math.max(c.b, e.fim);
    } else m.set(k, { a: e.inicio, b: e.fim, modelo: e.modelo });
  }
  if (label.size < 1 || bySerial.size < 3) return null;

  // 2) rotas: posição de cada posto na rota e transições entre postos
  const rankSum = new Map<string, number[]>();
  const trans = new Map<string, number>();
  const firsts = new Map<string, number>();
  const lasts = new Map<string, number>();
  const gaps = new Map<string, number[]>();
  const modelOf = new Map<string, string>();
  for (const [serie, m] of bySerial) {
    const path = [...m.entries()].sort((p, q) => p[1].a - q[1].a);
    path.forEach(([k, v], i) => {
      (rankSum.get(k) ?? rankSum.set(k, []).get(k)!).push(i / Math.max(1, path.length - 1));
      if (v.modelo) modelOf.set(serie, v.modelo);
      if (i > 0) {
        const [pk, pv] = path.at(i - 1)!;
        const t = `${pk}>${k}`;
        trans.set(t, (trans.get(t) ?? 0) + 1);
        (gaps.get(k) ?? gaps.set(k, []).get(k)!).push(Math.max(0, v.a - pv.b));
      }
    });
    firsts.set(path[0][0], (firsts.get(path[0][0]) ?? 0) + 1);
    const last = path.at(-1)![0];
    lasts.set(last, (lasts.get(last) ?? 0) + 1);
  }
  const notes: string[] = [];
  const out = new Map<string, number>();
  for (const [t, c] of trans) out.set(t.split('>')[0], (out.get(t.split('>')[0]) ?? 0) + c);
  const flows: Discovery['flows'] = [];
  let dropped = 0;
  for (const [t, c] of trans) {
    const [a, b] = t.split('>');
    if (c < Math.max(2, minShare * (out.get(a) ?? 0))) {
      dropped += c;
      continue;
    }
    flows.push({ from: a, to: b, count: c });
  }
  if (dropped) notes.push(`${dropped} passagens raras (menos de ${Math.round(minShare * 100)}% das peças do posto) foram ignoradas: podem ser retrabalho ou leitura fora de ordem.`);

  // 3) postos: tempo, variação, gigas e espera
  const span = { a: Infinity, b: -Infinity };
  const stations: DiscoveredStation[] = [...label.keys()].map((k) => {
    const iv: { a: number; b: number; modelo?: string }[] = [];
    for (const m of bySerial.values()) {
      const v = m.get(k);
      if (v) iv.push(v);
    }
    for (const v of iv) [span.a, span.b] = [Math.min(span.a, v.a), Math.max(span.b, v.b)];
    const { kept } = splitOutliers(
      iv.map((v) => v.b - v.a),
      2,
    );
    // gigas: quantas peças estavam no posto quando cada uma entrou (percentil 90)
    // (sem as leituras discrepantes: uma parada longa sobrepõe a peça seguinte e inventaria uma giga)
    const hiKept = kept.length ? Math.max(...kept) : Infinity;
    const ok = iv.filter((v) => v.b - v.a <= hiKept + 1e-9);
    const starts = ok.map((v) => v.a).sort((p, q) => p - q);
    const ends = ok.map((v) => v.b).sort((p, q) => p - q);
    const conc: number[] = [];
    let j = 0;
    starts.forEach((s, i) => {
      while (j < ends.length && ends[j] <= s + 1e-6) j++;
      conc.push(i + 1 - j);
    });
    const mean = avg(kept);
    const w = gaps.get(k) ?? [];
    return {
      name: label.get(k)!,
      rank: avg(rankSum.get(k) ?? [0]),
      pieces: iv.length,
      mean,
      cv: mean > 0 ? sd(kept) / mean : 0,
      capacity: Math.max(1, Math.round(quantile(conc, 0.9))),
      wait: avg(w),
      queue: 0,
    };
  });
  const hours = Math.max(1e-6, (span.b - span.a) / 3600);
  for (const s of stations) {
    // fila sugerida pela lei de Little: peças por segundo × espera média
    const rate = s.pieces / (hours * 3600);
    s.queue = Math.min(50, Math.max(3, Math.ceil(rate * s.wait)));
  }
  stations.sort((p, q) => p.rank - q.rank);

  // 4) mix de modelos
  const mixCount = new Map<string, number>();
  for (const v of modelOf.values()) mixCount.set(v, (mixCount.get(v) ?? 0) + 1);
  const products: ProductDef[] = [...mixCount.entries()]
    .sort((p, q) => q[1] - p[1])
    .map(([n, c], i) => ({ id: key(n) || `p${i + 1}`, name: n, color: COLORS[i % COLORS.length], share: Math.round((c / Math.max(1, modelOf.size)) * 1000) / 10, factor: 1 }));

  // 5) modelo: colunas pela posição na rota; postos na mesma coluna ficam em paralelo, um embaixo do outro
  const cols: string[][] = [];
  for (const s of stations) {
    const k = key(s.name);
    const col = cols.find((c) => c.every((o) => !trans.has(`${o}>${k}`) && !trans.has(`${k}>${o}`)) && Math.abs(stations.find((x) => key(x.name) === c[0])!.rank - s.rank) < 0.06);
    if (col) col.push(k);
    else cols.push([k]);
  }
  const ids = new Map<string, string>();
  const nodes: NodeDef[] = [];
  const x0 = 260;
  const dx = 150;
  const yMid = 260;
  cols.forEach((col, ci) =>
    col.forEach((k, ri) => {
      const s = stations.find((x) => key(x.name) === k)!;
      const id = `D${nodes.length + 1}`;
      ids.set(k, id);
      // tempo por modelo quando difere mais de 3% da média do posto
      const productTimes: Record<string, number> = {};
      // variação dentro de cada modelo (a diferença entre modelos já vai no tempo por modelo)
      let cvSum = 0;
      let cvN = 0;
      for (const p of products) {
        const xs: number[] = [];
        for (const [serie, m] of bySerial) if (modelOf.get(serie) === p.name && m.get(k)) xs.push(m.get(k)!.b - m.get(k)!.a);
        const kp = splitOutliers(xs, 2).kept;
        const mm = avg(kp);
        if (kp.length >= 5 && mm > 0) [cvSum, cvN] = [cvSum + (sd(kp) / mm) * kp.length, cvN + kp.length];
        if (xs.length >= 5 && s.mean > 0 && Math.abs(mm / s.mean - 1) > 0.03) productTimes[p.id] = Math.round(mm * 10) / 10;
      }
      if (Object.keys(productTimes).length && cvN) s.cv = cvSum / cvN;
      // curva do tempo: a melhor pelo teste KS, quando passa e não é a lognormal padrão
      const xsAll: number[] = [];
      for (const m of bySerial.values()) if (m.get(k)) xsAll.push(m.get(k)!.b - m.get(k)!.a);
      const fit = xsAll.length >= 30 && !products.length ? fitTimes(splitOutliers(xsAll, 2).kept) : null;
      const best = fit?.ranking[0];
      nodes.push(
        makeNode(/inspe|teste|test|qc|cq/i.test(s.name) ? 'inspection' : 'machine', {
          ...MANUAL_PATCH,
          id,
          name: s.name,
          x: x0 + ci * dx,
          y: yMid + (ri - (col.length - 1) / 2) * 110,
          cycleTime: Math.round(s.mean * 10) / 10,
          cv: Math.round(s.cv * 100) / 100,
          capacity: s.capacity,
          operators: s.capacity,
          queueCap: s.queue,
          availability: 1,
          area: s.capacity > 1 ? { w: Math.min(140, 40 + 20 * s.capacity), h: 50 } : undefined,
          productTimes: Object.keys(productTimes).length ? productTimes : undefined,
          dist: best?.ok && best.kind !== 'lognormal' ? toDist(best, []) : undefined,
        }),
      );
    }),
  );
  const src = makeNode('source', { id: 'D0', name: 'Entrada', x: x0 - dx, y: yMid });
  const sink = makeNode('sink', { id: 'DS', name: 'Saída', x: x0 + cols.length * dx, y: yMid });
  const links: LinkDef[] = [];
  let li = 0;
  const link = (from: string, to: string, weight: number) => links.push({ id: `DL${++li}`, from, to, weight });
  for (const [k, c] of firsts) if (c >= Math.max(2, minShare * bySerial.size)) link(src.id, ids.get(k)!, c);
  for (const f of flows) link(ids.get(f.from)!, ids.get(f.to)!, f.count);
  for (const [k, c] of lasts) if (c >= Math.max(2, minShare * bySerial.size)) link(ids.get(k)!, sink.id, c);
  // posto sem saída (rota rara cortada) vai para a saída
  for (const n of nodes) if (!links.some((l) => l.from === n.id)) link(n.id, sink.id, 1);
  for (const n of nodes) if (!links.some((l) => l.to === n.id)) notes.push(`${n.name} ficou sem entrada: confira se o nome do posto está igual em todas as leituras.`);

  const finished = [...lasts.values()].reduce((a, b) => a + b, 0);
  const uph = finished / hours;
  const lastCol = cols.at(-1) ?? [];
  const model: Model = {
    name,
    nodes: [src, ...nodes, sink],
    links,
    pools: [],
    refStation: lastCol.length === 1 ? ids.get(lastCol[0]) : undefined,
    products: products.length > 1 ? products : undefined,
    settings: { ...DEFAULT_SETTINGS, takt: 0, startFull: true, warmup: 0 },
  };
  return {
    model,
    stations,
    flows: flows.map((f) => ({ from: label.get(f.from)!, to: label.get(f.to)!, count: f.count })),
    serials: bySerial.size,
    uph,
    products: products.map((p) => ({ name: p.name, share: p.share })),
    notes,
  };
}
