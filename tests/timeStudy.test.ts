// Escrito pelo Codex, revisado e integrado.
import { describe, expect, it } from 'vitest';
import { minSamples, splitOutliers, statOf, studyEvents, STUDY_DEFAULTS, type RealEvent } from '../src/engine/timeStudy';
import { eventsFromRows, toSeconds } from '../src/io/realFeed';
import { makeNode, type Model } from '../src/engine/types';

const model = (nodes: ReturnType<typeof makeNode>[]): Model => ({
  name: 't',
  nodes,
  links: [],
  settings: { duration: 3600, warmup: 0, takt: 0, seed: 1, transportSpeed: 1, pxPerMeter: 10 },
});

describe('splitOutliers', () => {
  it('descarta 40 entre nove valores iguais a 10 com sigma 2', () => {
    const xs = [10, 10, 10, 10, 10, 10, 10, 10, 10, 40];
    expect(splitOutliers(xs, 2)).toEqual({ kept: [10, 10, 10, 10, 10, 10, 10, 10, 10], out: [40] });
    expect(xs).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 40]);
  });

  it('mantém todos os valores e devolve uma cópia quando sigma é zero', () => {
    const xs = [10, 10, 10, 10, 10, 10, 10, 10, 10, 40];
    const result = splitOutliers(xs, 0);
    expect(result).toEqual({ kept: xs, out: [] });
    expect(result.kept).not.toBe(xs);
  });

  it('não descarta valores quando há menos de três amostras', () => {
    expect(splitOutliers([], 2)).toEqual({ kept: [], out: [] });
    expect(splitOutliers([10], 2)).toEqual({ kept: [10], out: [] });
    expect(splitOutliers([10, 40], 0.1)).toEqual({ kept: [10, 40], out: [] });
  });

  it('mantém todos os valores quando o desvio é zero', () => {
    expect(splitOutliers([10, 10, 10, 10], 2)).toEqual({ kept: [10, 10, 10, 10], out: [] });
  });
});

describe('minSamples', () => {
  it('arredonda para cima a quantidade mínima de amostras', () => {
    // (1,96 × 3 / (0,05 × 30))² = 15,3664.
    expect(minSamples(30, 3, 0.05, 1.96)).toBe(16);
  });

  it('retorna zero quando a média é zero', () => {
    expect(minSamples(0, 3, 0.05, 1.96)).toBe(0);
  });
});

describe('statOf', () => {
  const options = { ...STUDY_DEFAULTS, rating: 1.1, allowance: 0.1 };

  it('calcula os tempos normal e padrão e sinaliza desvio acima do limite', () => {
    const result = statOf([10, 20, 30], 20, options);
    // Média 20; desvio amostral 10; normal 22; padrão 24,2.
    expect(result.n).toBe(3);
    expect(result.kept).toBe(3);
    expect(result.out).toEqual([]);
    expect(result.mean).toBeCloseTo(20);
    expect(result.sd).toBeCloseTo(10);
    expect(result.min).toBe(10);
    expect(result.max).toBe(30);
    expect(result.normal).toBeCloseTo(22);
    expect(result.standard).toBeCloseTo(24.2);
    expect(result.plan).toBe(20);
    expect(result.dev).toBeCloseTo(0.21);
    expect(result.alert).toBe(true);
    // (1,96 × 10 / (0,05 × 20))² = 384,16.
    expect(result.needed).toBe(385);
  });

  it('não sinaliza desvio dentro do limite', () => {
    const result = statOf([10, 20, 30], 25, options);
    expect(result.standard).toBeCloseTo(24.2);
    expect(result.dev).toBeCloseTo(-0.032);
    expect(result.alert).toBe(false);
  });

  it('devolve desvio nulo e nenhum alerta quando o plano é zero', () => {
    const result = statOf([10, 20, 30], 0, options);
    expect(result.plan).toBe(0);
    expect(result.dev).toBeNull();
    expect(result.alert).toBe(false);
  });
});

describe('studyEvents', () => {
  it('agrupa operações da mesma peça em um ciclo, respeita os planos e ordena pelos nós', () => {
    const productionModel = model([
      makeNode('machine', { id: 'P1', name: 'Posto 1', cycleTime: 30 }),
      makeNode('machine', {
        id: 'P2',
        name: 'Posto 2',
        cycleTime: 20,
        operations: [
          { name: 'Parafusar', activities: [{ name: 'Posicionar', time: 7, kind: 'va' }, { name: 'Apertar', time: 5, kind: 'va' }] },
          { name: 'Inspecionar', activities: [{ name: 'Conferir', time: 8, kind: 'va' }] },
        ],
      }),
    ]);
    const events: RealEvent[] = [
      { posto: 'Externo', serie: 'E1', inicio: 0, fim: 15 },
      { posto: 'posto 2', serie: 'A1', inicio: 0, fim: 12, operacao: 'parafusar' },
      { posto: 'posto 2', serie: 'A1', inicio: 17, fim: 25, operacao: 'Inspecionar' },
      { posto: 'posto 1', serie: 'B1', inicio: 100, fim: 130 },
      { posto: 'posto 2', serie: 'INVÁLIDA', inicio: 500, fim: 400, operacao: 'Inválida' },
    ];
    const result = studyEvents(events, productionModel);
    expect(result.map(({ id }) => id)).toEqual(['P1', 'P2', null]);
    const [first, second, external] = result;

    expect(first.name).toBe('Posto 1');
    expect(first.plan).toBe(30);
    expect(first.n).toBe(1);
    expect(first.mean).toBeCloseTo(30);

    // O ciclo inclui o intervalo entre as operações: 25 - 0 = 25.
    expect(second.name).toBe('Posto 2');
    expect(second.plan).toBe(20);
    expect(second.n).toBe(1);
    expect(second.mean).toBeCloseTo(25);
    expect(second.ops).toHaveLength(2);
    const fastening = second.ops.find(({ name }) => name.toLowerCase() === 'parafusar');
    const inspection = second.ops.find(({ name }) => name.toLowerCase() === 'inspecionar');
    expect(fastening!.plan).toBe(12);
    expect(fastening!.mean).toBeCloseTo(12);
    expect(inspection!.plan).toBe(8);
    expect(inspection!.mean).toBeCloseTo(8);

    expect(external.id).toBeNull();
    expect(external.name).toBe('Externo');
    expect(external.plan).toBe(0);
    expect(external.mean).toBeCloseTo(15);
    expect(external.dev).toBeNull();
    expect(external.alert).toBe(false);
  });

  it('ignora completamente leituras cujo fim antecede o início', () => {
    const productionModel = model([makeNode('machine', { id: 'P1', name: 'Posto 1', cycleTime: 30 })]);
    expect(studyEvents([{ posto: 'posto 1', serie: 'A1', inicio: 20, fim: 10 }], productionModel)).toEqual([]);
  });
});

describe('toSeconds', () => {
  it('preserva números em segundos e converte milissegundos', () => {
    expect(toSeconds(42)).toBe(42);
    expect(toSeconds(1700000000000)).toBe(1700000000);
  });

  it('converte horários com duas ou três partes', () => {
    expect(toSeconds('01:02:03')).toBe(3723);
    expect(toSeconds('1:02')).toBe(3720);
  });

  it('aceita vírgula decimal e rejeita string vazia', () => {
    expect(toSeconds('12,5')).toBeCloseTo(12.5);
    expect(toSeconds('')).toBeNull();
  });

  it('converte uma data ISO para segundos', () => {
    const iso = '2026-10-30T10:00:00Z';
    expect(toSeconds(iso)).toBe(Date.parse(iso) / 1000);
  });
});

describe('eventsFromRows', () => {
  it('aceita colunas em inglês e ignora a coluna operador', () => {
    const result = eventsFromRows([
      { station: 'Posto 1', serial: 'A1', start: '10', end: '40', operation: 'Parafusar', shift: 'Manhã', operador: 'Fulano' },
    ]);
    expect(result).toEqual([{ posto: 'Posto 1', serie: 'A1', inicio: 10, fim: 40, operacao: 'Parafusar', turno: 'Manhã' }]);
    expect(JSON.stringify(result)).not.toContain('Fulano');
    expect(JSON.stringify(result)).not.toContain('operador');
  });

  it('calcula o fim pela soma do início com a duração', () => {
    const result = eventsFromRows([{ workstation: 'Posto 2', sn: 'B1', begin: '100', duration: '12,5' }]);
    expect(result).toHaveLength(1);
    expect(result[0].posto).toBe('Posto 2');
    expect(result[0].serie).toBe('B1');
    expect(result[0].inicio).toBe(100);
    expect(result[0].fim).toBeCloseTo(112.5);
    expect(result[0]).not.toHaveProperty('operacao');
    expect(result[0]).not.toHaveProperty('turno');
  });

  it('pula linhas sem posto, sem início ou sem fim e duração', () => {
    const result = eventsFromRows([
      { serial: 'SEM-POSTO', start: 0, end: 10 },
      { station: 'Posto 1', serial: 'SEM-INÍCIO', end: 10 },
      { station: 'Posto 1', serial: 'SEM-FIM', start: 0 },
      { station: 'Posto 1', serial: 'VÁLIDA', start: 0, end: 10 },
    ]);
    expect(result).toEqual([{ posto: 'Posto 1', serie: 'VÁLIDA', inicio: 0, fim: 10 }]);
  });
});
