import { describe, expect, it } from 'vitest';
import { forecast, oee, pareto, recentRate, SEM_MOTIVO } from '../src/engine/twinKpi';
import { carryOver, stationsFromScans } from '../src/engine/scans';

describe('indicadores do gêmeo digital', () => {
  it('OEE = disponibilidade × performance × qualidade', () => {
    // 1 h, 6 min parado, 90 peças de 36 s: A = 0,9; P = 90×36/3240 = 1; Q = 1
    const r = oee({ relogio: 3600, feitas: 90, ideal: 36, paradoMin: 6 });
    expect(r.a).toBeCloseTo(0.9);
    expect(r.p).toBeCloseTo(1);
    expect(r.oee).toBeCloseTo(0.9);
    expect(oee({ relogio: 3600, feitas: 100, ideal: 36, paradoMin: 0, refugo: 5 }).q).toBeCloseTo(0.95);
  });
  it('previsão de fim de turno no ritmo atual', () => {
    const f = forecast({ pecas: 180, relogio: 2 * 3600, duracao: 8 * 3600, takt: 36 });
    expect(f.ritmo).toBeCloseTo(90);
    expect(f.fim).toBeCloseTo(720);
    expect(f.meta).toBeCloseTo(800);
    expect(f.precisa).toBeCloseTo(((800 - 180) * 3600) / (6 * 3600));
    expect(forecast({ pecas: 180, relogio: 7200, duracao: 28800, takt: 36, recente: 100 }).fim).toBeCloseTo(780);
  });
  it('ritmo recente pela janela de 30 min', () => {
    const horas = Array.from({ length: 50 }, (_, i) => 3600 + i * 36);
    expect(recentRate(horas, 3600 + 49 * 36)).toBeCloseTo(((50 - 0) * 3600) / 1800, 0);
    expect(recentRate([10], 100)).toBeUndefined();
  });
  it('Pareto ordena as perdas e põe o que não foi marcado como sem motivo', () => {
    const p = pareto(
      [
        { id: 'a', posto: 'P1', motivo: 'Falta de material', inicio: 0, fim: 600 },
        { id: 'b', posto: 'P2', motivo: 'Máquina quebrada', inicio: 100, fim: 400 },
        { id: 'c', posto: 'P1', motivo: 'Falta de material', inicio: 1000 },
      ],
      1300,
      30,
    );
    expect(p[0]).toMatchObject({ motivo: 'Falta de material', min: 15 });
    expect(p.find((r) => r.motivo === SEM_MOTIVO)?.min).toBeCloseTo(10);
    expect(p[p.length - 1].acum).toBeCloseTo(100);
  });
  it('resumo dos postos pelos scans', () => {
    const scans = Array.from({ length: 20 }, (_, i) => ({ posto: 'P1', serie: `S${i}`, hora: i * 30 + (i > 10 ? 300 : 0) }));
    const s = stationsFromScans(scans).get('P1')!;
    expect(s.feitas).toBe(20);
    expect(s.ciclo).toBeCloseTo(30);
    expect(s.fora).toBe(1);
    expect(s.paradoMin).toBeCloseTo(5, 0);
  });
});

describe('WIP inicial pelos scans', () => {
  it('conta as séries que o posto fez sem terem passado pelo anterior', () => {
    const prev = new Map([['P2', ['P1']], ['P1', []]]);
    const scans = [
      { posto: 'P2', serie: 'A', hora: 10 }, // já estava no P2 quando o turno começou
      { posto: 'P2', serie: 'B', hora: 20 },
      { posto: 'P1', serie: 'C', hora: 30 },
      { posto: 'P2', serie: 'C', hora: 60 },
    ];
    const c = carryOver(scans, prev);
    expect(c.get('P2')).toBe(2);
    expect(c.get('P1')).toBeUndefined();
  });
});
