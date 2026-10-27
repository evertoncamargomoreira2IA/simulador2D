// Indicadores calculados a partir do estado do simulador.

import type { NodeRt, Simulator } from './simulator';
import type { NodeState, NodeType } from './types';

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
}

export interface LineKpi {
  elapsed: number;
  completed: number;
  throughputPerHour: number;
  /** Intervalo médio entre saídas (s): o tempo de ciclo real da linha. */
  cycleTime: number;
  leadTime: number;
  valueAddedTime: number;
  queueTime: number;
  blockedTime: number;
  transportTime: number;
  waitingTime: number;
  wip: number;
  avgWip: number;
  firstPassYield: number;
  taktCompliance: number;
  oee: number;
  capacityUtilization: number;
  bottleneckId: string | null;
  distancePerUnit: number;
  nodes: NodeKpi[];
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
    utilization: st.working / elapsed,
    availability,
    performance,
    quality,
    oee: availability * performance * quality,
    processed: n.processed,
    wip: sim.nodeWip(n),
    failures: n.failures,
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
  let bottleneckId: string | null = null;
  let best = -1;
  for (const k of nodes) {
    if (!PROCESS_TYPES.includes(k.type) || k.type === 'buffer' || k.type === 'rework') continue;
    const active = (k.states.working + k.states.down + k.states.setup) / elapsed;
    if (active > best + 1e-9) {
      best = active;
      bottleneckId = k.id;
    }
  }

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
    queueTime: avg(sim.queueSum),
    blockedTime: avg(sim.blockedSum),
    transportTime: transport,
    waitingTime: Math.max(0, leadTime - valueAdded - transport),
    wip: sim.wip,
    avgWip: sim.avgWip(),
    firstPassYield: c > 0 ? sim.completedGood / c : 1,
    taktCompliance: sim.intervals > 0 ? sim.taktOk / sim.intervals : 0,
    oee: takt > 0 ? Math.min(1, (sim.completedGood * takt) / elapsed) : 0,
    capacityUtilization: capUtil,
    bottleneckId,
    distancePerUnit: avg(sim.distanceSum),
    nodes,
  };
}

