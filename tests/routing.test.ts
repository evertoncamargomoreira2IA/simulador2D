// Roteiro de produção (testes escritos com o Codex).
import { describe, expect, it } from 'vitest';
import { buildRouting, DEFAULT_STAFF, MULTI_UTIL, type StaffConfig } from '../src/engine/routing';
import { DEFAULT_SETTINGS, makeNode, makePool } from '../src/engine/types';

type Model = Parameters<typeof buildRouting>[0];

function makeModel(): Model {
  const nodes = [
    makeNode('source', { id: 'E', name: 'Entrada' }),
    makeNode('machine', { id: 'P1', name: 'P1', cycleTime: 30, efficiency: 1, capacity: 1, operators: 1 }),
    makeNode('machine', { id: 'P2', name: 'P2', cycleTime: 40, efficiency: 1, capacity: 2, operators: 1 }),
    makeNode('machine', { id: 'P3', name: 'P3', cycleTime: 36, efficiency: 1, capacity: 1, operators: 1 }),
    makeNode('sink', { id: 'S', name: 'Saída' }),
  ];
  return {
    name: 'Linha de teste',
    nodes,
    links: nodes.slice(0, -1).map((node, index) => ({ id: `L${index + 1}`, from: node.id, to: nodes[index + 1]!.id, weight: 1 })),
    settings: { ...DEFAULT_SETTINGS, duration: 28_800, takt: 0, stops: [] },
  };
}

function makeStaff(overrides: Partial<StaffConfig> = {}): StaffConfig {
  return { ...DEFAULT_STAFF, roles: DEFAULT_STAFF.roles.map((role) => ({ ...role })), ...overrides };
}

describe('buildRouting', () => {
  it('exporta a utilização de referência dos multis', () => {
    expect(MULTI_UTIL).toBeCloseTo(0.85);
  });

  it('ordena os postos pelo fluxo e calcula carga, UPH e gargalo', () => {
    const model = makeModel();
    model.nodes.reverse();
    const result = buildRouting(model);
    expect(result.rows.map((row) => row.posto)).toEqual(['P1', 'P2', 'P3']);
    const [p1, p2, p3] = result.rows;
    expect(p1!.carga).toBeCloseTo(30);
    expect(p2!.carga).toBeCloseTo(20);
    expect(p3!.carga).toBeCloseTo(36);
    expect(p1!.uph).toBeCloseTo(120);
    expect(p2!.uph).toBeCloseTo(180);
    expect(p3!.uph).toBeCloseTo(100);
    expect([p1!.gargalo, p2!.gargalo, p3!.gargalo]).toEqual([false, false, true]);
    expect(result.takt).toBeCloseTo(36);
  });

  it('calcula disponibilidade e allowance com os valores padrão', () => {
    const result = buildRouting(makeModel());
    expect(result.disponivelMin).toBeCloseTo(480);
    expect(result.allowance).toBeCloseTo(20 / 460);
  });

  it('desconta uma pausa de 60 minutos da disponibilidade', () => {
    const model = makeModel();
    model.settings.stops = [{ name: 'Intervalo', start: 120, duration: 60, kind: 'break' }];
    const result = buildRouting(model);
    expect(result.disponivelMin).toBeCloseTo(420);
    expect(result.allowance).toBeCloseTo(20 / 400);
    expect(result.pecasTurno).toBeCloseTo(700);
  });

  it('soma a fadiga ao allowance', () => {
    expect(buildRouting(makeModel(), makeStaff({ fadigaPct: 5 })).allowance).toBeCloseTo(20 / 460 + 0.05);
  });

  it('conta operadores próprios, indiretos e headcount', () => {
    const result = buildRouting(makeModel());
    expect(result.rows.map((row) => row.operadores)).toEqual([1, 1, 1]);
    expect(result.diretos).toBe(3);
    expect(result.totalIndiretos).toBe(5);
    expect(result.hc).toBe(8);
  });

  it('conta a equipe compartilhada nos diretos e zera operadores do posto', () => {
    const model = makeModel();
    const p2 = model.nodes.find((node) => node.id === 'P2')!;
    p2.poolId = 'operadores';
    p2.operators = 7;
    model.pools = [makePool('operator', { id: 'operadores', name: 'Equipe compartilhada', count: 4 })];
    const result = buildRouting(model);
    expect(result.rows.map((row) => row.operadores)).toEqual([1, 0, 1]);
    expect(result.rows[1]!.equipe).toBe('Equipe compartilhada');
    expect(result.diretos).toBe(6);
    expect(result.hc).toBe(11);
  });

  it('calcula cobertura, multis necessários e ocupação dos multis', () => {
    const result = buildRouting(makeModel());
    const cobertura = 3 * 20;
    const cap = (480 - 20) * MULTI_UTIL;
    expect(result.coberturaMin).toBeCloseTo(cobertura);
    expect(result.multisNecessarios).toBe(Math.ceil(cobertura / cap));
    expect(result.ocupacaoMulti).toBeCloseTo(cobertura / (3 * cap));
    expect(result.diretosPorMulti).toBeCloseTo(1);
  });

  it('retorna ocupação infinita quando há cobertura e nenhum multi', () => {
    const staff = makeStaff();
    staff.roles = staff.roles.map((role) => ({ ...role, qtd: role.kind === 'multi' ? 0 : role.qtd }));
    const result = buildRouting(makeModel(), staff);
    expect(result.coberturaMin).toBeCloseTo(60);
    expect(result.multisNecessarios).toBe(1);
    expect(result.ocupacaoMulti).toBe(Infinity);
  });

  it('aumenta a carga quando a eficiência cai para 0,9', () => {
    const model = makeModel();
    model.nodes.find((node) => node.id === 'P3')!.efficiency = 0.9;
    const result = buildRouting(model);
    const p3 = result.rows.find((row) => row.posto === 'P3')!;
    expect(p3.carga).toBeCloseTo(36 / 0.9);
    expect(p3.ciclo).toBeCloseTo(36);
    expect(p3.uph).toBeCloseTo(90);
    expect(p3.gargalo).toBe(true);
    expect(result.takt).toBeCloseTo(40);
    expect(result.uphPlan).toBeCloseTo(90);
  });

  it('calcula produção, produtividade por pessoa e balanceamento', () => {
    const result = buildRouting(makeModel());
    expect(result.uphPlan).toBeCloseTo(100);
    expect(result.pecasTurno).toBeCloseTo(800);
    expect(result.pecasDia).toBeCloseTo(800);
    expect(result.uphPorPessoa).toBeCloseTo(100 / 8);
    expect(result.balanceamento).toBeCloseTo((30 + 20 + 36) / 3 / 36);
  });

  it('dobra a produção diária com dois turnos', () => {
    const model = makeModel();
    const um = buildRouting(model, makeStaff({ turnos: 1 }));
    const dois = buildRouting(model, makeStaff({ turnos: 2 }));
    expect(dois.pecasTurno).toBeCloseTo(um.pecasTurno);
    expect(dois.pecasDia).toBeCloseTo(um.pecasDia * 2);
  });

  it('omite funções com quantidade zero', () => {
    const staff = makeStaff();
    staff.roles = staff.roles.map((role) => ({ ...role, qtd: role.kind === 'multi' ? role.qtd : 0 }));
    const result = buildRouting(makeModel(), staff);
    expect(result.indiretos).toHaveLength(1);
    expect(result.totalIndiretos).toBe(3);
    expect(result.hc).toBe(6);
  });
});
