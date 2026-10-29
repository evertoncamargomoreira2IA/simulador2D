// Balanceamento automático: redistribui as atividades entre os postos, na ordem em que
// acontecem, para caber no takt com o menor número de postos (e de pessoas).
//
// Premissa: a sequência das atividades é a precedência (uma atividade não passa à frente
// da anterior). Com a ordem fixa, encher cada posto até o limite dá o menor número de
// postos; depois uma busca binária acha o menor teto que ainda cabe nesse número, o que
// deixa a carga o mais igual possível entre eles.

import type { Activity, Operation } from './types';

export interface BalanceStation {
  id: string;
  ops: Operation[];
  /** Eficiência do posto (0-1): o tempo real é a soma ÷ eficiência. */
  efficiency?: number;
}

export interface AutoBalanceResult {
  /** Operações novas por posto (posto vazio = sai da linha). */
  draft: Record<string, Operation[]>;
  /** Postos que ficaram com trabalho. */
  used: number;
  /** Postos necessários no takt (pode passar dos existentes). */
  needed: number;
  /** Maior carga (s, já com a eficiência). */
  maxLoad: number;
  /** Atividades maiores que o takt sozinhas (não cabem em posto nenhum). */
  tooLong: string[];
}

interface Item {
  a: Activity;
  op: string;
}

/** Quantos postos a sequência precisa com o teto `cap` por posto (limites = cap × eficiência). */
function pack(items: Item[], limits: number[], cap: number, minUsed = 0): number[][] | null {
  const out: number[][] = [];
  let i = 0;
  for (let s = 0; s < limits.length && i < items.length; s++) {
    const lim = cap * limits[s];
    const cur: number[] = [];
    let sum = 0;
    // deixa trabalho para os postos que faltam quando for preciso usar pelo menos minUsed
    while (i < items.length && (cur.length === 0 || sum + items[i].a.time <= lim + 1e-9)) {
      if (cur.length > 0 && items.length - i <= minUsed - out.length - 1) break;
      sum += items[i].a.time;
      cur.push(i++);
    }
    out.push(cur);
  }
  return i < items.length ? null : out;
}

export function autoBalance(stations: BalanceStation[], takt: number): AutoBalanceResult {
  const items: Item[] = stations.flatMap((s) => s.ops.flatMap((o) => o.activities.map((a) => ({ a, op: o.name }))));
  const eff = stations.map((s) => (s.efficiency && s.efficiency > 0 ? s.efficiency : 1));
  const total = items.reduce((s, x) => s + x.a.time, 0);
  const tooLong = takt > 0 ? items.filter((x) => x.a.time > takt).map((x) => x.a.name) : [];
  const empty: AutoBalanceResult = { draft: Object.fromEntries(stations.map((s) => [s.id, s.ops])), used: 0, needed: 0, maxLoad: 0, tooLong };
  if (!items.length || !(takt > 0)) return empty;

  // postos necessários com a mesma eficiência média, mesmo que faltem postos
  const avgEff = eff.reduce((a, b) => a + b, 0) / eff.length;
  const virtualLimits = Array.from({ length: items.length }, () => avgEff);
  const needed = pack(items, virtualLimits, takt)?.filter((s) => s.length).length ?? items.length;

  // com os postos existentes: menor teto que cabe; se nem no takt cabe, aceita passar do takt
  let lo = Math.max(...items.map((x) => x.a.time / Math.max(...eff)), total / eff.reduce((a, b) => a + b, 0));
  let hi = Math.max(takt, total / Math.min(...eff));
  const fitsTakt = !!pack(items, eff, takt);
  const target = fitsTakt ? Math.min(stations.length, needed) : stations.length;
  // primeiro garante o número mínimo de postos no takt, depois iguala as cargas
  const ok = (cap: number) => {
    const p = pack(items, eff, cap, target);
    return !!p && p.filter((s) => s.length).length <= target;
  };
  if (!ok(hi)) hi = total;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  const plan = pack(items, eff, hi, target) ?? [];
  const draft: Record<string, Operation[]> = {};
  let maxLoad = 0;
  stations.forEach((s, k) => {
    const idx = plan[k] ?? [];
    const ops: Operation[] = [];
    for (const i of idx) {
      const last = ops[ops.length - 1];
      if (last && last.name === items[i].op) last.activities.push({ ...items[i].a });
      else ops.push({ name: items[i].op, activities: [{ ...items[i].a }] });
    }
    draft[s.id] = ops;
    maxLoad = Math.max(maxLoad, idx.reduce((a, i) => a + items[i].a.time, 0) / eff[k]);
  });
  return { draft, used: plan.filter((p) => p.length).length, needed, maxLoad, tooLong };
}
