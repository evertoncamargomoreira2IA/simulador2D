// Importação de layout DXF (AutoCAD) como planta de fundo do canvas.
// Converte linhas, polilinhas, arcos, círculos, textos e blocos (INSERT) para pixels,
// com Y invertido (no DXF o Y cresce para cima). Unidades: metros; acima de 500 de
// extensão o desenho é tratado como milímetros.

import DxfParser from 'dxf-parser';
import type { Background } from '../engine/types';

interface P {
  x: number;
  y: number;
}
interface Xf {
  base: P;
  sx: number;
  sy: number;
  rot: number;
  pos: P;
  parent?: Xf;
}

type RawText = { x: number; y: number; h: number; t: string; r: number };
interface Raw {
  paths: P[][];
  circles: { c: P; r: number }[];
  texts: RawText[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function apply(p: P, xf?: Xf): P {
  let q = p;
  for (let f = xf; f; f = f.parent) {
    const x = (q.x - f.base.x) * f.sx;
    const y = (q.y - f.base.y) * f.sy;
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    q = { x: f.pos.x + x * c - y * s, y: f.pos.y + x * s + y * c };
  }
  return q;
}

function scaleOf(xf?: Xf): number {
  let s = 1;
  for (let f = xf; f; f = f.parent) s *= Math.abs(f.sx);
  return s;
}

function rotOf(xf?: Xf): number {
  let r = 0;
  for (let f = xf; f; f = f.parent) r += f.rot;
  return r;
}

export function cleanMText(t: string): string {
  return t
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/\\[A-Za-z]/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function collect(entities: Any[], blocks: Record<string, Any>, out: Raw, xf: Xf | undefined, depth: number): void {
  for (const e of entities ?? []) {
    switch (e.type) {
      case 'LINE':
        if (e.vertices?.length >= 2) out.paths.push([apply(e.vertices[0], xf), apply(e.vertices[1], xf)]);
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const pts: P[] = (e.vertices ?? []).map((v: P) => apply(v, xf));
        if (pts.length >= 2) {
          if (e.shape || e.closed) pts.push(pts[0]);
          out.paths.push(pts);
        }
        break;
      }
      case 'CIRCLE':
        out.circles.push({ c: apply(e.center, xf), r: e.radius * scaleOf(xf) });
        break;
      case 'ARC': {
        const pts: P[] = [];
        let a0 = e.startAngle ?? 0;
        let a1 = e.endAngle ?? Math.PI * 2;
        if (a1 < a0) a1 += Math.PI * 2;
        const steps = Math.max(4, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 32));
        for (let i = 0; i <= steps; i++) {
          const a = a0 + ((a1 - a0) * i) / steps;
          pts.push(apply({ x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) }, xf));
        }
        out.paths.push(pts);
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        const raw = e.type === 'MTEXT' ? cleanMText(e.text ?? '') : String(e.text ?? '').trim();
        if (!raw) break;
        const pos = e.type === 'MTEXT' ? e.position : e.startPoint;
        if (!pos) break;
        const p = apply(pos, xf);
        const h = (e.textHeight ?? e.height ?? 0.2) * scaleOf(xf);
        const r = (e.rotation ?? 0) + (rotOf(xf) * 180) / Math.PI;
        out.texts.push({ x: p.x, y: p.y, h, t: raw, r });
        break;
      }
      case 'INSERT': {
        if (depth > 6) break;
        const b = blocks[e.name];
        if (!b?.entities?.length) break;
        const child: Xf = {
          base: b.position ?? { x: 0, y: 0 },
          sx: e.xScale ?? 1,
          sy: e.yScale ?? 1,
          rot: ((e.rotation ?? 0) * Math.PI) / 180,
          pos: e.position,
          parent: xf,
        };
        collect(b.entities, blocks, out, child, depth + 1);
        break;
      }
    }
  }
}

/** Percentil simples para descartar entidades muito longe do desenho principal. */
function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

export function parseDxf(text: string, pxPerMeter: number): Background {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text) as Any;
  if (!dxf) throw new Error('Arquivo DXF inválido.');
  const raw: Raw = { paths: [], circles: [], texts: [] };
  collect(dxf.entities, dxf.blocks ?? {}, raw, undefined, 0);

  const xs: number[] = [];
  const ys: number[] = [];
  for (const path of raw.paths) for (const p of path) (xs.push(p.x), ys.push(p.y));
  for (const t of raw.texts) (xs.push(t.x), ys.push(t.y));
  if (!xs.length) throw new Error('O DXF não tem linhas nem textos no espaço do modelo.');
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  // Faixa central do desenho (descarta blocos soltos muito longe).
  const lo = { x: pct(xs, 0.01), y: pct(ys, 0.01) };
  const hi = { x: pct(xs, 0.99), y: pct(ys, 0.99) };
  const span = Math.max(hi.x - lo.x, hi.y - lo.y, 1e-6);
  const unit = span > 500 ? 0.001 : 1; // mm → m
  const margin = span * 0.05;
  const inside = (p: P) => p.x >= lo.x - margin && p.x <= hi.x + margin && p.y >= lo.y - margin && p.y <= hi.y + margin;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (p: P) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  const paths = raw.paths.filter((path) => path.every(inside));
  const circles = raw.circles.filter((c) => inside(c.c));
  const texts = raw.texts.filter((t) => inside(t));
  paths.forEach((path) => path.forEach(grow));
  circles.forEach((c) => grow(c.c));
  texts.forEach(grow);

  const k = unit * pxPerMeter;
  const tx = (x: number) => Math.round((x - minX) * k * 10) / 10;
  const ty = (y: number) => Math.round((maxY - y) * k * 10) / 10;
  return {
    paths: paths.map((path) => path.flatMap((p) => [tx(p.x), ty(p.y)])),
    circles: circles.map((c) => [tx(c.c.x), ty(c.c.y), Math.round(c.r * k * 10) / 10]),
    texts: texts.map((t) => ({ x: tx(t.x), y: ty(t.y), h: Math.round(t.h * k * 10) / 10, t: t.t, ...(t.r ? { r: -t.r } : {}) })),
    width: (maxX - minX) * k,
    height: (maxY - minY) * k,
    originX: minX * unit,
    originY: maxY * unit,
    pxPerMeter,
  };
}

/** Converte um ponto do DXF (m) para pixels do canvas usando a mesma origem da planta. */
export function dxfToPx(bg: Background, xm: number, ym: number): { x: number; y: number } {
  return { x: (xm - bg.originX) * bg.pxPerMeter, y: (bg.originY - ym) * bg.pxPerMeter };
}

/** Posiciona os blocos cujo nome coincide com um texto da planta. Retorna quantos moveu. */
export function snapNodesToLabels(
  bg: Background,
  nodes: { name: string; x: number; y: number }[],
): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byLabel = new Map<string, { x: number; y: number }>();
  for (const t of bg.texts) if (!byLabel.has(norm(t.t))) byLabel.set(norm(t.t), t);
  let moved = 0;
  for (const n of nodes) {
    const hit = byLabel.get(norm(n.name));
    if (hit) {
      n.x = hit.x;
      n.y = hit.y;
      moved++;
    }
  }
  return moved;
}
