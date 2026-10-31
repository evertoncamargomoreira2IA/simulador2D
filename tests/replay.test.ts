import { describe, expect, it } from 'vitest';
import { lineKpi } from '../src/engine/metrics';
import { recordedTimes, replayModel, simulationModel } from '../src/engine/replay';
import { Simulator } from '../src/engine/simulator';
import { simulatedFeed, FEED_DEFAULTS } from '../src/io/realFeed';
import { tenStationModel } from '../src/model/builder';

describe('Reprodução histórica', () => {
  const m = tenStationModel();
  const ev = simulatedFeed(m, { ...FEED_DEFAULTS, hours: 2, drift: 0.1 });
  const r = replayModel(m, ev, 'teste')!;

  it('usa os tempos gravados de todos os postos, na ordem, pelo período da coleta', () => {
    expect(r.matched).toHaveLength(10);
    expect(r.missing).toEqual([]);
    expect(r.model.settings.study).toBe('historico');
    expect(Math.abs(r.model.settings.duration - r.span)).toBeLessThan(1);
    const p1 = ev.filter((e) => e.posto === 'Posto 1').sort((a, b) => a.inicio - b.inicio);
    expect(r.model.settings.replay![r.model.nodes.find((n) => n.name === 'Posto 1')!.id].slice(0, 5)).toEqual(p1.slice(0, 5).map((e) => e.fim - e.inicio));
  });

  it('a produção reproduzida bate com a produção real (±8%)', () => {
    const sim = new Simulator(r.model);
    sim.runToEnd();
    const uph = lineKpi(sim).throughputPerHour;
    const real = (r.realOut * 3600) / r.span;
    expect(Math.abs(uph - real) / real).toBeLessThan(0.08);
  });

  it('é determinística: os tempos não dependem da semente', () => {
    const a = new Simulator({ ...r.model, settings: { ...r.model.settings, seed: 1 } });
    const b = new Simulator({ ...r.model, settings: { ...r.model.settings, seed: 99 } });
    a.runToEnd();
    b.runToEnd();
    expect(lineKpi(a).throughputPerHour).toBeCloseTo(lineKpi(b).throughputPerHour, 5);
  });

  it('voltar para simulação tira os tempos gravados e devolve a duração do turno', () => {
    const s = simulationModel(r.model);
    expect(s.settings.replay).toBeUndefined();
    expect(s.settings.duration).toBe(m.settings.duration);
    expect(s.settings.study).toBe('simulacao');
  });

  it('soma as operações por peça quando não há ciclo do posto inteiro', () => {
    const t = recordedTimes([
      { posto: 'A', serie: '1', inicio: 0, fim: 10, operacao: 'x' },
      { posto: 'A', serie: '1', inicio: 10, fim: 15, operacao: 'y' },
      { posto: 'A', serie: '2', inicio: 20, fim: 32, operacao: 'x' },
    ]);
    expect(t.get('a')!.times).toEqual([15, 12]);
  });

  it('sem postos com o mesmo nome devolve null', () => {
    expect(replayModel(m, [{ posto: 'Outro', serie: '1', inicio: 0, fim: 5 }])).toBeNull();
  });
});
