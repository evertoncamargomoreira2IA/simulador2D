import { describe, expect, it } from 'vitest';
import { Simulator } from '../src/engine/simulator';
import { lineKpi } from '../src/engine/metrics';
import { buildLine, lp2Model, simpleModel } from '../src/model/builder';

function serial(cts: number[], cv = 0) {
  const m = buildLine(
    cts.map((ct, i) => ({ name: `M${i + 1}`, cycleTime: ct, cv })),
    { name: 't', cycleTime: 12 },
  );
  m.settings.transportSpeed = 0; // transporte instantâneo
  m.settings.duration = 3600;
  return m;
}

describe('motor DES', () => {
  it('linha determinística produz no ritmo do gargalo', () => {
    const sim = new Simulator(serial([10, 12, 8]));
    sim.runToEnd();
    const k = lineKpi(sim);
    // 3600 s / 12 s = 300 peças, menos o enchimento da linha
    expect(k.completed).toBeGreaterThanOrEqual(296);
    expect(k.completed).toBeLessThanOrEqual(300);
    expect(sim.nodes.find((n) => n.def.name === 'M2')!.def.id).toBe(k.bottleneckId);
    expect(k.valueAddedTime).toBeCloseTo(30, 5);
  });

  it('bloqueio: posto rápido antes do gargalo fica bloqueado', () => {
    const sim = new Simulator(serial([5, 20]));
    sim.runToEnd();
    const k = lineKpi(sim);
    const m1 = k.nodes.find((n) => n.name === 'M1')!;
    expect(m1.states.blocked / k.elapsed).toBeGreaterThan(0.6);
    expect(k.throughputPerHour).toBeCloseTo(180, -1);
  });

  it('replay com a mesma semente é idêntico', () => {
    const a = new Simulator(lp2Model());
    const b = new Simulator(lp2Model());
    a.advanceTo(3600);
    b.advanceTo(3600);
    expect(lineKpi(a).completed).toBe(lineKpi(b).completed);
    expect(lineKpi(a).leadTime).toBe(lineKpi(b).leadTime);
  });

  it('LP2: 70 postos, takt 12 s, retrabalho em loop e WIP conservado', () => {
    const m = lp2Model();
    expect(m.nodes.filter((n) => n.type === 'rework')).toHaveLength(5);
    const sim = new Simulator(m);
    sim.runToEnd();
    const k = lineKpi(sim);
    expect(k.throughputPerHour).toBeGreaterThan(150);
    expect(k.throughputPerHour).toBeLessThanOrEqual(300);
    expect(k.firstPassYield).toBeLessThan(1);
    const inNodes = sim.nodes.reduce((s, n) => s + sim.nodeWip(n), 0);
    expect(inNodes + sim.transits.size).toBe(sim.wip);
  });

  it('falhas pausam o processamento e reduzem disponibilidade', () => {
    const m = serial([12]);
    m.nodes[1].availability = 0.8;
    m.nodes[1].mttr = 60;
    m.settings.duration = 36000;
    const sim = new Simulator(m);
    sim.runToEnd();
    const k = lineKpi(sim).nodes[1];
    expect(k.availability).toBeGreaterThan(0.72);
    expect(k.availability).toBeLessThan(0.88);
    expect(k.failures).toBeGreaterThan(10);
  });

  it('modelo simples roda com buffer e inspeção', () => {
    const sim = new Simulator(simpleModel());
    sim.runToEnd();
    const k = lineKpi(sim);
    expect(k.completed).toBeGreaterThan(1000);
    expect(k.taktCompliance).toBeGreaterThan(0);
  });
});

describe('modelos montados à mão', () => {
  it('fonte sozinha ou ligada direto ao produto acabado não trava', () => {
    const lone = buildLine([{ name: 'Raw Material', type: 'source' }], { name: 'x' });
    lone.links = [];
    lone.nodes = lone.nodes.filter((n) => n.type === 'source');
    const a = new Simulator(lone);
    a.runToEnd();
    expect(a.completed).toBe(0);

    const direct = buildLine([{ name: 'Raw Material', type: 'source' }, { name: 'FG', type: 'sink' }], { name: 'y' });
    direct.settings.duration = 100;
    direct.settings.transportSpeed = 0;
    const b = new Simulator(direct);
    b.runToEnd();
    expect(b.completed).toBeGreaterThan(90);
    expect(b.completed).toBeLessThanOrEqual(101);
  });

  it('ciclo de tempo zero é interrompido com mensagem', () => {
    const m = buildLine(
      [
        { name: 'Raw Material', type: 'source', next: 'A' },
        { name: 'A', type: 'buffer', cycleTime: 0, next: 'B' },
        { name: 'B', type: 'buffer', cycleTime: 0, next: 'A' },
      ],
      { name: 'z' },
    );
    m.settings.transportSpeed = 0;
    const sim = new Simulator(m);
    sim.runToEnd();
    expect(sim.error).toBeTruthy();
  });
});
