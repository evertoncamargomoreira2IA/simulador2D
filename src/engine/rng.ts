// Gerador pseudoaleatório determinístico (mulberry32) para permitir replay idêntico.
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  exponential(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Lognormal com média `mean` e coeficiente de variação `cv` (sempre positivo). */
  lognormal(mean: number, cv: number): number {
    if (mean <= 0) return 0;
    if (cv <= 0) return mean;
    const s2 = Math.log(1 + cv * cv);
    return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * this.normal());
  }
}
