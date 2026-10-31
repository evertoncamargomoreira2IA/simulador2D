// Motor de simulação de eventos discretos (DES).
//
// Semântica:
// - Cada nó tem `capacity` postos (servidores/gigas) e uma fila de entrada `queueCap`.
// - Uma peça terminada fica no posto (bloqueio após serviço) até o destino aceitar.
// - O destino é escolhido no fim do processamento pelos pesos dos links.
// - Ao sair, a peça reserva lugar no destino e viaja pelo link (transporte).
// - Links de componente ('part') abastecem o estoque ao lado do posto; o posto só começa
//   quando tem a peça principal e um componente de cada link (montagem).
// - Postos com pool de operadores precisam de um operador livre: ele anda até o posto,
//   faz a carga/descarga (handlingTime) e fica livre; com handlingTime 0 fica o ciclo todo.
// - Links com pool de transporte (empilhadeira/AGV) esperam um veículo, que vai vazio até
//   a origem, carrega e leva a peça ao destino.
// - Agrupamento (batchSize N): o nó junta N peças da fila numa carga (carrinho, pallet),
//   quebrando cargas maiores se preciso, e processa a carga inteira de uma vez.
// - Tempos e distâncias das peças são somados por unidade (carga de 15 = 15 unidades).
// - Peças saindo do retrabalho sempre entram no destino (pista de retorno), evitando deadlock.
// - Falhas: MTBF derivado de disponibilidade e MTTR; processamento é pausado.

import { effectiveTakt } from './balance';
import { MinHeap } from './heap';
import { pointAt, polyLength, polyline, reversePts } from './path';
import { sampleTime } from './dist';
import { Rng } from './rng';
import { baseCycle, slotPositions, type LinkDef, type Model, type NodeDef, type NodeState, type PoolDef, type ProductDef, type ShiftStop } from './types';

export interface Entity {
  id: number;
  releasedAt: number;
  procTime: number;
  queueTime: number;
  blockedTime: number;
  transTime: number;
  distance: number;
  reworks: number;
  enteredQueueAt: number;
  blockedSince: number;
  next: LinkRt | null;
  /** Aguardando o veículo que vai buscá-la. */
  awaitingPickup: boolean;
  /** Já chamou o transporte (está numa viagem marcada). */
  called?: boolean;
  /** Giga ocupada no nó atual (-1 = nenhuma). */
  slot: number;
  /** Unidades nesta carga (1 = peça avulsa). */
  qty: number;
  /** Instantes de entrada das unidades de uma carga (lead time por unidade). */
  members?: number[];
  /** Conteúdo de trabalho acumulado, incluindo os componentes consumidos (s·unidade). */
  work: number;
  /** Já contada no ponto de medição da produção. */
  counted: boolean;
  /** Links 'once' já percorridos. */
  visited?: Set<string>;
  /** Postos de montagem onde a peça já recebeu os componentes (não consome de novo ao voltar). */
  assembled?: Set<string>;
  /** Trecho pelo qual entrou na fila do posto atual (carrinho/bin do item). */
  via?: LinkRt;
  /** Modelo de produto (mix). */
  product?: string;
}

interface Job {
  entity: Entity;
  start: number;
  end: number;
  duration: number;
  remaining: number;
  token: number;
  /** Operador preso até o fim do ciclo (handlingTime 0). */
  unit?: UnitRt;
}

export interface LinkRt {
  def: LinkDef;
  from: NodeRt;
  to: NodeRt;
  distance: number;
  travelTime: number;
  moved: number;
  isPart: boolean;
  /** Peças a caminho do destino por este trecho (componentes ou carrinho/bin do item). */
  reserved: number;
  pool: PoolRt | null;
}

/** Motivo de peça parada num posto (diagnóstico de trava). */
export type StuckFact =
  | { kind: 'parts'; node: string; link: string; from: string; have: number; need: number }
  | { kind: 'batch'; node: string; have: number; need: number }
  | { kind: 'noUnits'; node: string; link?: string; pool: string }
  | { kind: 'noMain'; node: string }
  | { kind: 'waitMain'; node: string; from: string[]; part: string; partFrom: string }
  | { kind: 'trip'; node: string; link: string; have: number; need: number }
  | { kind: 'full'; node: string; link: string; to: string };

export interface NodeRt {
  def: NodeDef;
  out: LinkRt[];
  inLinks: LinkRt[];
  partLinks: LinkRt[];
  parts: Map<LinkRt, Entity[]>;
  queue: Entity[];
  processing: Job[];
  done: Entity[];
  reserved: number;
  /** Unidades reservadas a caminho (para nós de agrupamento). */
  reservedUnits: number;
  down: boolean;
  /** Em parada planejada (almoço, troca de modelo). */
  paused: boolean;
  setupUntil: number;
  state: NodeState;
  stateSince: number;
  stateTime: Record<NodeState, number>;
  entered: number;
  started: number;
  processed: number;
  failures: number;
  /** Peças que a inspeção mandou para retrabalho. */
  rejected: number;
  released: number;
  refillPending: boolean;
  queueTimeSum: number;
  pool: PoolRt | null;
  /** Já está na fila do pool esperando operador. */
  waitingPool: boolean;
  /** Integral no tempo das gigas/postos em processamento (para utilização com capacidade > 1). */
  workArea: number;
  workSince: number;
  workCount: number;
  slots: { x: number; y: number }[];
  slotBusy: boolean[];
  /** Mix: último modelo processado e trocas de modelo feitas. */
  lastProduct?: string;
  changeovers: number;
  changeoverTime: number;
}

export interface Move {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t0: number;
  t1: number;
  /** Trilha da seta (polilinha), quando o trecho tem pontos de curva. */
  pts?: number[];
}

export interface UnitRt {
  id: string;
  pool: PoolRt;
  x: number;
  y: number;
  move: Move | null;
  busy: boolean;
  busySince: number;
  busyTime: number;
  distance: number;
  tasks: number;
  /** Carregando uma peça (veículos). */
  loaded: boolean;
  where: string;
}

type PoolRequest = { kind: 'station'; node: NodeRt } | { kind: 'move'; node: NodeRt; entity: Entity; link: LinkRt; group?: Entity[] };

export interface PoolRt {
  def: PoolDef;
  units: UnitRt[];
  queue: PoolRequest[];
  waitSum: number;
  requests: number;
}

export interface Transit {
  entity: Entity;
  link: LinkRt;
  start: number;
  end: number;
  unit?: UnitRt;
}

type EvKind =
  | 'create'
  | 'refill'
  | 'end'
  | 'arrive'
  | 'fail'
  | 'repair'
  | 'wake'
  | 'sample'
  | 'warmup'
  | 'unitFree'
  | 'pickup'
  | 'stopOn'
  | 'stopOff';
interface SimEvent {
  t: number;
  seq: number;
  kind: EvKind;
  node?: NodeRt;
  job?: Job;
  token?: number;
  transit?: Transit;
  unit?: UnitRt;
  entity?: Entity;
  link?: LinkRt;
  stop?: ShiftStop;
  group?: Entity[];
}

export interface TimelinePoint {
  t: number;
  completed: number;
  wip: number;
  throughputPerHour: number;
  /** Peças (ou cargas) que cada nó já terminou, na ordem de model.nodes. */
  processed?: number[];
}

/** Intervalo mínimo (s) entre peças de uma fonte ilimitada quando a saída está livre. */
const SOURCE_MIN_GAP = 1;
/** Proteção contra loops de tempo zero (modelo com ciclo sem tempo). */
const MAX_SAME_TIME_EVENTS = 200_000;

const STATES: NodeState[] = ['working', 'starved', 'blocked', 'resource', 'down', 'setup', 'break', 'off'];
const zeroStates = (): Record<NodeState, number> =>
  Object.fromEntries(STATES.map((s) => [s, 0])) as Record<NodeState, number>;

export class Simulator {
  readonly model: Model;
  readonly nodes: NodeRt[] = [];
  readonly links: LinkRt[] = [];
  readonly pools: PoolRt[] = [];
  readonly byId = new Map<string, NodeRt>();
  readonly transits = new Set<Transit>();
  readonly timeline: TimelinePoint[] = [];
  now = 0;
  /** Início do turno visível. Com a linha cheia, o enchimento roda antes deste instante. */
  t0 = 0;
  statsStart = 0;
  completed = 0;
  /** Último instante em que a linha entregou peça (diagnóstico de trava). */
  lastOutputAt = 0;
  completedGood = 0;
  consumed = 0;
  /** Unidades e cargas que chegaram ao destino final (sink). */
  shipped = 0;
  shippedLoads = 0;
  workSum = 0;
  leadTimeSum = 0;
  procSum = 0;
  queueSum = 0;
  blockedSum = 0;
  transSum = 0;
  distanceSum = 0;
  taktOk = 0;
  intervals = 0;
  lastExit = -1;
  wip = 0;
  wipIntegral = 0;
  private wipSince = 0;
  private heap = new MinHeap<SimEvent>();
  /** Nós com peças bloqueadas que devem tentar sair de novo (liberou espaço a jusante). */
  private retry = new Set<NodeRt>();
  private seq = 0;
  private rng: Rng;
  private entitySeq = 0;
  /** Sorteio do mix separado do resto: o mesmo modelo sem mix dá exatamente o mesmo resultado. */
  private mixRng: Rng;
  private seqIndex = 0;
  private productById = new Map<string, ProductDef>();
  /** Produção da linha por modelo de produto (no ponto de medição). */
  readonly producedBy: Record<string, number> = {};
  private lastSample = { t: 0, completed: 0 };
  readonly sampleEvery: number;
  readonly ppm: number;
  /** Preenchido quando a simulação é interrompida por um modelo inválido. */
  error: string | null = null;
  private sameTimeEvents = 0;
  /** Distâncias reais (m) entre pares de posições, vindas de links com comprimento informado. */
  private lengths = new Map<string, number>();
  /** Trilhas das setas com pontos de curva, nos dois sentidos (chave como em lengths). */
  private routes = new Map<string, number[]>();
  /** Há um nó marcado como ponto de medição da produção. */
  readonly hasOutputPoint: boolean;
  /** Avisado a cada ciclo concluído (fonte simulada de dados reais: posto, peça, início e fim). */
  onCycle?: (c: { node: NodeDef; serial: number; start: number; end: number; product?: string }) => void;

  constructor(model: Model) {
    // Takt zerado: usa o tempo do gargalo planejado como referência.
    this.model = model.settings.takt > 0 ? model : { ...model, settings: { ...model.settings, takt: effectiveTakt(model) } };
    this.rng = new Rng(model.settings.seed);
    this.mixRng = new Rng(model.settings.seed * 31 + 7);
    for (const p of model.products ?? []) this.productById.set(p.id, p);
    const ppm = (this.ppm = model.settings.pxPerMeter || 40);
    const poolById = new Map<string, PoolRt>();
    for (const def of model.pools ?? []) {
      const pool: PoolRt = { def, units: [], queue: [], waitSum: 0, requests: 0 };
      for (let i = 0; i < Math.max(0, Math.round(def.count)); i++) {
        pool.units.push({
          id: `${def.id}#${i + 1}`,
          pool,
          x: def.x + (i % 4) * 14,
          y: def.y + Math.floor(i / 4) * 14,
          move: null,
          busy: false,
          busySince: 0,
          busyTime: 0,
          distance: 0,
          tasks: 0,
          loaded: false,
          where: '',
        });
      }
      this.pools.push(pool);
      poolById.set(def.id, pool);
    }
    for (const def of model.nodes) {
      const n: NodeRt = {
        def,
        out: [],
        inLinks: [],
        partLinks: [],
        parts: new Map(),
        queue: [],
        processing: [],
        done: [],
        reserved: 0,
        reservedUnits: 0,
        down: false,
        paused: false,
        setupUntil: def.setupTime > 0 ? def.setupTime : 0,
        changeovers: 0,
        changeoverTime: 0,
        state: 'off',
        stateSince: 0,
        stateTime: zeroStates(),
        entered: 0,
        started: 0,
        processed: 0,
        failures: 0,
        rejected: 0,
        released: 0,
        refillPending: false,
        queueTimeSum: 0,
        pool: def.poolId ? poolById.get(def.poolId) ?? null : null,
        waitingPool: false,
        workArea: 0,
        workSince: 0,
        workCount: 0,
        slots: slotPositions(def),
        slotBusy: slotPositions(def).map(() => false),
      };
      if (n.pool && n.pool.def.kind !== 'operator') n.pool = null;
      this.nodes.push(n);
      this.byId.set(def.id, n);
    }
    for (const def of model.links) {
      const from = this.byId.get(def.from);
      const to = this.byId.get(def.to);
      if (!from || !to || from === to) continue;
      const route = def.path?.length ? polyline(from.def, to.def, def.path) : null;
      const geo = (route ? polyLength(route) : Math.hypot(to.def.x - from.def.x, to.def.y - from.def.y)) / ppm;
      const distance = def.length && def.length > 0 ? def.length : geo;
      if (route) {
        this.routes.set(`${from.def.x},${from.def.y}|${to.def.x},${to.def.y}`, route);
        this.routes.set(`${to.def.x},${to.def.y}|${from.def.x},${from.def.y}`, reversePts(route));
        if (!(def.length && def.length > 0)) {
          this.lengths.set(`${from.def.x},${from.def.y}|${to.def.x},${to.def.y}`, geo);
          this.lengths.set(`${to.def.x},${to.def.y}|${from.def.x},${from.def.y}`, geo);
        }
      }
      if (def.length && def.length > 0) {
        this.lengths.set(`${from.def.x},${from.def.y}|${to.def.x},${to.def.y}`, def.length);
        this.lengths.set(`${to.def.x},${to.def.y}|${from.def.x},${from.def.y}`, def.length);
      }
      const pool = def.poolId ? poolById.get(def.poolId) ?? null : null;
      // operador também pode fazer o transporte do trecho (pega no posto de entrada e entrega no de saída)
      const vehicle = pool;
      const speed = vehicle ? vehicle.def.speed : model.settings.transportSpeed;
      const isPart = def.role === 'part' && to.def.type !== 'sink' && to.def.type !== 'source';
      const l: LinkRt = {
        def,
        from,
        to,
        distance,
        travelTime: speed > 0 ? distance / speed : 0,
        moved: 0,
        isPart,
        reserved: 0,
        pool: vehicle,
      };
      from.out.push(l);
      to.inLinks.push(l);
      if (isPart) {
        to.partLinks.push(l);
        to.parts.set(l, []);
      }
      this.links.push(l);
    }
    this.hasOutputPoint = this.nodes.some((n) => n.def.outputPoint && n.def.type !== 'source');
    this.sampleEvery = Math.max(60, Math.round(model.settings.duration / 240));
    this.init();
  }

  get duration(): number {
    return this.t0 + this.model.settings.duration;
  }
  /** Relógio do turno (s desde o início visível). */
  get clock(): number {
    return this.now - this.t0;
  }
  get finished(): boolean {
    return this.now >= this.duration;
  }

  private schedule(t: number, kind: EvKind, extra: Partial<SimEvent> = {}): void {
    this.heap.push({ t, seq: this.seq++, kind, ...extra });
  }

  private init(): void {
    for (const n of this.nodes) {
      const d = n.def;
      if (d.type === 'source') {
        if (d.interarrival > 0) this.schedule(0, 'create', { node: n });
      } else if (d.type !== 'sink') {
        if (d.availability > 0 && d.availability < 1 && d.mttr > 0) {
          this.schedule(this.rng.exponential(this.mtbf(d)), 'fail', { node: n });
        }
        if (n.setupUntil > 0) this.schedule(n.setupUntil, 'wake', { node: n });
      }
      this.updateState(n);
    }
    for (const n of this.nodes) if (n.def.type === 'source' && n.def.interarrival <= 0) this.refillSource(n);
    this.schedule(this.sampleEvery, 'sample');
    if (this.model.settings.startFull) {
      // Linha cheia: enche a linha antes do turno visível e zera as estatísticas.
      const fill = Math.max(7200, 3 * this.model.settings.warmup);
      this.t0 = fill;
      this.drainRetry();
      this.advanceTo(fill);
      if (!this.error) {
        this.resetStats();
        this.timeline.length = 0;
      }
      this.scheduleStops();
      return;
    }
    if (this.model.settings.warmup > 0) this.schedule(this.model.settings.warmup, 'warmup');
    this.scheduleStops();
    this.drainRetry();
  }

  /** Paradas do turno contam a partir do início visível (t0). */
  private scheduleStops(): void {
    for (const stop of this.model.settings.stops ?? []) {
      if (!(stop.duration > 0)) continue;
      const a = this.t0 + Math.max(0, stop.start) * 60;
      this.schedule(a, 'stopOn', { stop });
      this.schedule(a + stop.duration * 60, 'stopOff', { stop });
    }
  }

  /** Quem para: na pausa, postos com gente; na troca de modelo, todos os postos. */
  private stopsNode(n: NodeRt, stop: ShiftStop): boolean {
    const t = n.def.type;
    if (t === 'source' || t === 'sink' || t === 'buffer') return false;
    return stop.kind === 'changeover' || n.def.operators > 0 || !!n.def.poolId;
  }

  private freeze(n: NodeRt): void {
    for (const job of n.processing) {
      job.remaining = job.end - this.now;
      job.token++;
    }
  }

  private unfreeze(n: NodeRt): void {
    for (const job of n.processing) {
      job.end = this.now + job.remaining;
      this.schedule(job.end, 'end', { node: n, job, token: job.token });
    }
  }

  private onStop(stop: ShiftStop, on: boolean): void {
    for (const n of this.nodes) {
      if (!this.stopsNode(n, stop)) continue;
      if (on) {
        if (!n.paused && !n.down) this.freeze(n);
        n.paused = true;
        this.updateState(n);
      } else if (n.paused) {
        n.paused = false;
        if (!n.down) this.unfreeze(n);
        this.tryStart(n);
        this.updateState(n);
      }
    }
  }

  private mtbf(d: NodeDef): number {
    return (d.mttr * d.availability) / (1 - d.availability);
  }

  /** Processa todos os eventos até o instante t (limitado à duração). */
  advanceTo(t: number): void {
    const target = Math.min(t, this.duration);
    for (;;) {
      const ev = this.heap.peek();
      if (!ev || ev.t > target) break;
      this.heap.pop();
      if (ev.t === this.now) {
        if (++this.sameTimeEvents > MAX_SAME_TIME_EVENTS) {
          this.error = 'A simulação entrou em loop sem avançar o tempo. Verifique ciclos de fluxo com tempo de ciclo 0.';
          this.now = this.duration;
          return;
        }
      } else {
        this.sameTimeEvents = 0;
      }
      this.now = ev.t;
      this.handle(ev);
      this.drainRetry();
    }
    this.now = Math.max(this.now, target);
  }

  runToEnd(): void {
    this.advanceTo(this.duration);
  }

  private handle(ev: SimEvent): void {
    const n = ev.node;
    switch (ev.kind) {
      case 'create':
        if (n!.out.length === 0) break;
        if (n!.def.maxArrivals > 0 && n!.released + n!.done.length >= n!.def.maxArrivals) break;
        n!.done.push(this.newEntity(n!));
        this.tryPush(n!);
        this.schedule(this.now + n!.def.interarrival, 'create', { node: n });
        break;
      case 'refill':
        n!.refillPending = false;
        this.refillSource(n!);
        break;
      case 'end':
        this.onEnd(n!, ev.job!, ev.token!);
        break;
      case 'arrive':
        this.onArrive(ev.transit!);
        break;
      case 'fail':
        this.onFail(n!);
        break;
      case 'repair':
        this.onRepair(n!);
        break;
      case 'wake':
        this.tryStart(n!);
        this.updateState(n!);
        break;
      case 'unitFree':
        this.releaseUnit(ev.unit!);
        break;
      case 'pickup':
        this.onPickup(ev.node!, ev.entity!, ev.link!, ev.unit!, ev.group);
        break;
      case 'sample':
        this.sample();
        this.schedule(this.now + this.sampleEvery, 'sample');
        break;
      case 'warmup':
        this.resetStats();
        break;
      case 'stopOn':
      case 'stopOff':
        this.onStop(ev.stop!, ev.kind === 'stopOn');
        break;
    }
  }

  private notifyUpstream(n: NodeRt): void {
    for (const l of n.inLinks) if (l.from.done.length > 0) this.retry.add(l.from);
  }

  private drainRetry(): void {
    while (this.retry.size > 0) {
      const n = this.retry.values().next().value as NodeRt;
      this.retry.delete(n);
      this.tryPush(n);
    }
  }

  /** Próximo modelo do mix: sequência fixa em ciclo, ou sorteio pelo % de cada modelo. */
  private nextProduct(): string | undefined {
    const ps = this.model.products;
    if (!ps?.length) return undefined;
    const seq = (this.model.sequence ?? []).filter((id) => this.productById.has(id));
    if (seq.length) return seq[this.seqIndex++ % seq.length];
    const total = ps.reduce((a, p) => a + Math.max(0, p.share), 0);
    if (total <= 0) return ps[0].id;
    let r = this.mixRng.next() * total;
    for (const p of ps) if ((r -= Math.max(0, p.share)) < 0) return p.id;
    return ps[ps.length - 1].id;
  }

  /** Tempo médio do posto para o modelo da peça: tempo próprio, ou ciclo × fator do modelo. */
  private meanTime(n: NodeRt, product?: string): number {
    const base = baseCycle(n.def, this.model.settings);
    if (!product) return base;
    const own = n.def.productTimes?.[product];
    if (own !== undefined && own > 0) return own;
    return base * (this.productById.get(product)?.factor ?? 1);
  }

  private newEntity(src: NodeRt): Entity {
    const e: Entity = {
      id: ++this.entitySeq,
      releasedAt: this.now,
      procTime: 0,
      queueTime: 0,
      blockedTime: 0,
      transTime: 0,
      distance: 0,
      reworks: 0,
      enteredQueueAt: this.now,
      blockedSince: this.now,
      next: null,
      awaitingPickup: false,
      slot: -1,
      qty: 1,
      work: 0,
      counted: false,
      product: this.nextProduct(),
    };
    e.next = this.route(src, e);
    return e;
  }

  private route(n: NodeRt, e?: Entity): LinkRt | null {
    const out = e?.visited ? n.out.filter((l) => !e.visited!.has(l.def.id)) : n.out;
    if (out.length === 0) return n.out.length ? n.out[0] : null;
    if (out.length === 1) return out[0];
    const total = out.reduce((s, l) => s + Math.max(0, l.def.weight), 0);
    if (total <= 0) return out[0];
    let r = this.rng.next() * total;
    for (const l of out) {
      r -= Math.max(0, l.def.weight);
      if (r <= 0) return l;
    }
    return out[out.length - 1];
  }

  private batchOf(n: NodeRt): number {
    const b = Math.round(n.def.batchSize ?? 0);
    return b > 1 && n.def.type !== 'source' && n.def.type !== 'sink' ? b : 0;
  }

  /** Unidades na fila de entrada do nó (a caminho incluídas). */
  queuedUnits(n: NodeRt): number {
    let u = 0;
    for (const e of n.queue) u += e.qty;
    return u;
  }

  canAccept(n: NodeRt): boolean {
    const t = n.def.type;
    if (t === 'sink') return true;
    if (t === 'source') return false;
    const batch = this.batchOf(n);
    if (batch) return this.queuedUnits(n) + n.reservedUnits < batch + Math.max(0, n.def.queueCap);
    // peças nos carrinhos/bins dos transportes ficam fora da fila de entrada
    let binned = 0;
    for (const l of n.inLinks) if (!l.isPart && this.binCap(l)) binned += this.binHave(l) + l.reserved;
    const occ = n.queue.length + n.processing.length + n.done.length - this.staged(n) + n.reserved - binned;
    return occ < Math.max(1, n.def.capacity) + Math.max(0, n.def.queueCap);
  }

  /** Capacidade do carrinho/bin do item atrás do posto (0 = sem bin: fila do posto ou estoque de componentes). */
  binCap(l: LinkRt): number {
    const trip = this.tripOf(l);
    return trip > 1 ? Math.max(1, Math.round(l.def.bins ?? 2)) * trip : 0;
  }

  /** Peças do item já no carrinho/bin atrás do posto. */
  binHave(l: LinkRt): number {
    if (l.isPart) return l.to.parts.get(l)!.length;
    let q = 0;
    for (const e of l.to.queue) if (e.via === l) q += e.qty;
    return q;
  }

  private canAcceptVia(l: LinkRt): boolean {
    const bin = this.binCap(l);
    if (bin) return this.binHave(l) + l.reserved < bin;
    if (!l.isPart) return this.canAccept(l.to);
    return l.to.parts.get(l)!.length + l.reserved < this.partQty(l) * Math.max(1, l.to.def.partBuffer ?? 2);
  }

  /**
   * Fonte ilimitada: mantém sempre uma peça pronta na saída. Se a peça sair na hora
   * (destino com folga, ex.: ligado direto ao produto acabado), a próxima só é criada
   * 1 s depois, para nunca gerar infinitas peças no mesmo instante.
   */
  private refillSource(src: NodeRt): void {
    const max = src.def.maxArrivals;
    if (src.out.length === 0 || src.refillPending || src.done.length > 0) return;
    if (max > 0 && src.released >= max) return;
    src.done.push(this.newEntity(src));
    this.tryPush(src, false);
    if (src.done.length === 0) {
      src.refillPending = true;
      this.schedule(this.now + SOURCE_MIN_GAP, 'refill', { node: src });
    }
  }

  /** Tenta despachar peças terminadas. Retorna true se alguma saiu. */
  private tryPush(n: NodeRt, refill = true): boolean {
    let moved = false;
    let staged = false;
    for (let i = 0; i < n.done.length; ) {
      const e = n.done[i];
      if (e.awaitingPickup) {
        i++;
        continue;
      }
      const link = e.next;
      if (!link) {
        // Sem saída definida: a peça deixa o sistema neste ponto.
        n.done.splice(i, 1);
        this.freeSlot(n, e);
        if (n.def.type !== 'source') this.exitSystem(e);
        moved = true;
        continue;
      }
      // Retorno do retrabalho ou de uma amostragem (OBA) tem prioridade (pista de retorno),
      // para o loop nunca travar.
      if (!this.isReturn(n, link) && !this.canAcceptVia(link)) {
        i++;
        continue;
      }
      link.reserved++;
      if (!link.isPart) {
        link.to.reserved++;
        link.to.reservedUnits += e.qty;
      }
      if (link.pool) {
        // Transporte por veículo: a peça espera no posto até ser buscada.
        e.awaitingPickup = true;
        const trip = this.tripOf(link);
        if (trip > 1) this.freeSlot(n, e);
        if (trip > 1) {
          staged = true;
          // junta peças na saída do posto até completar a viagem (ou até o destino não ter mais lugar)
          const wait = n.done.filter((x) => x.awaitingPickup && !x.called && x.next === link);
          if (wait.length >= Math.min(trip, this.roomOf(link))) {
            for (const x of wait) x.called = true;
            this.requestVehicle(n, wait[0], link, wait);
          }
        } else {
          e.called = true;
          this.requestVehicle(n, e, link);
        }
        i++;
        continue;
      }
      n.done.splice(i, 1);
      moved = true;
      this.depart(n, e, link, link.travelTime);
    }
    // viagem incompleta, mas o destino já não tem lugar (ex.: dois postos abastecendo o mesmo destino): leva o que tem
    for (const e of n.done) {
      // com carrinho/bin próprio do item a viagem sempre completa (o bin esvazia com o consumo): sem viagem parcial
      if (!e.awaitingPickup || e.called || !e.next || this.tripOf(e.next) <= 1 || this.binCap(e.next) || this.canAcceptVia(e.next)) continue;
      const wait = n.done.filter((x) => x.awaitingPickup && !x.called && x.next === e.next);
      for (const x of wait) x.called = true;
      this.requestVehicle(n, wait[0], e.next, wait);
    }
    if (moved) this.afterDeparture(n, refill);
    // peça foi para a espera da viagem: libera a giga para a próxima
    else if (staged && n.def.type !== 'source') this.tryStart(n);
    this.updateState(n);
    return moved;
  }

  /**
   * Fatos para o diagnóstico de trava: postos com peça parada e o motivo de configuração.
   * Só olha o estado atual; quem decide se a linha está travada é o diagnose.ts.
   */
  stuckFacts(): StuckFact[] {
    const out: StuckFact[] = [];
    const moving = this.transits.size > 0 || this.pools.some((p) => p.units.some((u) => u.busy));
    for (const n of this.nodes) {
      const id = n.def.id;
      if (n.def.type === 'sink' || n.down || n.paused) continue;
      if (n.queue.length > 0 && n.processing.length === 0) {
        for (const l of n.partLinks) {
          const have = n.parts.get(l)!.length;
          if (have < this.partQty(l)) out.push({ kind: 'parts', node: id, link: l.def.id, from: l.from.def.id, have, need: this.partQty(l) });
        }
        const batch = this.batchOf(n);
        const units = this.queuedUnits(n) + n.reservedUnits;
        if (batch && units < batch) out.push({ kind: 'batch', node: id, have: this.queuedUnits(n), need: batch });
        if (n.pool && n.pool.units.length === 0) out.push({ kind: 'noUnits', node: id, pool: n.pool.def.id });
      }
      if (n.partLinks.length && n.queue.length === 0 && !n.inLinks.some((l) => !l.isPart)) out.push({ kind: 'noMain', node: id });
      // componentes chegando, mas o produto (Principal) não vem
      const withParts = n.partLinks.find((l) => n.parts.get(l)!.length > 0);
      if (withParts && n.queue.length === 0 && n.processing.length === 0 && n.inLinks.some((l) => !l.isPart))
        out.push({ kind: 'waitMain', node: id, from: n.inLinks.filter((l) => !l.isPart).map((l) => l.from.def.id), part: withParts.def.id, partFrom: withParts.from.def.id });
      const seen = new Set<LinkRt>();
      for (const e of n.done) {
        const l = e.next;
        if (!l || seen.has(l)) continue;
        if (e.awaitingPickup) {
          if (l.pool && l.pool.units.length === 0) {
            seen.add(l);
            out.push({ kind: 'noUnits', node: id, link: l.def.id, pool: l.pool.def.id });
          } else if (!e.called && this.tripOf(l) > 1 && !moving) {
            seen.add(l);
            const have = n.done.filter((x) => x.next === l && x.awaitingPickup && !x.called).length;
            out.push({ kind: 'trip', node: id, link: l.def.id, have, need: this.tripOf(l) });
          }
        } else if (!this.canAcceptVia(l) && l.to.processing.length === 0) {
          seen.add(l);
          out.push({ kind: 'full', node: id, link: l.def.id, to: l.to.def.id });
        }
      }
    }
    return out;
  }

  /** Nada se mexe: nenhum posto trabalhando, nenhuma peça ou recurso andando, e há peças na linha. */
  get deadlocked(): boolean {
    if (this.wip <= 0 || this.transits.size > 0) return false;
    if (this.pools.some((p) => p.units.some((u) => u.busy))) return false;
    return this.nodes.every((n) => n.processing.length === 0 && !n.down && !n.paused && this.now >= n.setupUntil);
  }

  private isReturn(n: NodeRt, link: LinkRt): boolean {
    return n.def.type === 'rework' || link.to.out.some((l) => l.def.once && l.to === n);
  }

  private freeSlot(n: NodeRt, e: Entity): void {
    if (e.slot >= 0 && e.slot < n.slotBusy.length) n.slotBusy[e.slot] = false;
    e.slot = -1;
  }

  private depart(n: NodeRt, e: Entity, link: LinkRt, travel: number, unit?: UnitRt): void {
    this.freeSlot(n, e);
    if (n.def.type === 'source') {
      e.releasedAt = this.now;
      n.released++;
      this.setWip(this.wip + 1);
    } else {
      e.blockedTime += (this.now - e.blockedSince) * e.qty;
    }
    if (link.to.def.type === 'rework') {
      n.rejected++;
      e.reworks++;
    }
    link.moved++;
    if (link.def.once) (e.visited ??= new Set()).add(link.def.id);
    e.distance += link.distance * e.qty;
    const tr: Transit = { entity: e, link, start: this.now, end: this.now + travel, unit };
    this.transits.add(tr);
    this.schedule(tr.end, 'arrive', { transit: tr });
  }

  private afterDeparture(n: NodeRt, refill = true): void {
    if (n.def.type === 'source') {
      if (refill && n.def.interarrival <= 0) this.refillSource(n);
    } else {
      this.tryStart(n);
      this.notifyUpstream(n);
    }
  }

  private partQty(l: LinkRt): number {
    return Math.max(1, Math.round(l.def.partQty ?? 1));
  }

  private partsReady(n: NodeRt): boolean {
    for (const l of n.partLinks) if (n.parts.get(l)!.length < this.partQty(l)) return false;
    return true;
  }

  private tryStart(n: NodeRt): void {
    if (n.down || n.paused || this.now < n.setupUntil) {
      this.updateState(n);
      return;
    }
    const servers = Math.max(1, n.def.capacity);
    let pulled = false;
    const batch = this.batchOf(n);
    while (
      n.queue.length > 0 &&
      n.processing.length + n.done.length - this.staged(n) < servers &&
      (this.partsReady(n) || !!n.queue[0].assembled?.has(n.def.id)) &&
      (!batch || this.queuedUnits(n) >= batch)
    ) {
      let slot = n.slotBusy.indexOf(false);
      if (slot < 0) slot = 0;
      const sp = n.slots[slot] ?? { x: n.def.x, y: n.def.y };
      let unit: UnitRt | undefined;
      let walk = 0;
      if (n.pool) {
        unit = this.freeUnit(n.pool, sp.x, sp.y);
        if (!unit) {
          if (!n.waitingPool) {
            n.waitingPool = true;
            n.pool.queue.push({ kind: 'station', node: n });
            n.pool.requests++;
          }
          break;
        }
        walk = this.sendUnit(unit, sp.x, sp.y, n.def.name);
      }
      const e = batch ? this.formBatch(n, batch) : n.queue.shift()!;
      e.slot = slot;
      if (slot < n.slotBusy.length) n.slotBusy[slot] = true;
      if (!batch) {
        e.queueTime += (this.now - e.enteredQueueAt) * e.qty;
        n.queueTimeSum += this.now - e.enteredQueueAt;
      }
      n.started++;
      const reassembly = !!e.assembled?.has(n.def.id);
      if (n.partLinks.length && !reassembly) (e.assembled ??= new Set()).add(n.def.id);
      for (const l of reassembly ? [] : n.partLinks) {
        for (let k = this.partQty(l); k > 0; k--) {
          const part = n.parts.get(l)!.shift();
          if (!part) break;
          e.work += part.work;
          this.consumed++;
          this.setWip(this.wip - 1);
        }
        this.retry.add(l.from);
      }
      const handling = n.def.handlingTime ?? 0;
      // troca de modelo: o posto para o tempo de troca quando o modelo muda
      let change = 0;
      if (e.product && n.def.changeover && n.lastProduct && n.lastProduct !== e.product) {
        change = n.def.changeover;
        n.changeovers++;
        n.changeoverTime += change;
      }
      if (e.product) n.lastProduct = e.product;
      const duration = walk + change + (unit ? handling : 0) + sampleTime(this.rng, this.meanTime(n, e.product) / (n.def.efficiency || 1), n.def.cv, n.def.dist);
      const job: Job = { entity: e, start: this.now, end: this.now + duration, duration, remaining: duration, token: 0 };
      if (unit) {
        if (handling > 0) this.schedule(this.now + walk + handling, 'unitFree', { unit });
        else job.unit = unit;
      }
      n.processing.push(job);
      this.schedule(job.end, 'end', { node: n, job, token: job.token });
      pulled = true;
    }
    this.updateState(n);
    if (pulled) this.notifyUpstream(n);
  }

  /** Junta `size` unidades da fila numa carga; quebra a última carga se sobrar. */
  private formBatch(n: NodeRt, size: number): Entity {
    const members: number[] = [];
    const carrier: Entity = {
      id: ++this.entitySeq,
      releasedAt: Infinity,
      procTime: 0,
      queueTime: 0,
      blockedTime: 0,
      transTime: 0,
      distance: 0,
      reworks: 0,
      enteredQueueAt: this.now,
      blockedSince: this.now,
      next: null,
      awaitingPickup: false,
      slot: -1,
      qty: 0,
      members,
      work: 0,
      counted: true,
      product: n.queue[0]?.product,
    };
    let need = size;
    while (need > 0 && n.queue.length > 0) {
      const e = n.queue[0];
      const take = Math.min(need, e.qty);
      const f = take / e.qty;
      const times = e.members ?? [e.releasedAt];
      members.push(...times.slice(0, take));
      carrier.procTime += e.procTime * f;
      carrier.queueTime += e.queueTime * f + (this.now - e.enteredQueueAt) * take;
      carrier.blockedTime += e.blockedTime * f;
      carrier.transTime += e.transTime * f;
      carrier.distance += e.distance * f;
      carrier.work += e.work * f;
      carrier.reworks += e.qty === 1 ? (e.reworks > 0 ? 1 : 0) : Math.round(e.reworks * f);
      carrier.counted = carrier.counted && e.counted;
      carrier.releasedAt = Math.min(carrier.releasedAt, e.releasedAt);
      carrier.qty += take;
      need -= take;
      if (take === e.qty) n.queue.shift();
      else {
        // Sobra da carga continua na fila para a próxima.
        e.qty -= take;
        e.members = times.slice(take);
        for (const k of ['procTime', 'queueTime', 'blockedTime', 'transTime', 'distance', 'work'] as const) e[k] *= 1 - f;
      }
    }
    return carrier;
  }

  // ---- Recursos (operadores e veículos) ----

  /** Posição de um operador/veículo no instante t (interpolada durante deslocamentos). */
  positionOf(u: UnitRt, t: number): { x: number; y: number } {
    const m = u.move;
    if (!m || t >= m.t1) return { x: u.x, y: u.y };
    if (t <= m.t0) return { x: m.x0, y: m.y0 };
    const f = (t - m.t0) / (m.t1 - m.t0);
    if (m.pts) return pointAt(m.pts, f);
    return { x: m.x0 + (m.x1 - m.x0) * f, y: m.y0 + (m.y1 - m.y0) * f };
  }

  private freeUnit(pool: PoolRt, x: number, y: number): UnitRt | undefined {
    let best: UnitRt | undefined;
    let bestD = Infinity;
    for (const u of pool.units) {
      if (u.busy) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best) {
      best.busy = true;
      best.busySince = this.now;
      best.tasks++;
    }
    return best;
  }

  /** Desloca a unidade até (x, y) a partir de agora; retorna o tempo de deslocamento (s). */
  private sendUnit(u: UnitRt, x: number, y: number, where: string, t0 = this.now): number {
    const p = this.positionOf(u, t0);
    const key = `${p.x},${p.y}|${x},${y}`;
    const meters = this.lengths.get(key) ?? Math.hypot(x - p.x, y - p.y) / this.ppm;
    const speed = u.pool.def.speed > 0 ? u.pool.def.speed : Infinity;
    const dt = meters / speed;
    u.distance += meters;
    u.move = { x0: p.x, y0: p.y, x1: x, y1: y, t0, t1: t0 + dt, pts: this.routes.get(key) };
    u.x = x;
    u.y = y;
    u.where = where;
    return dt;
  }

  private releaseUnit(u: UnitRt): void {
    u.busy = false;
    u.loaded = false;
    u.busyTime += this.now - u.busySince;
    this.servePool(u.pool);
  }

  private servePool(pool: PoolRt): void {
    while (pool.queue.length > 0 && pool.units.some((u) => !u.busy)) {
      const req = pool.queue.shift()!;
      if (req.kind === 'station') {
        req.node.waitingPool = false;
        this.tryStart(req.node);
      } else {
        this.assignVehicle(req.node, req.entity, req.link, req.group);
      }
    }
  }

  private tripOf(link: LinkRt): number {
    const q = Math.round(link.def.tripQty ?? 1);
    return link.pool && q > 1 ? q : 1;
  }

  /** Quantas peças cabem no destino do trecho: a viagem nunca espera mais que isso. */
  private roomOf(l: LinkRt): number {
    const bin = this.binCap(l);
    if (bin) return bin;
    if (l.isPart) return this.partQty(l) * Math.max(1, l.to.def.partBuffer ?? 2);
    const t = l.to.def.type;
    if (t === 'sink') return Infinity;
    const batch = this.batchOf(l.to);
    return Math.max(1, (batch || Math.max(1, l.to.def.capacity)) + Math.max(0, l.to.def.queueCap));
  }

  /** Peças prontas esperando completar a viagem: não seguram a giga do posto. */
  private staged(n: NodeRt): number {
    let k = 0;
    for (const e of n.done) if (e.awaitingPickup && e.next && this.tripOf(e.next) > 1) k++;
    return k;
  }

  private requestVehicle(n: NodeRt, e: Entity, link: LinkRt, group?: Entity[]): void {
    const pool = link.pool!;
    pool.requests++;
    if (pool.units.some((u) => !u.busy)) this.assignVehicle(n, e, link, group);
    else pool.queue.push({ kind: 'move', node: n, entity: e, link, group });
  }

  private assignVehicle(n: NodeRt, e: Entity, link: LinkRt, group?: Entity[]): void {
    const pool = link.pool!;
    const u = this.freeUnit(pool, n.def.x, n.def.y)!;
    const dt = this.sendUnit(u, n.def.x, n.def.y, n.def.name);
    this.schedule(this.now + dt + pool.def.loadTime, 'pickup', { node: n, entity: e, link, unit: u, group });
  }

  private onPickup(n: NodeRt, e: Entity, link: LinkRt, u: UnitRt, group?: Entity[]): void {
    const load = group?.length ? group : [e];
    u.loaded = true;
    const travel = this.sendUnit(u, link.to.def.x, link.to.def.y, link.to.def.name);
    // o recurso leva todas as peças da viagem juntas; só a primeira libera o recurso na chegada
    load.forEach((x, i) => {
      const idx = n.done.indexOf(x);
      if (idx >= 0) n.done.splice(idx, 1);
      x.awaitingPickup = false;
      x.called = false;
      this.depart(n, x, link, travel, i === 0 ? u : undefined);
    });
    this.afterDeparture(n);
    this.tryStart(n);
    this.updateState(n);
  }

  // ---- Fluxo ----

  private onEnd(n: NodeRt, job: Job, token: number): void {
    if (token !== job.token) return;
    const idx = n.processing.indexOf(job);
    if (idx < 0) return;
    n.processing.splice(idx, 1);
    const e = job.entity;
    e.procTime += job.duration * e.qty;
    e.work += n.def.cycleTime;
    n.processed++;
    this.onCycle?.({ node: n.def, serial: e.id, start: job.start, end: this.now, product: e.product });
    if (job.unit) this.releaseUnit(job.unit);
    e.next = this.route(n, e);
    e.blockedSince = this.now;
    n.done.push(e);
    this.tryPush(n);
    this.tryStart(n);
  }

  private onArrive(tr: Transit): void {
    this.transits.delete(tr);
    const e = tr.entity;
    const l = tr.link;
    const to = l.to;
    e.transTime += (tr.end - tr.start) * e.qty;
    if (tr.unit) {
      const pool = tr.unit.pool;
      // Descarga no destino: o veículo fica livre depois do tempo de descarga.
      this.schedule(this.now + pool.def.loadTime, 'unitFree', { unit: tr.unit });
    }
    to.entered++;
    l.reserved--;
    if (l.isPart) {
      to.parts.get(l)!.push(e);
      this.tryStart(to);
      return;
    }
    to.reserved--;
    to.reservedUnits -= e.qty;
    if (to.def.outputPoint && !e.counted) this.recordOutput(e);
    if (to.def.type === 'sink') {
      to.processed += e.qty;
      this.exitSystem(e);
      this.updateState(to);
      return;
    }
    e.enteredQueueAt = this.now;
    e.via = l;
    to.queue.push(e);
    this.tryStart(to);
  }

  private exitSystem(e: Entity): void {
    this.setWip(this.wip - e.qty);
    this.shipped += e.qty;
    this.shippedLoads++;
    if (!e.counted && !this.hasOutputPoint) this.recordOutput(e);
  }

  /** Conta a produção da linha (no ponto de medição, ou no destino final se não houver). */
  private recordOutput(e: Entity): void {
    e.counted = true;
    this.lastOutputAt = this.now;
    const q = e.qty;
    if (e.product) this.producedBy[e.product] = (this.producedBy[e.product] ?? 0) + q;
    this.completed += q;
    this.completedGood += q === 1 ? (e.reworks === 0 ? 1 : 0) : Math.max(0, q - e.reworks);
    if (e.members) for (const r of e.members) this.leadTimeSum += this.now - r;
    else this.leadTimeSum += (this.now - e.releasedAt) * q;
    this.procSum += e.procTime;
    this.queueSum += e.queueTime;
    this.blockedSum += e.blockedTime;
    this.transSum += e.transTime;
    this.distanceSum += e.distance;
    this.workSum += e.work;
    if (this.lastExit >= 0) {
      this.intervals += q;
      if ((this.now - this.lastExit) / q <= this.model.settings.takt + 1e-9) this.taktOk += q;
    }
    this.lastExit = this.now;
  }

  private onFail(n: NodeRt): void {
    n.down = true;
    n.failures++;
    if (!n.paused) this.freeze(n);
    this.updateState(n);
    this.schedule(this.now + this.rng.exponential(n.def.mttr), 'repair', { node: n });
  }

  private onRepair(n: NodeRt): void {
    n.down = false;
    if (!n.paused) this.unfreeze(n);
    this.tryStart(n);
    this.updateState(n);
    this.schedule(this.now + this.rng.exponential(this.mtbf(n.def)), 'fail', { node: n });
  }

  private computeState(n: NodeRt): NodeState {
    const t = n.def.type;
    if (t === 'sink') return n.processed > 0 ? 'working' : 'off';
    if (t === 'source') {
      if (n.done.some((e) => e.awaitingPickup)) return 'resource';
      return n.done.length > 0 && n.released > 0 ? 'blocked' : n.released > 0 ? 'working' : 'off';
    }
    if (n.paused) return 'break';
    if (n.down) return 'down';
    if (this.now < n.setupUntil) return 'setup';
    if (n.processing.length > 0) return 'working';
    if (n.done.length > 0) return n.done.some((e) => e.awaitingPickup) ? 'resource' : 'blocked';
    if (n.waitingPool) return 'resource';
    if (n.entered === 0) return 'off';
    return 'starved';
  }

  private updateState(n: NodeRt): void {
    if (n.processing.length !== n.workCount) {
      n.workArea += n.workCount * (this.now - n.workSince);
      n.workSince = this.now;
      n.workCount = n.processing.length;
    }
    const s = this.computeState(n);
    if (s === n.state) return;
    n.stateTime[n.state] += this.now - n.stateSince;
    n.state = s;
    n.stateSince = this.now;
  }

  private setWip(v: number): void {
    this.wipIntegral += this.wip * (this.now - this.wipSince);
    this.wipSince = this.now;
    this.wip = v;
  }

  private sample(): void {
    // Throughput numa janela móvel de ~10 min para suavizar a curva.
    const window = Math.max(600, this.sampleEvery);
    let ref = this.lastSample;
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      const p = this.timeline[i];
      if (p.t < this.statsStart || this.now - p.t > window) break;
      ref = { t: p.t, completed: p.completed };
    }
    const dt = this.now - ref.t;
    const dc = this.completed - ref.completed;
    this.timeline.push({
      t: this.now,
      completed: this.completed,
      wip: this.wip,
      throughputPerHour: dt > 0 ? (dc * 3600) / dt : 0,
      processed: this.nodes.map((n) => n.processed),
    });
    this.lastSample = { t: this.now, completed: this.completed };
  }

  private resetStats(): void {
    for (const n of this.nodes) {
      n.stateTime = zeroStates();
      n.stateSince = this.now;
      n.workArea = 0;
      n.workSince = this.now;
      n.processed = 0;
      n.started = 0;
      n.queueTimeSum = 0;
      n.rejected = 0;
      n.failures = 0;
    }
    for (const l of this.links) l.moved = 0;
    for (const p of this.pools) {
      p.waitSum = 0;
      p.requests = 0;
      for (const u of p.units) {
        u.busyTime = 0;
        if (u.busy) u.busySince = this.now;
        u.distance = 0;
        u.tasks = 0;
      }
    }
    this.statsStart = this.now;
    this.completed = this.completedGood = this.consumed = this.shipped = this.shippedLoads = this.workSum = 0;
    this.leadTimeSum = this.procSum = this.queueSum = this.blockedSum = this.transSum = this.distanceSum = 0;
    this.taktOk = this.intervals = 0;
    this.wipIntegral = 0;
    this.wipSince = this.now;
    this.lastSample = { t: this.now, completed: 0 };
  }

  /** Tempo acumulado em cada estado, incluindo o intervalo em aberto. */
  stateTimes(n: NodeRt): Record<NodeState, number> {
    const r = { ...n.stateTime };
    r[n.state] += this.now - n.stateSince;
    return r;
  }

  /** Utilização média dos postos/gigas do nó (0..1). */
  workUtilization(n: NodeRt): number {
    const elapsed = this.now - this.statsStart;
    if (elapsed <= 0) return 0;
    const area = n.workArea + n.workCount * (this.now - Math.max(n.workSince, this.statsStart));
    return area / (elapsed * Math.max(1, n.def.capacity));
  }

  /** Tempo ocupado de uma unidade, incluindo a tarefa em andamento. */
  unitBusyTime(u: UnitRt): number {
    return u.busyTime + (u.busy ? this.now - Math.max(u.busySince, this.statsStart) : 0);
  }

  /** WIP médio ponderado no tempo desde o início das estatísticas. */
  avgWip(): number {
    const elapsed = this.now - this.statsStart;
    if (elapsed <= 0) return this.wip;
    return (this.wipIntegral + this.wip * (this.now - this.wipSince)) / elapsed;
  }

  /** WIP de um nó (fila + processo + bloqueadas + estoque de componentes). */
  nodeWip(n: NodeRt): number {
    if (n.def.type === 'source' || n.def.type === 'sink') return 0;
    let parts = 0;
    for (const arr of n.parts.values()) parts += arr.length;
    let units = parts;
    for (const e of n.queue) units += e.qty;
    for (const j of n.processing) units += j.entity.qty;
    for (const e of n.done) units += e.qty;
    return units;
  }
}
