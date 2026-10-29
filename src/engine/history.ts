// Desfazer/refazer do editor (escrito pelo Codex, revisado e integrado no store).

type Entry<T> = { state: T; label?: string };

/** Pilha circular: descarta a entrada mais antiga sem deslocar as demais. */
class Stack<T> {
  private entries = new Map<number, T>();
  private start = 0;
  private size = 0;

  constructor(private readonly limit: number) {}

  get length(): number { return this.size; }

  peek(): T | undefined {
    return this.size === 0 ? undefined : this.entries.get(this.index(this.size - 1));
  }

  push(value: T): void {
    if (this.limit === 0) return;
    if (this.size === this.limit) {
      this.entries.set(this.start, value);
      this.start = (this.start + 1) % this.limit;
    } else {
      this.entries.set(this.index(this.size), value);
      this.size++;
    }
  }

  pop(): T | undefined {
    if (this.size === 0) return undefined;
    const index = this.index(--this.size);
    const value = this.entries.get(index);
    this.entries.delete(index);
    return value;
  }

  clear(): void {
    this.entries = new Map<number, T>();
    this.start = this.size = 0;
  }

  private index(offset: number): number {
    return (this.start + offset) % this.limit;
  }
}

/** Histórico de estados imutáveis, guardados por referência. */
export class History<T> {
  private readonly past: Stack<Entry<T>>;
  private readonly future: Stack<Entry<T>>;
  private readonly coalesceMs: number;
  private lastKey: string | undefined;
  private lastTime: number | undefined;

  constructor(opts: { limit?: number; coalesceMs?: number } = {}) {
    const limit = opts.limit ?? 60;
    const coalesceMs = opts.coalesceMs ?? 600;
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError('limit deve ser um inteiro não negativo.');
    }
    if (!Number.isFinite(coalesceMs) || coalesceMs < 0) {
      throw new RangeError('coalesceMs deve ser finito e não negativo.');
    }
    this.past = new Stack(limit);
    this.future = new Stack(limit);
    this.coalesceMs = coalesceMs;
  }

  /** Registra o estado anterior; agrupa pela chave e renova o horário. */
  push(prev: T, key?: string, now: number = Date.now(), label?: string): void {
    const coalesces = key !== undefined && key === this.lastKey
      && this.lastTime !== undefined && now >= this.lastTime
      && now - this.lastTime < this.coalesceMs;
    if (!coalesces) this.past.push({ state: prev, label });
    this.lastKey = key;
    this.lastTime = now;
    this.future.clear();
  }

  /** Devolve o estado anterior e guarda o atual para refazer. */
  undo(current: T): T | undefined {
    this.breakCoalescence();
    const entry = this.past.pop();
    if (entry === undefined) return undefined;
    this.future.push({ state: current, label: entry.label });
    return entry.state;
  }

  /** Reaplica a próxima ação e guarda o estado atual para desfazer. */
  redo(current: T): T | undefined {
    this.breakCoalescence();
    const entry = this.future.pop();
    if (entry === undefined) return undefined;
    this.past.push({ state: current, label: entry.label });
    return entry.state;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoLabel(): string | undefined { return this.past.peek()?.label; }
  get redoLabel(): string | undefined { return this.future.peek()?.label; }

  /** Limpa as pilhas e encerra qualquer agrupamento em andamento. */
  clear(): void {
    this.past.clear();
    this.future.clear();
    this.breakCoalescence();
  }

  private breakCoalescence(): void {
    this.lastKey = undefined;
    this.lastTime = undefined;
  }
}
