// Casos de borda dos indicadores do gêmeo digital (revisão feita com o Codex).
import { describe, expect, it } from 'vitest';
import { forecast, oee, pareto, recentRate, SEM_MOTIVO } from '../src/engine/twinKpi';
import { carryOver } from '../src/engine/scans';

describe('oee: limites', () => {
  it('trata relógio zero sem divisão por zero', () => {
    expect(oee({ relogio: 0, feitas: 0, ideal: 60, paradoMin: 0 })).toEqual({ a: 0, p: 0, q: 1, oee: 0 });
  });
  it('zera disponibilidade e performance quando a parada supera o relógio', () => {
    expect(oee({ relogio: 60, feitas: 1, ideal: 30, paradoMin: 2 })).toEqual({ a: 0, p: 0, q: 1, oee: 0 });
  });
  it('limita performance acima de 100%, preservando a qualidade', () => {
    const r = oee({ relogio: 60, feitas: 10, ideal: 12, paradoMin: 0, refugo: 2 });
    expect(r.a).toBe(1);
    expect(r.p).toBe(1);
    expect(r.q).toBeCloseTo(0.8);
    expect(r.oee).toBeCloseTo(0.8);
  });
});

describe('forecast: limites', () => {
  it('trata relógio zero sem inventar ritmo', () => {
    expect(forecast({ pecas: 0, relogio: 0, duracao: 3600, takt: 60 })).toEqual({ fim: 0, meta: 60, ritmo: 0, precisa: 60, falta: 3600 });
  });
  it('depois do fim do turno, mantém a produção realizada', () => {
    expect(forecast({ pecas: 50, relogio: 7200, duracao: 3600, takt: 60, recente: 100 })).toEqual({ fim: 50, meta: 60, ritmo: 100, precisa: 0, falta: 0 });
  });
  it('takt zero não gera meta infinita', () => {
    expect(forecast({ pecas: 10, relogio: 1800, duracao: 3600, takt: 0 })).toEqual({ fim: 20, meta: 0, ritmo: 20, precisa: 0, falta: 1800 });
  });
  it('respeita ritmo recente zerado (linha parada)', () => {
    const r = forecast({ pecas: 10, relogio: 1800, duracao: 3600, takt: 60, recente: 0 });
    expect(r.ritmo).toBe(0);
    expect(r.fim).toBe(10);
  });
});

describe('recentRate: limites da janela', () => {
  it('sem dado no começo do turno', () => {
    expect(recentRate([], 0)).toBeUndefined();
  });
  it('exclui o início da janela e inclui o instante atual', () => {
    expect(recentRate([1799, 1800, 1801, 3600, 3601], 3600, 1800)).toBe(4);
  });
  it('zero quando a janela não tem produção', () => {
    expect(recentRate([], 3600)).toBe(0);
  });
  it('janela zero não dá NaN', () => {
    expect(recentRate([], 0, 0)).toBeUndefined();
  });
});

describe('pareto: perdas vazias e acumuladas', () => {
  it('lista vazia sem perdas', () => {
    expect(pareto([], 0)).toEqual([]);
  });
  it('perda sem registro vai para sem motivo', () => {
    expect(pareto([], 600, 10)).toEqual([{ motivo: SEM_MOTIVO, min: 10, acum: 100 }]);
  });
  it('soma o resto aos minutos já marcados como sem motivo', () => {
    expect(pareto([{ id: '1', posto: 'B', motivo: SEM_MOTIVO, inicio: 0, fim: 120 }], 600, 10)).toEqual([{ motivo: SEM_MOTIVO, min: 10, acum: 100 }]);
  });
  it('não conta tempo depois do instante consultado', () => {
    expect(pareto([{ id: '1', posto: 'B', motivo: 'Ajuste', inicio: 60, fim: 600 }], 180)).toEqual([{ motivo: 'Ajuste', min: 2, acum: 100 }]);
  });
});

describe('carryOver: WIP inicial por série', () => {
  const prevOf = new Map<string, string[]>([['C', ['A', 'B']]]);
  it('conta série sem leitura em nenhum dos postos anteriores', () => {
    expect([...carryOver([{ posto: 'C', serie: 'S1', hora: 10 }], prevOf)]).toEqual([['C', 1]]);
  });
  it('não conta quando o anterior leu a série, e não altera a lista', () => {
    const scans = [
      { posto: 'C', serie: 'S1', hora: 30 },
      { posto: 'B', serie: 'S1', hora: 20 },
      { posto: 'A', serie: 'S1', hora: 10 },
    ];
    const original = scans.map((x) => ({ ...x }));
    expect(carryOver(scans, prevOf).size).toBe(0);
    expect(scans).toEqual(original);
  });
  it('série repetida no mesmo posto conta uma vez', () => {
    const r = carryOver(
      [
        { posto: 'C', serie: 'S1', hora: 10 },
        { posto: 'C', serie: 'S1', hora: 20 },
        { posto: 'C', serie: 'S2', hora: 30 },
      ],
      prevOf,
    );
    expect([...r]).toEqual([['C', 2]]);
  });
  it('primeiro posto e lista vazia não contam', () => {
    expect(carryOver([], prevOf).size).toBe(0);
    expect(carryOver([{ posto: 'A', serie: 'S1', hora: 0 }], prevOf).size).toBe(0);
  });
});
