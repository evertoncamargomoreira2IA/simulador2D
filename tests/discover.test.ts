import { describe, expect, it } from 'vitest';
import { discoverLine } from '../src/engine/discover';
import { lineKpi } from '../src/engine/metrics';
import { Simulator } from '../src/engine/simulator';
import { simulatedFeed } from '../src/io/realFeed';
import { discoveryDemoModel } from '../src/model/builder';

describe('Montar linha a partir das leituras', () => {
  const ev = simulatedFeed(discoveryDemoModel(), { hours: 4, glitch: 0.03, opCv: 0.12, drift: 0 });
  const d = discoverLine(ev)!;

  it('descobre os 6 postos na ordem da linha, com os testes em paralelo', () => {
    expect(d.stations.map((s) => s.name).slice(0, 3)).toEqual(['Preparação', 'Montagem', 'Aparafusamento']);
    expect(d.stations.at(-1)!.name).toBe('Embalagem');
    const ta = d.model.nodes.find((n) => n.name === 'Teste A')!;
    const tb = d.model.nodes.find((n) => n.name === 'Teste B')!;
    expect(ta.x).toBe(tb.x);
    expect(ta.y).not.toBe(tb.y);
  });

  it('acha as 2 gigas da montagem, os tempos e o mix', () => {
    expect(d.model.nodes.find((n) => n.name === 'Montagem')!.capacity).toBe(2);
    expect(d.model.nodes.find((n) => n.name === 'Preparação')!.capacity).toBe(1);
    expect(d.stations.find((s) => s.name === 'Preparação')!.mean).toBeCloseTo(38, 0);
    expect(d.products.map((p) => p.name).sort()).toEqual(['A', 'B']);
    const ap = d.model.nodes.find((n) => n.name === 'Aparafusamento')!;
    expect(ap.productTimes?.b).toBeGreaterThan(42);
  });

  it('o modelo montado roda e chega perto do ritmo medido', () => {
    const s = new Simulator(d.model);
    s.runToEnd();
    expect(s.error).toBeNull();
    expect(lineKpi(s).throughputPerHour / d.uph).toBeGreaterThan(0.85);
  });

  it('poucas leituras não montam nada', () => {
    expect(discoverLine(ev.slice(0, 2))).toBeNull();
  });
});
