// Indicadores calculados a partir do estado do simulador.

import type { NodeRt, Simulator } from './simulator';
import type { NodeState, NodeType, PoolKind } from './types';

export interface NodeKpi {
  id: string;
  name: string;
  type: NodeType;
  state: NodeState;
  states: Record<NodeState, number>;
  utilization: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  processed: number;
  wip: number;
  failures: number;
  /** Tempo médio na fila de entrada (s). */
  avgQueue: number;
}

export interface PoolKpi {
  id: string;
  name: string;
  kind: PoolKind;
  count: number;
  utilization: number;
  /** Distância total percorrida (m). */
  distance: number;
  tasks: number;
  /** Pedidos esperando um operador/veículo agora. */
  waiting: number;
  units: { id: string; utilization: number; distance: number; tasks: number; busy: boolean; where: string }[];
}

export interface LineKpi {
  elapsed: number;
  completed: number;
  throughputPerHour: number;
  /** Intervalo médio entre saídas (s): o tempo de ciclo real da linha. */
  cycleTime: number;
  leadTime: number;
  valueAddedTime: number;
  /** Total cycle time: conteúdo de trabalho por unidade, somando os componentes consumidos. */
  totalCycleTime: number;
  /** Unidades e cargas entregues no destino final. */
  shipped: number;
  shippedLoads: number;
  queueTime: number;
  blockedTime: number;
  transportTime: number;
  waitingTime: number;
  wip: number;
  avgWip: number;
  firstPassYield: number;
  taktCompliance: number;
  /** OEE do posto gargalo (disponibilidade × performance × qualidade). */
  oee: number;
  /** Produção boa ÷ meta do takt (sem teto: 3,6 = 360% da meta). */
  targetAttainment: number;
  capacityUtilization: number;
  bottleneckId: string | null;
  distancePerUnit: number;
  /** Componentes consumidos em montagens. */
  consumed: number;
  nodes: NodeKpi[];
  pools: PoolKpi[];
  /** Postos ordenados por fração de tempo ativo (maior primeiro). */
  ranking: { id: string; name: string; active: number }[];
}

const PROCESS_TYPES: NodeType[] = ['machine', 'inspection', 'rework', 'buffer'];

export function nodeKpi(sim: Simulator, n: NodeRt): NodeKpi {
  const elapsed = Math.max(1e-9, sim.now - sim.statsStart);
  const st = sim.stateTimes(n);
  const servers = Math.max(1, n.def.capacity);
  const lost = st.down + st.setup;
  const runTime = Math.max(1e-9, elapsed - lost);
  const availability = Math.max(0, 1 - lost / elapsed);
  const performance =
    n.def.cycleTime > 0 ? Math.min(1, (n.processed * n.def.cycleTime) / (runTime * servers)) : 0;
  const quality = n.processed > 0 ? Math.max(0, 1 - n.rejected / n.processed) : 1;
  return {
    id: n.def.id,
    name: n.def.name,
    type: n.def.type,
    state: n.state,
    states: st,
    utilization: sim.workUtilization(n),
    availability,
    performance,
    quality,
    oee: availability * performance * quality,
    processed: n.processed,
    wip: sim.nodeWip(n),
    failures: n.failures,
    avgQueue: n.started > 0 ? n.queueTimeSum / n.started : 0,
  };
}

export function lineKpi(sim: Simulator): LineKpi {
  const elapsed = Math.max(1e-9, sim.now - sim.statsStart);
  const nodes = sim.nodes.map((n) => nodeKpi(sim, n));
  const c = sim.completed;
  const avg = (v: number) => (c > 0 ? v / c : 0);
  const leadTime = avg(sim.leadTimeSum);
  const valueAdded = avg(sim.procSum);
  const transport = avg(sim.transSum);

  // Gargalo pelo método do período ativo: maior fração de tempo ativo (trabalhando, em falha ou setup).
  const ranking = nodes
    .filter((k) => PROCESS_TYPES.includes(k.type) && k.type !== 'buffer' && k.type !== 'rework')
    .map((k) => ({ id: k.id, name: k.name, active: Math.min(1, k.utilization + (k.states.down + k.states.setup) / elapsed) }))
    .sort((a, b) => b.active - a.active);
  const bottleneckId = ranking.length ? ranking[0].id : null;

  const pools: PoolKpi[] = sim.pools.map((p) => {
    const units = p.units.map((u) => ({
      id: u.id,
      utilization: Math.min(1, sim.unitBusyTime(u) / elapsed),
      distance: u.distance,
      tasks: u.tasks,
      busy: u.busy,
      where: u.where,
    }));
    return {
      id: p.def.id,
      name: p.def.name,
      kind: p.def.kind,
      count: units.length,
      utilization: units.length ? units.reduce((s, u) => s + u.utilization, 0) / units.length : 0,
      distance: units.reduce((s, u) => s + u.distance, 0),
      tasks: units.reduce((s, u) => s + u.tasks, 0),
      waiting: p.queue.length,
      units,
    };
  });

  const takt = sim.model.settings.takt;
  const procNodes = nodes.filter((k) => k.type === 'machine' || k.type === 'inspection');
  const capUtil = procNodes.length ? procNodes.reduce((s, k) => s + k.utilization, 0) / procNodes.length : 0;
  return {
    elapsed,
    completed: c,
    throughputPerHour: (c * 3600) / elapsed,
    cycleTime: c > 0 ? elapsed / c : 0,
    leadTime,
    valueAddedTime: valueAdded,
    totalCycleTime: avg(sim.workSum),
    shipped: sim.shipped,
    shippedLoads: sim.shippedLoads,
    queueTime: avg(sim.queueSum),
    blockedTime: avg(sim.blockedSum),
    transportTime: transport,
    waitingTime: Math.max(0, leadTime - valueAdded - transport),
    wip: sim.wip,
    avgWip: sim.avgWip(),
    firstPassYield: c > 0 ? sim.completedGood / c : 1,
    taktCompliance: sim.intervals > 0 ? sim.taktOk / sim.intervals : 0,
    oee: (nodes.find((k) => k.id === bottleneckId) ?? { oee: 0 }).oee,
    targetAttainment: takt > 0 ? (sim.completedGood * takt) / elapsed : 0,
    capacityUtilization: capUtil,
    bottleneckId,
    distancePerUnit: avg(sim.distanceSum),
    consumed: sim.consumed,
    nodes,
    pools,
    ranking,
  };
}

