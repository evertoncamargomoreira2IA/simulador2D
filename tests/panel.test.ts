// Escrito pelo Codex, revisado e integrado.
import { describe, expect, it } from 'vitest';
import { buildPanel, devOf, realUph } from '../src/engine/panel';
import type { RealEvent } from '../src/engine/timeStudy';
import { supplyModel } from '../src/model/builder';

const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

describe('devOf', () => {
  it('calcula o desvio relativo', () => {
    expect(devOf(40, 40)).toBe(0);
    expect(devOf(50, 40)).toBeCloseTo(0.25);
    expect(devOf(30, 40)).toBeCloseTo(-0.25);
    expect(devOf(0, 40)).toBe(-1);
  });

  it('retorna null para real ausente ou referência não positiva', () => {
    expect(devOf(null, 40)).toBeNull();
    expect(devOf(40, 0)).toBeNull();
    expect(devOf(40, -10)).toBeNull();
  });
});

describe('realUph', () => {
  const events: RealEvent[] = [
    { posto: 'Posto A', serie: '001', inicio: 0, fim: 1800 },
    { posto: 'Posto A', serie: '002', inicio: 1800, fim: 3600 },
    { posto: 'Posto A', serie: '002', inicio: 2000, fim: 3500 },
    { posto: 'Posto B', serie: '003', inicio: 0, fim: 3600 },
  ];

  it('conta séries distintas no intervalo do posto de referência', () => {
    expect(realUph(events, 'Posto A')).toBe(2);
  });

  it('normaliza acentos, maiúsculas e separadores do nome', () => {
    expect(realUph(events, 'PÓSTO-A')).toBe(2);
  });

  it('usa o último posto por ordem de primeira aparição sem referência válida', () => {
    const reordered = [...events, events[0]!];
    expect(realUph(reordered)).toBe(1);
    expect(realUph(reordered, 'Posto inexistente')).toBe(1);
  });

  it('retorna null sem eventos', () => {
    expect(realUph([])).toBeNull();
    expect(realUph([], 'Posto A')).toBeNull();
  });
});

describe('buildPanel', () => {
  it('gera o painel sem dados reais', () => {
    const snapshot = buildPanel(supplyModel(), {}, [], 'sem coleta');
    expect(snapshot.metaUph).toBeCloseTo(100);
    expect(snapshot.postos.length).toBeGreaterThan(0);
    expect(snapshot.postos.every((p) => p.real === null && p.realCount === null)).toBe(true);
    expect(snapshot.real.gargalo).toBeNull();
    expect(snapshot.real.uph).toBeNull();
    expect(snapshot.real.fonte).toBe('sem coleta');
    expect(snapshot.sim.uph).toBeGreaterThan(90);
    // cabe com folga num documento do banco do artefato (256 KiB)
    expect(JSON.stringify(snapshot).length).toBeLessThan(200_000);
  });

  it('divide o ciclo pela capacidade e repassa as quantidades produzidas', () => {
    const model = supplyModel();
    const m1Name = model.nodes.find((n) => n.id === 'M1')!.name;
    const tstName = model.nodes.find((n) => n.id === 'TST')!.name;
    const snapshot = buildPanel(
      model,
      {
        [normalizeName(m1Name)]: { cycle: 40, produced: 123 },
        [normalizeName(tstName)]: { cycle: 160, produced: 456 },
      },
      [],
      'coleta real',
    );
    const m1 = snapshot.postos.find((p) => p.id === 'M1')!;
    const tst = snapshot.postos.find((p) => p.id === 'TST')!;
    expect(m1.real).toBe(40);
    expect(tst.real).toBe(40);
    expect(m1.realCount).toBe(123);
    expect(tst.realCount).toBe(456);
    expect([m1Name, tstName]).toContain(snapshot.real.gargalo);
    const others = snapshot.postos.filter((p) => p.id !== 'M1' && p.id !== 'TST');
    expect(others.every((p) => p.real === null && p.realCount === null)).toBe(true);
  });
});
