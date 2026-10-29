// IA explicável (Sprint 8): sugestões de melhoria com a evidência de cada uma,
// balanceamento de linha, otimização de layout e simulação automática de cenários.

import { footprint, spaghetti } from './analytics';
import { steadyUph } from './calibrate';
import { lineKpi, type LineKpi } from './metrics';
import type { NodeRt, Simulator } from './simulator';
import type { Model, NodeDef } from './types';

export type Action =
  | { kind: 'capacity'; nodeId: string; delta: number }
  | { kind: 'queue'; nodeId: string; value: number }
  | { kind: 'pool'; poolId: string; delta: number }
  | { kind: 'move'; nodeId: string; x: number; y: number };

export interface Suggestion {
  id: string;
  area: 'Gargalo' | 'Balanceamento' | 'Fluxo' | 'Pessoas' | 'Transporte' | 'Layout' | 'Energia' | 'Qualidade';
  title: string;
  evidence: string;
  impact: string;
  action?: Action;
  /** Resultado da simulação automática (pç/h a mais), quando avaliado. */
  gain?: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const s1 = (v: number) => v.toFixed(1).replace('.', ',');

export function applyAction(model: Model, a: Action): Model {
  const m = structuredClone(model);
  if (a.kind === 'capacity' || a.kind === 'queue') {
    const n = m.nodes.find((x) => x.id === a.nodeId);
    if (n) {
      if (a.kind === 'capacity') {
        n.capacity += a.delta;
        n.operators += a.delta;
      } else n.queueCap = a.value;
    }
  } else if (a.kind === 'pool') {
    const p = m.pools?.find((x) => x.id === a.poolId);
    if (p) p.count = Math.max(1, p.count + a.delta);
  } else {
    const n = m.nodes.find((x) => x.id === a.nodeId);
    if (n) Object.assign(n, { x: a.x, y: a.y });
  }
  return m;
}

export function describeAction(model: Model, a: Action): string {
  const name = (id: string) => model.nodes.find((n) => n.id === id)?.name ?? id;
  switch (a.kind) {
    case 'capacity':
      return `+${a.delta} posto/operador em ${name(a.nodeId)}`;
    case 'queue':
      return `buffer de ${a.value} em ${name(a.nodeId)}`;
    case 'pool':
      return `${a.delta > 0 ? '+' : ''}${a.delta} em ${model.pools?.find((p) => p.id === a.poolId)?.name ?? a.poolId}`;
    case 'move':
      return `mover ${name(a.nodeId)}`;
  }
}

const isStation = (d: NodeDef) => d.type === 'machine' || d.type === 'inspection';

/** Eficiência de balanceamento: soma dos tempos efetivos / (postos × maior tempo). */
export function lineBalance(model: Model) {
  const st = model.nodes.filter((d) => isStation(d) && d.cycleTime > 0 && !d.fixedTime && !(d.batchSize && d.batchSize > 1));
  const eff = st.map((d) => ({ d, ct: d.cycleTime / Math.max(1, d.capacity) }));
  const max = Math.max(1e-9, ...eff.map((e) => e.ct));
  const sum = eff.reduce((a, e) => a + e.ct, 0);
  return { efficiency: eff.length ? sum / (eff.length * max) : 1, max, stations: eff.sort((a, b) => b.ct - a.ct) };
}

export function suggest(model: Model, sim: Simulator, kpi: LineKpi): Suggestion[] {
  const out: Suggestion[] = [];
  const takt = model.settings.takt;
  const uphTarget = takt > 0 ? 3600 / takt : 0;
  const def = new Map(model.nodes.map((n) => [n.id, n]));
  const elapsed = Math.max(1, kpi.elapsed);

  // 1. Gargalos (período ativo). Vários postos no limite juntos: aliviar só um não adianta.
  const tied = kpi.ranking.filter((r) => r.active >= (kpi.ranking[0]?.active ?? 1) - 0.03 && r.active > 0.9);
  if (tied.length > 2)
    out.push({
      id: 'tied',
      area: 'Gargalo',
      title: `${tied.length} postos no limite ao mesmo tempo`,
      evidence: `${tied.map((r) => r.name).join(', ')} estão ativos mais de ${pct(tied[tied.length - 1].active)} do tempo.`,
      impact: 'Aliviar só um deles não aumenta a produção: é preciso tirar tempo de todos (rebalancear) ou baixar o takt.',
    });
  for (const r of kpi.ranking.slice(0, 3)) {
    const d = def.get(r.id);
    if (!d || r.active < 0.85) continue;
    const ct = d.cycleTime / Math.max(1, d.capacity);
    out.push({
      id: `bn-${d.id}`,
      area: 'Gargalo',
      title: `${d.name} limita a linha`,
      evidence: `Ativo ${pct(r.active)} do tempo; ${s1(ct)} s por peça para um takt de ${s1(takt)} s.`,
      impact: ct > takt * 0.9 ? `Tirar ${s1(ct - takt * 0.85)} s deste posto (dividir tarefa ou mais um operador) libera a linha.` : 'Proteger com buffer antes e depois e atacar microparadas.',
      action: { kind: 'capacity', nodeId: d.id, delta: 1 },
    });
  }

  // 2. Balanceamento.
  const lb = lineBalance(model);
  if (lb.efficiency < 0.85 && lb.stations.length > 2) {
    const top = lb.stations[0];
    const low = lb.stations[lb.stations.length - 1];
    out.push({
      id: 'balance',
      area: 'Balanceamento',
      title: `Balanceamento da linha em ${pct(lb.efficiency)}`,
      evidence: `Posto mais carregado: ${top.d.name} (${s1(top.ct)} s); mais leve: ${low.d.name} (${s1(low.ct)} s).`,
      impact: 'Mover tarefas dos postos mais carregados para os mais leves (yamazumi) reduz o tempo do gargalo sem pessoas a mais.',
    });
  }

  // 3. Bloqueio e falta de peça (buffers).
  const feeders = feederSet(sim);
  for (const k of kpi.nodes) {
    const d = def.get(k.id);
    const rt = sim.byId.get(k.id);
    // Submontagens bloqueadas com o kanban cheio é o esperado: só fluxo principal entra aqui.
    if (!d || !isStation(d) || !rt || feeders.has(rt)) continue;
    const blocked = k.states.blocked / elapsed;
    if (blocked > 0.2 && d.queueCap < 3) {
      out.push({
        id: `blk-${d.id}`,
        area: 'Fluxo',
        title: `${d.name} fica bloqueado ${pct(blocked)} do tempo`,
        evidence: 'A peça pronta não tem para onde ir: o posto seguinte está cheio.',
        impact: 'Buffer maior depois do posto, ou atacar o posto seguinte.',
        action: { kind: 'queue', nodeId: (sim.byId.get(d.id)?.out[0]?.to.def.id ?? d.id), value: 3 },
      });
    }
  }

  // 4. Pessoas e veículos.
  for (const p of kpi.pools) {
    if (p.utilization > 0.85)
      out.push({
        id: `pool-${p.id}`,
        area: p.kind === 'operator' ? 'Pessoas' : 'Transporte',
        title: `${p.name} em sobrecarga (${pct(p.utilization)})`,
        evidence: `${p.count} unidade(s), ${p.waiting} pedido(s) esperando agora.`,
        impact: 'Mais uma unidade ou reduzir o tempo de carga/descarga.',
        action: { kind: 'pool', poolId: p.id, delta: 1 },
      });
    else if (p.kind === 'operator' && p.utilization < 0.4 && p.count > 1)
      out.push({
        id: `idle-${p.id}`,
        area: 'Pessoas',
        title: `${p.name} ociosos (${pct(p.utilization)})`,
        evidence: `${p.count} pessoas para a carga atual.`,
        impact: `Dá para atender com ${Math.max(1, Math.ceil(p.count * p.utilization / 0.75))} pessoa(s) ou acumular outra função.`,
        action: { kind: 'pool', poolId: p.id, delta: -1 },
      });
  }
  for (const k of kpi.nodes) {
    const d = def.get(k.id);
    if (!d || !isStation(d) || d.poolId || d.operators < 2) continue;
    if (k.utilization < 0.5 && d.capacity > 1 && d.cycleTime / (d.capacity - 1) < takt * 0.85)
      out.push({
        id: `crew-${d.id}`,
        area: 'Pessoas',
        title: `${d.name}: ${d.operators} operadores com ${pct(k.utilization)} de ocupação`,
        evidence: `Tempo de ${s1(d.cycleTime)} s em ${d.capacity} postos.`,
        impact: 'Juntar postos ou dividir o trabalho de outro jeito libera uma pessoa.',
        action: { kind: 'capacity', nodeId: d.id, delta: -1 },
      });
  }

  // 5. Spaghetti e layout.
  const sp = spaghetti(sim, kpi);
  const back = sp.legs.filter((l) => (l.backtrack || l.against) && l.moved > 0).slice(0, 2);
  for (const l of back)
    out.push({
      id: `back-${l.id}`,
      area: 'Layout',
      title: `Fluxo de volta: ${l.from} → ${l.to}`,
      evidence: `${s1(l.distance)} m × ${l.moved} viagens = ${Math.round(l.meters)} m no turno.`,
      impact: 'Aproximar os postos ou levar o recurso até a peça reduz movimento sem valor.',
    });
  for (const m of layoutMoves(model, sim).slice(0, 2))
    out.push({
      id: `move-${m.nodeId}`,
      area: 'Layout',
      title: `Mover ${m.name} para perto dos postos que o abastecem`,
      evidence: `Economia estimada de ${Math.round(m.saving)} m de transporte por turno.`,
      impact: 'Menos tempo em deslocamento e menos cruzamentos.',
      action: { kind: 'move', nodeId: m.nodeId, x: m.x, y: m.y },
    });

  // 6. Energia e qualidade.
  const fp = footprint(sim, kpi);
  if (fp.energy.kWh > 0 && 1 - fp.energy.efficiency > 0.3)
    out.push({
      id: 'idle-energy',
      area: 'Energia',
      title: `${pct(1 - fp.energy.efficiency)} da energia é gasta com o equipamento parado`,
      evidence: `${s1(fp.energy.kWhIdle)} kWh em espera de ${s1(fp.energy.kWh)} kWh.`,
      impact: 'Modo de espera automático (standby) nos testadores e esteiras quando não há peça.',
    });
  if (kpi.firstPassYield < 0.98)
    out.push({
      id: 'fpy',
      area: 'Qualidade',
      title: `Yield de primeira passada em ${pct(kpi.firstPassYield)}`,
      evidence: 'Peças voltam para reparo e ocupam o teste de novo.',
      impact: 'Pareto das falhas do teste e poka-yoke nos postos de origem.',
    });
  if (uphTarget > 0 && kpi.completed > 0 && kpi.throughputPerHour < uphTarget * 0.98)
    out.unshift({
      id: 'target',
      area: 'Gargalo',
      title: `Linha a ${s1(kpi.throughputPerHour)} pç/h para uma meta de ${s1(uphTarget)}`,
      evidence: `Faltam ${s1(uphTarget - kpi.throughputPerHour)} pç/h. Gargalo atual: ${kpi.ranking[0]?.name ?? '–'}.`,
      impact: 'Use a simulação automática abaixo para medir o ganho de cada ação.',
    });
  return out;
}

/** Nós de submontagem: todo caminho a jusante termina num link de componente (kanban). */
function feederSet(sim: Simulator) {
  const memo = new Map<NodeRt, boolean>();
  const isFeeder = (n: NodeRt, depth = 0): boolean => {
    if (memo.has(n)) return memo.get(n)!;
    memo.set(n, false);
    const r = depth < 40 && n.out.length > 0 && n.out.every((l) => l.isPart || isFeeder(l.to, depth + 1));
    memo.set(n, r);
    return r;
  };
  return new Set(sim.nodes.filter((n) => isFeeder(n)));
}

/** Posição ideal de cada nó: centro ponderado pelo fluxo dos vizinhos. */
export function layoutMoves(model: Model, sim: Simulator) {
  const res: { nodeId: string; name: string; x: number; y: number; saving: number }[] = [];
  for (const n of sim.nodes) {
    if (n.def.type === 'source' || n.def.type === 'sink') continue;
    const legs = [...n.out, ...n.inLinks].filter((l) => l.moved > 0 && !l.def.length);
    const w = legs.reduce((a, l) => a + l.moved, 0);
    if (legs.length < 2 || w === 0) continue;
    const other = (l: (typeof legs)[number]) => (l.from === n ? l.to : l.from).def;
    const x = legs.reduce((a, l) => a + other(l).x * l.moved, 0) / w;
    const y = legs.reduce((a, l) => a + other(l).y * l.moved, 0) / w;
    const dist = (px: number, py: number) => legs.reduce((a, l) => a + (Math.hypot(other(l).x - px, other(l).y - py) / sim.ppm) * l.moved, 0);
    const saving = dist(n.def.x, n.def.y) - dist(x, y);
    if (saving > 50) res.push({ nodeId: n.def.id, name: n.def.name, x: Math.round(x), y: Math.round(y + 50), saving });
  }
  void model;
  return res.sort((a, b) => b.saving - a.saving);
}

/** Simulação automática: mede o ganho de UPH de cada ação em regime (linha cheia). */
export function evaluate(model: Model, suggestions: Suggestion[], max = 6): Suggestion[] {
  const todo = suggestions.filter((s) => s.action && s.action.kind !== 'move').slice(0, max);
  for (const s of todo) evaluateOne(model, s);
  return suggestions;
}

/** UPH médio em regime com duas sementes (reduz o ruído da comparação). */
export function robustUph(model: Model): number {
  const seed = model.settings.seed;
  const a = steadyUph({ ...model, settings: { ...model.settings, seed } }, 6);
  const b = steadyUph({ ...model, settings: { ...model.settings, seed: seed + 101 } }, 6);
  return (a + b) / 2;
}

const baseCache = new WeakMap<Model, number>();
export function evaluateOne(model: Model, s: Suggestion): Suggestion {
  if (!s.action || s.action.kind === 'move') return s;
  let base = baseCache.get(model);
  if (base === undefined) baseCache.set(model, (base = robustUph(model)));
  s.gain = robustUph(applyAction(model, s.action)) - base;
  return s;
}

/** Resumo compacto do estado da linha para o assistente de IA. */
export function digest(model: Model, sim: Simulator, kpi: LineKpi = lineKpi(sim)): string {
  const fp = footprint(sim, kpi);
  const sp = spaghetti(sim, kpi);
  const lb = lineBalance(model);
  const lines = [
    `Modelo: ${model.name}. Takt ${model.settings.takt} s (meta ${(3600 / (model.settings.takt || 1)).toFixed(1)} pç/h).`,
    `Produção ${kpi.completed} pç em ${(kpi.elapsed / 3600).toFixed(1)} h = ${kpi.throughputPerHour.toFixed(1)} pç/h. Lead time ${(kpi.leadTime / 60).toFixed(1)} min. Total cycle time ${(kpi.totalCycleTime / 60).toFixed(1)} min. WIP médio ${kpi.avgWip.toFixed(0)}. FPY ${(kpi.firstPassYield * 100).toFixed(1)}%. OEE ${(kpi.oee * 100).toFixed(0)}%.`,
    `Balanceamento ${(lb.efficiency * 100).toFixed(0)}%. Top 5 gargalos: ${kpi.ranking.slice(0, 5).map((r) => `${r.name} ${(r.active * 100).toFixed(0)}%`).join(', ')}.`,
    `Postos (nome: tempo s / capacidade / utilização / bloqueado / sem peça):`,
    ...kpi.nodes
      .filter((k) => k.type === 'machine' || k.type === 'inspection')
      .map((k) => {
        const d = model.nodes.find((n) => n.id === k.id)!;
        const e = Math.max(1, kpi.elapsed);
        return `- ${k.name}: ${d.cycleTime}/${d.capacity}/${(k.utilization * 100).toFixed(0)}%/${((k.states.blocked / e) * 100).toFixed(0)}%/${((k.states.starved / e) * 100).toFixed(0)}%`;
      }),
    `Recursos: ${kpi.pools.map((p) => `${p.name} ${p.count}× ${(p.utilization * 100).toFixed(0)}%`).join(', ') || 'nenhum'}.`,
    `Movimentação: material ${Math.round(sp.materialMeters)} m, operadores ${Math.round(sp.operatorMeters)} m, veículos ${Math.round(sp.vehicleMeters)} m, ${sp.crossings} cruzamentos.`,
    `Custo R$ ${fp.cost.perUnit.toFixed(2)}/pç, energia ${fp.energy.perUnit.toFixed(3)} kWh/pç (${((1 - fp.energy.efficiency) * 100).toFixed(0)}% em espera), CO2e ${(fp.co2.perUnit * 1000).toFixed(0)} g/pç.`,
  ];
  return lines.join('\n');
}
