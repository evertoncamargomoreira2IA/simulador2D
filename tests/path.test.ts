import { describe, expect, it } from 'vitest';
import { distToPoly, pointAt, polyLength, polyline } from '../src/engine/path';
import { Simulator } from '../src/engine/simulator';
import { transportModel } from '../src/model/builder';

describe('trilha da seta', () => {
  it('mede e anda pela polilinha', () => {
    const pts = polyline({ x: 0, y: 0 }, { x: 100, y: 100 }, [{ x: 100, y: 0 }]);
    expect(polyLength(pts)).toBe(200);
    expect(pointAt(pts, 0.25)).toEqual({ x: 50, y: 0 });
    expect(pointAt(pts, 0.75)).toEqual({ x: 100, y: 50 });
    expect(distToPoly(pts, 50, 10)).toBe(10);
  });

  it('distância do trecho e caminho do operador seguem a trilha', () => {
    const m = transportModel();
    const l = m.links.find((x) => x.from === 'B1' && x.to === 'D')!;
    const a = m.nodes.find((n) => n.id === 'B1')!;
    const b = m.nodes.find((n) => n.id === 'D')!;
    const corner = { x: a.x, y: b.y + 200 };
    l.path = [corner];
    const route = polyline(a, b, l.path);
    const ppm = m.settings.pxPerMeter || 40;
    const s = new Simulator(m);
    const rt = s.links.find((x) => x.def.id === l.id)!;
    expect(rt.distance).toBeCloseTo(polyLength(route) / ppm, 5);
    // em algum momento o operador passa perto do ponto de curva (longe da reta B1 → D)
    let near = false;
    for (let t = 30; t < 3600 && !near; t += 0.5) {
      s.advanceTo(t);
      for (const u of s.pools.flatMap((p) => p.units)) {
        const p = s.positionOf(u, s.now);
        if (Math.hypot(p.x - corner.x, p.y - corner.y) < 15) near = true;
      }
    }
    expect(near).toBe(true);
  });
});
