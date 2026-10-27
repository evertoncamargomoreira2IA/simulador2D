// Motor de simulação de eventos discretos (DES).
//
// Semântica:
// - Cada nó tem `capacity` postos (servidores) e uma fila de entrada `queueCap`.
// - Uma peça terminada fica no posto (bloqueio após serviço) até o destino aceitar.
// - O destino é escolhido no fim do processamento pelos pesos dos links.
// - Ao sair, a peça reserva lugar no destino e viaja pelo link (transporte).
// - Peças saindo do retrabalho sempre entram no destino (pista de retorno), evitando deadlock.
// - Falhas: MTBF derivado de disponibilidade e MTTR; processamento é pausado.

import { MinHeap } from './heap';
import { Rng } from './rng';
import type { LinkDef, Model, NodeDef, NodeState } from './types';

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
}

interface Job {
  entity: Entity;
  start: number;
  end: number;
  duration: number;
  remaining: number;
  token: number;
}

export interface LinkRt {
  def: LinkDef;
  from: NodeRt;
  to: NodeRt;
  distance: number;
  travelTime: number;
  moved: number;
}

export interface NodeRt {
  def: NodeDef;
  out: LinkRt[];
  inLinks: LinkRt[];
  queue: Entity[];
  processing: Job[];
  done: Entity[];
  reserved: number;
  down: boolean;
  setupUntil: number;
  state: NodeState;
  stateSince: number;
  stateTime: Record<NodeState, number>;
  entered: number;
  processed: number;
  failures: number;
  /** Peças que a inspeção mandou para retrabalho. */
  rejected: number;
  released: number;
  refillPending: boolean;
}

export interface Transit {
  entity: Entity;
  link: LinkRt;
  start: number;
  end: number;
}

type EvKind = 'create' | 'refill' | 'end' | 'arrive' | 'fail' | 'repair' | 'wake' | 'sample' | 'warmup';
interface SimEvent {
  t: number;
  seq: number;
  kind: EvKind;
  node?: NodeRt;
  job?: Job;
  token?: number;
  transit?: Transit;
}

export interface TimelinePoint {
  t: number;
  completed: number;
  wip: number;
  throughputPerHour: number;
}

/** Intervalo mínimo (s) entre peças de uma fonte ilimitada quando a saída está livre. */
const SOURCE_MIN_GAP = 1;
/** Proteção contra loops de tempo zero (modelo com ciclo sem tempo). */
const MAX_SAME_TIME_EVENTS = 200_000;

const STATES: NodeState[] = ['working', 'starved', 'blocked', 'down', 'setup', 'off'];
const zeroStates = (): Record<NodeState, number> =>
  Object.fromEntries(STATES.map((s) => [s, 0])) as Record<NodeState, number>;

export class Simulator {
  readonly model: Model;
  readonly nodes: NodeRt[] = [];
  readonly links: LinkRt[] = [];
  readonly byId = new Map<string, NodeRt>();
  readonly transits = new Set<Transit>();
  readonly timeline: TimelinePoint[] = [];
  now = 0;
  statsStart = 0;
  completed = 0;
  completedGood = 0;
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
  private lastSample = { t: 0, completed: 0 };
  readonly sampleEvery: number;
  /** Preenchido quando a simulação é interrompida por um modelo inválido. */
  error: string | null = null;
  private sameTimeEvents = 0;

  constructor(model: Model) {
    this.model = model;
    this.rng = new Rng(model.settings.seed);
    const ppm = model.settings.pxPerMeter || 40;
    for (const def of model.nodes) {
      const n: NodeRt = {
        def,
        out: [],
        inLinks: [],
        queue: [],
        processing: [],
        done: [],
        reserved: 0,
        down: false,
        setupUntil: def.setupTime > 0 ? def.setupTime : 0,
        state: 'off',
        stateSince: 0,
        stateTime: zeroStates(),
        entered: 0,
        processed: 0,
        failures: 0,
        rejected: 0,
        released: 0,
        refillPending: false,
      };
      this.nodes.push(n);
      this.byId.set(def.id, n);
    }
    for (const def of model.links) {
      const from = this.byId.get(def.from);
      const to = this.byId.get(def.to);
      if (!from || !to || from === to) continue;
      const distance = Math.hypot(to.def.x - from.def.x, to.def.y - from.def.y) / ppm;
      const speed = model.settings.transportSpeed > 0 ? model.settings.transportSpeed : Infinity;
      const l: LinkRt = { def, from, to, distance, travelTime: distance / speed, moved: 0 };
      from.out.push(l);
      to.inLinks.push(l);
      this.links.push(l);
    }
    this.sampleEvery = Math.max(60, Math.round(model.settings.duration / 240));
    this.init();
  }

  get duration(): number {
    return this.model.settings.duration;
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
    if (this.model.settings.warmup > 0) this.schedule(this.model.settings.warmup, 'warmup');
    this.drainRetry();
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
      case 'sample':
        this.sample();
        this.schedule(this.now + this.sampleEvery, 'sample');
        break;
      case 'warmup':
        this.resetStats();
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
    };
    e.next = this.route(src);
    return e;
  }

  private route(n: NodeRt): LinkRt | null {
    if (n.out.length === 0) return null;
    if (n.out.length === 1) return n.out[0];
    const total = n.out.reduce((s, l) => s + Math.max(0, l.def.weight), 0);
    if (total <= 0) return n.out[0];
    let r = this.rng.next() * total;
    for (const l of n.out) {
      r -= Math.max(0, l.def.weight);
      if (r <= 0) return l;
    }
    return n.out[n.out.length - 1];
  }

  canAccept(n: NodeRt): boolean {
    const t = n.def.type;
    if (t === 'sink') return true;
    if (t === 'source') return false;
    const occ = n.queue.length + n.processing.length + n.done.length + n.reserved;
    return occ < Math.max(1, n.def.capacity) + Math.max(0, n.def.queueCap);
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
    for (let i = 0; i < n.done.length; ) {
      const e = n.done[i];
      const link = e.next;
      if (!link) {
        // Sem saída definida: a peça deixa o sistema neste ponto.
        n.done.splice(i, 1);
        this.exitSystem(e);
        moved = true;
        continue;
      }
      // Retorno do retrabalho tem prioridade (pista de retorno) para evitar deadlock no loop.
      if (n.def.type !== 'rework' && !this.canAccept(link.to)) {
        i++;
        continue;
      }
      n.done.splice(i, 1);
      moved = true;
      if (n.def.type === 'source') {
        e.releasedAt = this.now;
        n.released++;
        this.setWip(this.wip + 1);
      } else {
        e.blockedTime += this.now - e.blockedSince;
      }
      if (link.to.def.type === 'rework') {
        n.rejected++;
        e.reworks++;
      }
      link.to.reserved++;
      link.moved++;
      e.distance += link.distance;
      const tr: Transit = { entity: e, link, start: this.now, end: this.now + link.travelTime };
      this.transits.add(tr);
      this.schedule(tr.end, 'arrive', { transit: tr });
    }
    if (moved) {
      if (n.def.type === 'source') {
        if (refill && n.def.interarrival <= 0) this.refillSource(n);
      } else {
        this.tryStart(n);
        this.notifyUpstream(n);
      }
    }
    this.updateState(n);
    return moved;
  }

  private tryStart(n: NodeRt): void {
    if (n.down || this.now < n.setupUntil) return;
    const servers = Math.max(1, n.def.capacity);
    let pulled = false;
    while (n.queue.length > 0 && n.processing.length + n.done.length < servers) {
      const e = n.queue.shift()!;
      e.queueTime += this.now - e.enteredQueueAt;
      const duration = this.rng.lognormal(n.def.cycleTime, n.def.cv);
      const job: Job = { entity: e, start: this.now, end: this.now + duration, duration, remaining: duration, token: 0 };
      n.processing.push(job);
      this.schedule(job.end, 'end', { node: n, job, token: job.token });
      pulled = true;
    }
    this.updateState(n);
    if (pulled) this.notifyUpstream(n);
  }

  private onEnd(n: NodeRt, job: Job, token: number): void {
    if (token !== job.token) return;
    const idx = n.processing.indexOf(job);
    if (idx < 0) return;
    n.processing.splice(idx, 1);
    const e = job.entity;
    e.procTime += job.duration;
    n.processed++;
    e.next = this.route(n);
    e.blockedSince = this.now;
    n.done.push(e);
    this.tryPush(n);
    this.tryStart(n);
  }

  private onArrive(tr: Transit): void {
    this.transits.delete(tr);
    const e = tr.entity;
    const to = tr.link.to;
    to.reserved--;
    e.transTime += tr.end - tr.start;
    to.entered++;
    if (to.def.type === 'sink') {
      to.processed++;
      this.exitSystem(e);
      this.updateState(to);
      return;
    }
    e.enteredQueueAt = this.now;
    to.queue.push(e);
    this.tryStart(to);
  }

  private exitSystem(e: Entity): void {
    this.setWip(this.wip - 1);
    this.completed++;
    if (e.reworks === 0) this.completedGood++;
    this.leadTimeSum += this.now - e.releasedAt;
    this.procSum += e.procTime;
    this.queueSum += e.queueTime;
    this.blockedSum += e.blockedTime;
    this.transSum += e.transTime;
    this.distanceSum += e.distance;
    if (this.lastExit >= 0) {
      this.intervals++;
      if (this.now - this.lastExit <= this.model.settings.takt + 1e-9) this.taktOk++;
    }
    this.lastExit = this.now;
  }

  private onFail(n: NodeRt): void {
    n.down = true;
    n.failures++;
    for (const job of n.processing) {
      job.remaining = job.end - this.now;
      job.token++;
    }
    this.updateState(n);
    this.schedule(this.now + this.rng.exponential(n.def.mttr), 'repair', { node: n });
  }

  private onRepair(n: NodeRt): void {
    n.down = false;
    for (const job of n.processing) {
      job.end = this.now + job.remaining;
      this.schedule(job.end, 'end', { node: n, job, token: job.token });
    }
    this.tryStart(n);
    this.updateState(n);
    this.schedule(this.now + this.rng.exponential(this.mtbf(n.def)), 'fail', { node: n });
  }

  private computeState(n: NodeRt): NodeState {
    const t = n.def.type;
    if (t === 'sink') return n.processed > 0 ? 'working' : 'off';
    if (t === 'source') return n.done.length > 0 && n.released > 0 ? 'blocked' : n.released > 0 ? 'working' : 'off';
    if (n.down) return 'down';
    if (this.now < n.setupUntil) return 'setup';
    if (n.processing.length > 0) return 'working';
    if (n.done.length > 0) return 'blocked';
    if (n.entered === 0) return 'off';
    return 'starved';
  }

  private updateState(n: NodeRt): void {
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
    });
    this.lastSample = { t: this.now, completed: this.completed };
  }

  private resetStats(): void {
    for (const n of this.nodes) {
      n.stateTime = zeroStates();
      n.stateSince = this.now;
      n.processed = 0;
      n.rejected = 0;
      n.failures = 0;
    }
    for (const l of this.links) l.moved = 0;
    this.statsStart = this.now;
    this.completed = this.completedGood = 0;
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

  /** WIP médio ponderado no tempo desde o início das estatísticas. */
  avgWip(): number {
    const elapsed = this.now - this.statsStart;
    if (elapsed <= 0) return this.wip;
    return (this.wipIntegral + this.wip * (this.now - this.wipSince)) / elapsed;
  }

  /** WIP de um nó (fila + processo + bloqueadas + reservadas a caminho). */
  nodeWip(n: NodeRt): number {
    if (n.def.type === 'source' || n.def.type === 'sink') return 0;
    return n.queue.length + n.processing.length + n.done.length;
  }
}
