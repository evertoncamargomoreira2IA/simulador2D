// Carga por posto (cycle time × takt): ordem do fluxo, fração de peças e lote por posto.

import type { LineKpi } from './metrics';
import { baseCycle, type Model, type NodeDef } from './types';

export interface CtRow {
  id: string;
  name: string;
  /** Carga planejada por peça da linha: (tempo da giga ÷ gigas) × fração das peças que passam ÷ peças por carga. */
  plan: number;
  /** Tempo da giga ÷ gigas, sem descontar amostra, yield ou lote. */
  raw: number;
  /** Fração das peças da linha que passa pelo posto (1 = todas; 0,1 = amostra de 10%). */
  share: number;
  /** Peças por carga que chegam ao posto (carrinho, pallet). */
  load: number;
  /** Medido na simulação: tempo ocupado (por giga) ÷ peças produzidas na linha. */
  real?: number;
  offline: boolean;
}

/** Postos na ordem do fluxo (busca em largura a partir das entradas). Off-lines = alimentam montagem. */
export function cycleRows(model: Model, kpi?: LineKpi): CtRow[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const order: NodeDef[] = [];
  const rank = new Map<string, number>();
  const queue = model.nodes.filter((n) => n.type === 'source').map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (rank.has(id)) continue;
    rank.set(id, order.length);
    const n = byId.get(id);
    if (n) order.push(n);
    for (const l of model.links) if (l.from === id && !rank.has(l.to)) queue.push(l.to);
  }
  for (const n of model.nodes) if (!rank.has(n.id)) (rank.set(n.id, order.length), order.push(n));

  const detour = (l: Model['links'][number]) =>
    !!l.once || byId.get(l.to)?.type === 'rework' || model.links.some((o) => o.from === l.to && rank.get(o.to)! <= rank.get(l.from)!);
  // Fração das peças e tamanho da carga, propagados na ordem do fluxo (ligações de volta não contam).
  const share = new Map<string, number>();
  const load = new Map<string, number>();
  for (const n of order) {
    const ins = model.links.filter((l) => l.to === n.id && rank.get(l.from)! < rank.get(n.id)!);
    let f = n.type === 'source' ? 1 : 0;
    let ld = 1;
    for (const l of ins) {
      // Desvio (amostra "uma vez", reparo, laço que volta): leva só a sua fração e não tira peças do caminho principal.
      const outs = model.links.filter((o) => o.from === l.from && (o.role ?? 'flow') === (l.role ?? 'flow') && rank.get(o.to)! > rank.get(l.from)!);
      const main = outs.filter((o) => !detour(o));
      const pool = detour(l) ? outs : main;
      const tot = pool.reduce((s, o) => s + o.weight, 0) || 1;
      f += (share.get(l.from) ?? 0) * (l.role === 'part' ? 1 : l.weight / tot);
      const up = byId.get(l.from)!;
      ld = Math.max(ld, up.batchSize && up.batchSize > 1 ? up.batchSize : load.get(l.from) ?? 1);
    }
    share.set(n.id, Math.min(1, f));
    load.set(n.id, n.batchSize && n.batchSize > 1 ? n.batchSize : ld);
  }

  const feeders = new Set<string>();
  const mark = (id: string) => {
    if (feeders.has(id)) return;
    feeders.add(id);
    for (const l of model.links) if (l.to === id) mark(l.from);
  };
  for (const l of model.links) if (l.role === 'part') mark(l.from);
  const elapsed = Math.max(1, kpi?.elapsed ?? 0);
  return order
    .filter((n) => (n.type === 'machine' || n.type === 'inspection' || n.type === 'rework') && baseCycle(n, model.settings) > 0)
    .map((n) => {
      const k = kpi?.nodes.find((x) => x.id === n.id);
      const raw = baseCycle(n, model.settings) / (n.efficiency || 1) / Math.max(1, n.capacity);
      const sh = share.get(n.id) ?? 1;
      const ld = load.get(n.id) ?? 1;
      // ao vivo: tempo ocupado por carga processada, convertido para "por peça da linha"
      const real = k && k.processed > 0 ? ((k.utilization * elapsed) / k.processed) * (sh / ld) : undefined;
      return { id: n.id, name: n.name, raw, share: sh, load: ld, plan: (raw * sh) / ld, real, offline: feeders.has(n.id) };
    });
}

/**
 * Takt usado nos cálculos: o informado (ou vindo da Meta UPH) ou, se estiver zerado,
 * a maior carga planejada da linha principal (o gargalo).
 */
export function effectiveTakt(model: Model): number {
  if (model.settings.takt > 0) return model.settings.takt;
  const main = cycleRows(model).filter((r) => !r.offline);
  return main.length ? Math.round(Math.max(...main.map((r) => r.plan)) * 100) / 100 : 0;
}
