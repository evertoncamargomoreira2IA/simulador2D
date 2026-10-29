// Trilha de uma seta: pontos de curva entre os blocos, usados no desenho, na distância e no caminho do transporte.

export interface Pt {
  x: number;
  y: number;
}

/** Polilinha [x0, y0, x1, y1, ...] do centro de a, pelos pontos de curva, até o centro de b. */
export function polyline(a: Pt, b: Pt, path?: Pt[]): number[] {
  return [a.x, a.y, ...(path ?? []).flatMap((p) => [p.x, p.y]), b.x, b.y];
}

export function polyLength(pts: number[]): number {
  let s = 0;
  for (let i = 2; i < pts.length; i += 2) s += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  return s;
}

/** Ponto na fração f (0..1) do comprimento da polilinha. */
export function pointAt(pts: number[], f: number): Pt {
  const total = polyLength(pts);
  let left = Math.max(0, Math.min(1, f)) * total;
  for (let i = 2; i < pts.length; i += 2) {
    const seg = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (left <= seg || i === pts.length - 2) {
      const g = seg > 0 ? Math.min(1, left / seg) : 1;
      return { x: pts[i - 2] + (pts[i] - pts[i - 2]) * g, y: pts[i - 1] + (pts[i + 1] - pts[i - 1]) * g };
    }
    left -= seg;
  }
  return { x: pts[0], y: pts[1] };
}

/** Mesma polilinha no sentido contrário. */
export function reversePts(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
  return out;
}

/** Distância do ponto (x, y) até a polilinha. */
export function distToPoly(pts: number[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 2; i < pts.length; i += 2) {
    const [x1, y1, x2, y2] = [pts[i - 2], pts[i - 1], pts[i], pts[i + 1]];
    const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
    const f = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / len2));
    best = Math.min(best, Math.hypot(x - (x1 + f * (x2 - x1)), y - (y1 + f * (y2 - y1))));
  }
  return best;
}
