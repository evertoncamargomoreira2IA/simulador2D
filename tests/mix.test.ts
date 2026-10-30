// Escrito pelo Codex, revisado e integrado.
import { describe, expect, it } from 'vitest';
import { bounds, fitTimes, parseTimes, sampleTime, toDist } from '../src/engine/dist';
import { Rng } from '../src/engine/rng';
import { Simulator } from '../src/engine/simulator';
import { lineKpi } from '../src/engine/metrics';
import type { Model, TimeDist } from '../src/engine/types';
import { mixModel, simpleModel } from '../src/model/builder';

const average = (xs: number[]) => xs.reduce((sum, v) => sum + v, 0) / xs.length;

function sample(dist?: TimeDist, mean = 30, cv = 0.1): number[] {
  const rng = new Rng(12345);
  return Array.from({ length: 20_000 }, () => sampleTime(rng, mean, cv, dist));
}

function run(model: Model): Simulator {
  const sim = new Simulator(model);
  sim.runToEnd();
  return sim;
}

function changeoversAt(sim: Simulator, id: string): number {
  const node = sim.nodes.find((n) => n.def.id === id);
  expect(node).toBeDefined();
  return node!.changeovers;
}

describe('sampleTime', () => {
  const kinds = ['lognormal', 'normal', 'triangular', 'uniform', 'exponential', 'constant'] as const;

  it.each(kinds)('%s mantém a média dentro de 2%%', (kind) => {
    expect(Math.abs(average(sample({ kind })) - 30)).toBeLessThanOrEqual(0.6);
  });

  it('usa lognormal por padrão (mesmo sorteio de antes)', () => {
    const implicit = new Rng(12345);
    const explicit = new Rng(12345);
    for (let i = 0; i < 100; i++) expect(sampleTime(implicit, 30, 0.1)).toBe(sampleTime(explicit, 30, 0.1, { kind: 'lognormal' }));
  });

  it('constant retorna sempre a média', () => {
    expect(sample({ kind: 'constant' }).every((v) => v === 30)).toBe(true);
  });

  it('uniform sem limites respeita bounds', () => {
    const dist: TimeDist = { kind: 'uniform' };
    const [lo, hi] = bounds(30, 0.1, dist);
    for (const v of sample(dist)) {
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });

  it('triangular com limites mantém a média e respeita o intervalo', () => {
    const values = sample({ kind: 'triangular', min: 20, max: 50 });
    expect(Math.abs(average(values) - 30)).toBeLessThanOrEqual(0.6);
    expect(values.every((v) => v >= 20 && v <= 50)).toBe(true);
  });

  it('empirical reescala as amostras para a média pedida', () => {
    expect(new Set(sample({ kind: 'empirical', samples: [10, 20, 30] }, 40))).toEqual(new Set([20, 40, 60]));
  });

  it.each([...kinds, 'empirical'] as const)('%s retorna zero quando a média é zero', (kind) => {
    const dist: TimeDist = kind === 'empirical' ? { kind, samples: [10, 20, 30] } : { kind };
    expect(sampleTime(new Rng(12345), 0, 0.1, dist)).toBe(0);
  });
});

describe('fitTimes', () => {
  it('retorna null com menos de três valores positivos', () => {
    expect(fitTimes([])).toBeNull();
    expect(fitTimes([30])).toBeNull();
    expect(fitTimes([20, 30])).toBeNull();
    expect(fitTimes([-10, 0, 20, 30])).toBeNull();
  });

  it('ajusta dados normais, conta os bins e ordena por KS', () => {
    const rng = new Rng(24680);
    const fit = fitTimes(Array.from({ length: 400 }, () => 50 + 5 * rng.normal()))!;
    expect(fit.n).toBe(400);
    expect(['normal', 'lognormal']).toContain(fit.ranking[0].kind);
    expect(Math.abs(fit.mean - 50)).toBeLessThanOrEqual(1);
    expect(fit.bins.counts.reduce((s, c) => s + c, 0)).toBe(fit.n);
    expect(new Set(fit.ranking.map((r) => r.kind))).toEqual(new Set(['normal', 'lognormal', 'triangular', 'uniform', 'exponential']));
    for (let i = 1; i < fit.ranking.length; i++) expect(fit.ranking[i].ks).toBeGreaterThanOrEqual(fit.ranking[i - 1].ks);
  });

  it('aceita uniforme e rejeita exponencial para dados uniformes', () => {
    const rng = new Rng(13579);
    const fit = fitTimes(Array.from({ length: 400 }, () => 20 + 20 * rng.next()))!;
    expect(fit.ranking.find((r) => r.kind === 'uniform')?.ok).toBe(true);
    expect(fit.ranking.find((r) => r.kind === 'exponential')?.ok).toBe(false);
  });
});

describe('parseTimes', () => {
  it('aceita decimais e minutos, ignorando lixo e valores não positivos', () => {
    expect(parseTimes('33,2 35.8;1:05\nabc -3 0')).toEqual([33.2, 35.8, 65]);
  });
});

describe('toDist', () => {
  it('limita a empírica a 500 tempos', () => {
    const dist = toDist('empirical', Array.from({ length: 600 }, (_, i) => i + 1));
    expect(dist.kind).toBe('empirical');
    expect(dist.samples).toHaveLength(500);
  });

  it('preserva mín e máx de um resultado triangular', () => {
    const xs = Array.from({ length: 400 }, (_, i) => 20 + i / 20);
    const tri = fitTimes(xs)!.ranking.find((r) => r.kind === 'triangular')!;
    expect(tri.min).toBeDefined();
    expect(tri.max).toBeDefined();
    expect(toDist(tri, xs)).toEqual({ kind: 'triangular', min: Math.round(tri.min! * 100) / 100, max: Math.round(tri.max! * 100) / 100 });
  });
});

describe('Simulador com mix de modelos', () => {
  it('produz os três modelos com a proporção de A perto do mix', () => {
    const sim = run({ ...mixModel(), sequence: [] });
    const total = Object.values(sim.producedBy).reduce((s, c) => s + c, 0);
    expect(sim.producedBy.A).toBeGreaterThan(0);
    expect(sim.producedBy.B).toBeGreaterThan(0);
    expect(sim.producedBy.C).toBeGreaterThan(0);
    expect(sim.producedBy.A / total).toBeGreaterThan(0.5);
    expect(sim.producedBy.A / total).toBeLessThan(0.7);
  });

  it('sequência fixa só de A produz só A e não troca de modelo', () => {
    const sim = run({ ...mixModel(), sequence: ['A'] });
    expect(sim.producedBy.A).toBeGreaterThan(0);
    expect(Object.keys(sim.producedBy)).toEqual(['A']);
    for (const n of sim.nodes) expect(n.changeovers).toBe(0);
  });

  it('sequência em blocos troca menos no teste que o sorteio', () => {
    const grouped = run({ ...mixModel(), sequence: ['A', 'A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'C'] });
    const random = run({ ...mixModel(), sequence: [] });
    expect(changeoversAt(grouped, 'X6')).toBeLessThan(changeoversAt(random, 'X6'));
  });

  it('modelo sem mix não muda: producedBy vazio e resultado determinístico', () => {
    const first = run(simpleModel());
    const second = run(simpleModel());
    expect(first.producedBy).toEqual({});
    expect(lineKpi(first).throughputPerHour).toBe(lineKpi(second).throughputPerHour);
  });
});
