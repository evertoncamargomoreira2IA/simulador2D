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
  /** Pool de operadores compartilhados que atende o posto (vazio = operador dedicado). */
  poolId?: string;
  /** Tempo de operador por peça (carga + descarga, s). 0 = operador preso durante todo o ciclo. */
  handlingTime?: number;
  /** Montagem: estoque de cada componente ao lado do posto (kits). */
  partBuffer?: number;
  /** Área ocupada pelas gigas/postos paralelos (px), centrada no bloco. Vazio = tudo no centro. */
  area?: { w: number; h: number };
}

/** Posição de cada giga/posto paralelo do nó (1 ou 2 fileiras distribuídas na área). */
export function slotPositions(n: Pick<NodeDef, 'x' | 'y' | 'capacity' | 'area'>): { x: number; y: number }[] {
  const cap = Math.max(1, Math.round(n.capacity));
  if (!n.area || cap === 1) return Array.from({ length: cap }, () => ({ x: n.x, y: n.y }));
  const rows = n.area.h >= 30 ? 2 : 1;
  const cols = Math.ceil(cap / rows);
  return Array.from({ length: cap }, (_, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      x: n.x - n.area!.w / 2 + ((c + 0.5) * n.area!.w) / cols,
      y: rows === 2 ? n.y + (r === 0 ? -n.area!.h / 2 : n.area!.h / 2) : n.y,
    };
  });
}

export interface LinkDef {
  id: string;
  from: string;
  to: string;
  /** Peso de roteamento (probabilidade relativa entre saídas do mesmo nó). */
  weight: number;
  /** 'part': o link entrega um componente consumido na montagem do posto de destino. */
  role?: 'flow' | 'part';
  /** Pool de transporte (empilhadeira, AGV, AMR) que leva as peças por este link. */
  poolId?: string;
}

export type PoolKind = 'operator' | 'forklift' | 'agv';

/** Recurso compartilhado: grupo de operadores ou frota de veículos. */
export interface PoolDef {
  id: string;
  name: string;
  kind: PoolKind;
  count: number;
  /** Velocidade de deslocamento (m/s). */
  speed: number;
  /** Veículos: tempo de carga/descarga por viagem (s). */
  loadTime: number;
  /** Posição inicial (px). */
  x: number;
  y: number;
}

/** Planta de fundo (DXF) já convertida para pixels do canvas. */
export interface Background {
  /** Polilinhas: [x1, y1, x2, y2, ...]. */
  paths: number[][];
  circles: [number, number, number][];
  texts: { x: number; y: number; h: number; t: string; r?: number }[];
  width: number;
  height: number;
  /** Origem do desenho em metros (canto inferior esquerdo) e escala usada. */
  originX: number;
  originY: number;
  pxPerMeter: number;
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
  pools?: PoolDef[];
  background?: Background;
}

export type NodeState = 'working' | 'starved' | 'blocked' | 'resource' | 'down' | 'setup' | 'off';

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

export const POOL_LABEL: Record<PoolKind, string> = {
  operator: 'Operadores',
  forklift: 'Empilhadeira',
  agv: 'AGV / AMR',
};

export function makePool(kind: PoolKind, partial: Partial<PoolDef> = {}): PoolDef {
  return {
    id: partial.id ?? newId('P'),
    name: POOL_LABEL[kind],
    kind,
    count: kind === 'operator' ? 2 : 1,
    speed: kind === 'operator' ? 1 : kind === 'forklift' ? 1.5 : 1,
    loadTime: kind === 'operator' ? 0 : 15,
    x: 0,
    y: 0,
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
