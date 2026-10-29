// Modelo de dados do simulador. Tempos em segundos, distâncias em metros.

export type NodeType = 'source' | 'machine' | 'buffer' | 'inspection' | 'rework' | 'sink';

/** Tipo de atividade no Yamazumi. */
export type ActivityKind = 'va' | 'nva' | 'walk' | 'wait' | 'machine';

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  va: 'Agrega valor',
  nva: 'Não agrega (necessária)',
  walk: 'Deslocamento',
  wait: 'Espera',
  machine: 'Máquina (automático)',
};

export interface Activity {
  name: string;
  /** Segundos por peça. */
  time: number;
  kind: ActivityKind;
}

export interface Operation {
  name: string;
  activities: Activity[];
}

/** Soma das atividades de todas as operações do posto (s por peça). */
export function operationsTime(ops: Operation[] | undefined): number {
  return (ops ?? []).reduce((s, o) => s + o.activities.reduce((a, x) => a + (x.time || 0), 0), 0);
}

/** Tempo de ciclo base do posto no estudo: soma das atividades no modo elementos, senão o tempo do posto. */
export function baseCycle(n: Pick<NodeDef, 'cycleTime' | 'operations'>, settings?: Pick<SimSettings, 'studyMode'>): number {
  return settings?.studyMode === 'elements' && n.operations?.length ? operationsTime(n.operations) : n.cycleTime;
}

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
  /** Agrupamento: junta N peças numa carga (carrinho, pallet) antes de processar. 0/1 = sem. */
  batchSize?: number;
  /** Ponto de medição da produção da linha (throughput, lead time, takt). */
  outputPoint?: boolean;
  /** Tempo de ciclo fixo: a calibração para o takt não altera este posto. */
  fixedTime?: boolean;
  /** Posto de montagem: junta o produto com um kit de cada componente (ligações do tipo peça). */
  assembly?: boolean;
  /** Operações do posto, cada uma com suas atividades (base do Yamazumi). */
  operations?: Operation[];
  /** Tempo de ciclo = soma das atividades (atualizado ao editar as operações). */
  cycleFromOps?: boolean;
  /** Eficiência do posto (0-1, padrão 1): ineficiência alonga o ciclo (ciclo real = tempo / eficiência). */
  efficiency?: number;
  /** Posto manual: só pessoa, sem máquina (sem quebra, setup, potência nem carga/descarga). */
  manual?: boolean;
  /** Onde o operador fixo aparece em relação ao bloco (padrão: em cima). */
  crewSide?: 'top' | 'bottom' | 'left' | 'right';
  /** Posição livre do operador (px, relativa ao centro do bloco), definida arrastando o boneco. */
  crewOffset?: { x: number; y: number };
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
  /** Distância real (m) quando o trecho não está em escala no desenho. */
  length?: number;
  /** Cada peça passa no máximo uma vez por este link (ex.: amostra do OBA que volta ao posto). */
  once?: boolean;
  /** Transporte: peças por viagem. As peças prontas esperam na saída do posto até completar a viagem. */
  tripQty?: number;
  /** Componente (role 'part'): quantas peças deste trecho entram em cada produto montado. */
  partQty?: number;
}

export type PoolKind = 'operator' | 'forklift' | 'agv' | 'amr';

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
  /** Veículos: custo por hora (R$), potência elétrica (kW) e emissão de combustível (kg CO2e/h, escopo 1). */
  costPerHour?: number;
  powerKw?: number;
  fuelCo2?: number;
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
  /** Layout em imagem (data URL JPEG), esticado em width × height. */
  image?: string;
  /** Ajuste do fundo sobre o modelo: tamanho (1 = 100%), deslocamento em px e opacidade (0-1). */
  scale?: number;
  dx?: number;
  dy?: number;
  opacity?: number;
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
  /** Começar com a linha cheia (regime): ignora a rampa de enchimento e mostra o UPH real. */
  startFull?: boolean;
  /** Estudo por tempo de ciclo do posto (padrão) ou por elementos: o ciclo vira a soma das atividades. */
  studyMode?: 'cycle' | 'elements';
  /** Paradas planejadas do turno (almoço, ginástica laboral, troca de modelo). */
  stops?: ShiftStop[];
  /** Custos (R$): mão de obra por operador-hora, energia por kWh, matéria-prima por peça,
   *  manutenção por hora de parada, estoque em processo por peça-hora. */
  laborRate?: number;
  energyPrice?: number;
  materialCost?: number;
  maintenanceRate?: number;
  wipCost?: number;
  /** Carbono: fator da rede elétrica (kg CO2e/kWh, escopo 2) e da matéria-prima por peça (escopo 3). */
  gridCo2?: number;
  materialCo2?: number;
}

/** Área desenhada no canvas (ex.: expedição fora do layout). */
export interface ZoneDef {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Model {
  name: string;
  nodes: NodeDef[];
  links: LinkDef[];
  settings: SimSettings;
  pools?: PoolDef[];
  background?: Background;
  zones?: ZoneDef[];
  /** Ordem dos postos nos gráficos (ids). Vazio = ordem do fluxo. */
  /** Posto de referência do UPH (destacado no layout e no indicador Throughput). */
  refStation?: string;
  chartOrder?: string[];
  /** Postos escondidos nos gráficos (ids). */
  chartHidden?: string[];
}

export type NodeState = 'working' | 'starved' | 'blocked' | 'resource' | 'down' | 'setup' | 'break' | 'off';

/** Parada planejada do turno. Pausa = postos com pessoa param (almoço, ginástica); troca = a linha toda para (troca de modelo). */
export interface ShiftStop {
  name: string;
  /** Minutos depois do início do turno. */
  start: number;
  /** Duração em minutos. */
  duration: number;
  kind: 'break' | 'changeover';
}

/** Paradas sugeridas para começar (turno de 8 h). */
export const STOP_PRESETS: ShiftStop[] = [
  { name: 'Ginástica laboral', start: 60, duration: 10, kind: 'break' },
  { name: 'Almoço', start: 240, duration: 60, kind: 'break' },
  { name: 'Troca de modelo', start: 360, duration: 20, kind: 'changeover' },
];

/** Minutos parados no turno (só o que cai dentro da duração). */
export function stopMinutes(s: Pick<SimSettings, 'stops' | 'duration'>): number {
  const end = s.duration / 60;
  return (s.stops ?? []).reduce((a, x) => a + Math.max(0, Math.min(end, x.start + x.duration) - Math.max(0, x.start)), 0);
}

export const NODE_DEFAULTS: Record<NodeType, Partial<NodeDef>> = {
  source: { cycleTime: 0, capacity: 1, queueCap: 0, interarrival: 0 },
  machine: { cycleTime: 12, capacity: 1, queueCap: 1 },
  buffer: { cycleTime: 0, capacity: 20, queueCap: 0 },
  inspection: { cycleTime: 12, capacity: 1, queueCap: 1 },
  rework: { cycleTime: 60, capacity: 1, queueCap: 5 },
  sink: { cycleTime: 0, capacity: 1, queueCap: 0 },
};

/** Posto de montagem: marcado como tal ou recebendo componentes (ligações do tipo peça). */
export function isAssembly(n: Pick<NodeDef, 'id' | 'type' | 'assembly'>, links: Pick<LinkDef, 'to' | 'role'>[]): boolean {
  return n.type === 'machine' && (!!n.assembly || links.some((l) => l.to === n.id && l.role === 'part'));
}

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

/** Posto manual (só gente) mede OLE (eficácia da mão de obra); máquina mede OEE. */
export const effLabel = (n: Pick<NodeDef, 'manual'> | undefined): 'OLE' | 'OEE' => (n?.manual ? 'OLE' : 'OEE');

export const POOL_LABEL: Record<PoolKind, string> = {
  operator: 'Operadores',
  forklift: 'Empilhadeira',
  agv: 'AGV',
  amr: 'AMR',
};

export function makePool(kind: PoolKind, partial: Partial<PoolDef> = {}): PoolDef {
  return {
    id: partial.id ?? newId('P'),
    name: POOL_LABEL[kind],
    kind,
    count: kind === 'operator' ? 2 : 1,
    speed: kind === 'operator' ? 1 : kind === 'forklift' ? 1.5 : kind === 'amr' ? 1.2 : 1,
    loadTime: kind === 'operator' ? 0 : 15,
    x: 0,
    y: 0,
    costPerHour: kind === 'forklift' ? 45 : kind === 'agv' || kind === 'amr' ? 25 : 0,
    powerKw: kind === 'forklift' ? 5 : kind === 'agv' || kind === 'amr' ? 0.6 : 0,
    fuelCo2: 0,
    ...partial,
  };
}

export const DEFAULT_SETTINGS: SimSettings = {
  duration: 8 * 3600,
  warmup: 0,
  takt: 0,
  seed: 42,
  transportSpeed: 1,
  pxPerMeter: 40,
  laborRate: 35,
  energyPrice: 0.75,
  materialCost: 0,
  maintenanceRate: 80,
  wipCost: 0,
  gridCo2: 0.0385,
  materialCo2: 0,
};

/** Postos na ordem escolhida para os gráficos: primeiro os de `chartOrder`, depois o resto na ordem dada. */
export function chartSequence<T extends { id: string }>(model: Pick<Model, 'chartOrder' | 'chartHidden'>, items: T[], keepHidden = false): T[] {
  const pos = new Map((model.chartOrder ?? []).map((id, i) => [id, i]));
  const hidden = new Set(model.chartHidden ?? []);
  return items
    .map((it, i) => ({ it, k: pos.has(it.id) ? pos.get(it.id)! : 1e6 + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.it)
    .filter((it) => keepHidden || !hidden.has(it.id));
}

/** Campos zerados num posto manual: quem trabalha é o operador, não há máquina para quebrar ou consumir energia. */
export const MANUAL_PATCH: Partial<NodeDef> = { manual: true, assembly: false, availability: 1, mttr: 0, setupTime: 0, powerKw: 0, idlePowerKw: 0, handlingTime: 0, poolId: undefined };

/** Blocos da paleta que são variações de Machine. */
export type BlockVariant = 'assembly' | 'manual';
export function variantPatch(v: BlockVariant, operators: number): Partial<NodeDef> {
  return v === 'assembly'
    ? { name: 'Montagem', assembly: true, manual: false, partBuffer: 2 }
    : { ...MANUAL_PATCH, name: 'Posto manual', operators: Math.max(1, operators) };
}
