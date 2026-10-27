// Modelo de dados do simulador. Tempos em segundos, distâncias em metros.

export type NodeType = 'source' | 'machine' | 'buffer' | 'inspection' | 'rework' | 'sink';

export interface NodeDef {
  id: string;
  name: string;
  type: NodeType;
  x: number;
  y: number;
  /** Tempo de ciclo médio (s). Em buffers é o tempo mínimo de permanência. */
  cycleTime: number;
  /** Coeficiente de variação do tempo de ciclo (0 = determinístico). */
  cv: number;
  /** Máquinas: postos em paralelo. Buffers: capacidade total. */
  capacity: number;
  /** Fila de entrada (peças aguardando) antes do posto. */
  queueCap: number;
  /** Setup inicial (s), aplicado uma vez no início do turno. */
  setupTime: number;
  /** Disponibilidade técnica (0..1). < 1 gera falhas aleatórias. */
  availability: number;
  /** Tempo médio de reparo (s). */
  mttr: number;
  /** Fonte: intervalo entre chegadas (s). 0 = abastecimento ilimitado. */
  interarrival: number;
  /** Fonte: limite de peças (0 = sem limite). */
  maxArrivals: number;
  operators: number;
  shifts: number;
  oeeTarget: number;
  powerKw: number;
  idlePowerKw: number;
  costPerHour: number;
  co2Factor: number;
  layer: string;
}

export interface LinkDef {
  id: string;
  from: string;
  to: string;
  /** Peso de roteamento (probabilidade relativa entre saídas do mesmo nó). */
  weight: number;
}

export interface SimSettings {
  duration: number;
  warmup: number;
  takt: number;
  seed: number;
  /** Velocidade de transporte entre nós (m/s). */
  transportSpeed: number;
  /** Pixels do canvas por metro. */
  pxPerMeter: number;
}

export interface Model {
  name: string;
  nodes: NodeDef[];
  links: LinkDef[];
  settings: SimSettings;
}

export type NodeState = 'working' | 'starved' | 'blocked' | 'down' | 'setup' | 'off';

export const NODE_DEFAULTS: Record<NodeType, Partial<NodeDef>> = {
  source: { cycleTime: 0, capacity: 1, queueCap: 0, interarrival: 0 },
  machine: { cycleTime: 12, capacity: 1, queueCap: 1 },
  buffer: { cycleTime: 0, capacity: 20, queueCap: 0 },
  inspection: { cycleTime: 12, capacity: 1, queueCap: 1 },
  rework: { cycleTime: 60, capacity: 1, queueCap: 5 },
  sink: { cycleTime: 0, capacity: 1, queueCap: 0 },
};

export const TYPE_LABEL: Record<NodeType, string> = {
  source: 'Source',
  machine: 'Machine',
  buffer: 'Buffer',
  inspection: 'Inspection',
  rework: 'Rework',
  sink: 'Finished Goods',
};

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter}`;
}

export function makeNode(type: NodeType, partial: Partial<NodeDef> = {}): NodeDef {
  return {
    id: partial.id ?? newId('N'),
    name: partial.name ?? TYPE_LABEL[type],
    type,
    x: 0,
    y: 0,
    cycleTime: 12,
    cv: 0.05,
    capacity: 1,
    queueCap: 1,
    setupTime: 0,
    availability: 1,
    mttr: 60,
    interarrival: 0,
    maxArrivals: 0,
    operators: type === 'machine' || type === 'inspection' || type === 'rework' ? 1 : 0,
    shifts: 1,
    oeeTarget: 0.85,
    powerKw: 0,
    idlePowerKw: 0,
    costPerHour: 0,
    co2Factor: 0,
    layer: 'Produção',
    ...NODE_DEFAULTS[type],
    ...partial,
  };
}

export const DEFAULT_SETTINGS: SimSettings = {
  duration: 8 * 3600,
  warmup: 0,
  takt: 12,
  seed: 42,
  transportSpeed: 1,
  pxPerMeter: 40,
};
