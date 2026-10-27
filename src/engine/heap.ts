// Fila de prioridade (min-heap) por tempo; `seq` garante ordem FIFO em empates.
export interface HeapItem {
  t: number;
  seq: number;
}

export class MinHeap<T extends HeapItem> {
  private a: T[] = [];
  get size(): number {
    return this.a.length;
  }
  peek(): T | undefined {
    return this.a[0];
  }
  push(item: T): void {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

function less(x: HeapItem, y: HeapItem): boolean {
  return x.t < y.t || (x.t === y.t && x.seq < y.seq);
}
