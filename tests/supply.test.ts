// Escrito pelo Codex, revisado e integrado.
import { describe, expect, it } from 'vitest';
import { supplyModel } from '../src/model/builder';
import { Simulator } from '../src/engine/simulator';
import { lineKpi } from '../src/engine/metrics';

describe('Modelo de abastecimento', () => {
  it('define takt de 36 segundos e duração de 8 horas', () => {
    const model = supplyModel();
    expect(model.settings.takt).toBe(36);
    expect(3600 / model.settings.takt).toBe(100);
    expect(model.settings.duration).toBe(28800);
  });

  it('distribui corretamente as pessoas entre os postos', () => {
    const { nodes } = supplyModel();
    const somaOperadores = (ids: string[]) =>
      ids.reduce((total, id) => {
        const node = nodes.find((n) => n.id === id);
        expect(node, `Posto ${id} deve existir`).toBeDefined();
        return total + node!.operators;
      }, 0);
    expect(somaOperadores(Array.from({ length: 10 }, (_, i) => `M${i + 1}`))).toBe(10);
    expect(somaOperadores(Array.from({ length: 5 }, (_, i) => `OL${i + 1}`))).toBe(5);
    expect(somaOperadores(Array.from({ length: 5 }, (_, i) => `PK${i + 1}`))).toBe(5);
    const teste = nodes.find((n) => n.id === 'TST');
    expect(teste!.operators).toBe(4);
    expect(teste!.capacity).toBe(4);
  });

  it('configura as ligações de peças e os recursos de transporte', () => {
    const { links, pools } = supplyModel();
    expect(pools!.find((p) => p.id === 'MR')).toMatchObject({ kind: 'agv' });
    expect(pools!.find((p) => p.id === 'EMP')).toMatchObject({ kind: 'forklift' });
    const verificaMilkRun = (from: string, to: string) => {
      const link = links.find((l) => l.from === from && l.to === to);
      expect(link, `Ligação ${from} → ${to} deve existir`).toBeDefined();
      expect(link!.poolId).toBe('MR');
      expect(link!.tripQty).toBe(20);
      expect(link!.path).toHaveLength(2);
    };
    verificaMilkRun('KP', 'M1');
    for (let j = 1; j <= 5; j++) {
      expect(links.find((l) => l.from === `OL${j}` && l.to === `M${2 * j}` && l.role === 'part')).toBeDefined();
      verificaMilkRun(`SM${j}`, `OL${j}`);
    }
    expect(links.find((l) => l.from === 'FGI' && l.to === 'EXP')).toMatchObject({ poolId: 'EMP' });
  });

  it('mantém referências válidas e as dimensões do background', () => {
    const { nodes, links, background } = supplyModel();
    const ids = new Set(nodes.map((n) => n.id));
    for (const link of links) {
      expect(ids.has(link.from), `Origem ${link.from} deve existir`).toBe(true);
      expect(ids.has(link.to), `Destino ${link.to} deve existir`).toBe(true);
    }
    expect(background!.width).toBe(1600);
    expect(background!.height).toBe(920);
    expect(background!.paths.length).toBeGreaterThan(50);
  });

  it('simula 8 horas sem erros e produz entre 95 e 106 unidades por hora no Packing 5', () => {
    const s = new Simulator(supplyModel());
    s.runToEnd();
    expect(s.error).toBeNull();
    expect(s.deadlocked).toBe(false);
    const packing5 = lineKpi(s).nodes.find((n) => n.id === 'PK5');
    const producaoPorHora = packing5!.processed / 8;
    expect(producaoPorHora).toBeGreaterThanOrEqual(95);
    expect(producaoPorHora).toBeLessThanOrEqual(106);
  }, 20000);
});
