import { describe, expect, it } from 'vitest';
import { stallIssues, staticIssues } from '../src/engine/diagnose';
import { Simulator } from '../src/engine/simulator';
import { DEFAULT_SETTINGS, makeNode, makePool, type LinkDef, type Model, type NodeDef } from '../src/engine/types';
import { simpleModel } from '../src/model/builder';

let k = 0;
const link = (from: string, to: string, extra: Partial<LinkDef> = {}): LinkDef => ({ id: `L${k++}`, from, to, weight: 1, ...extra });
const node = (type: NodeDef['type'], id: string, x: number, extra: Partial<NodeDef> = {}) => makeNode(type, { id, name: id, x, y: 100, cv: 0, ...extra });
const model = (nodes: NodeDef[], links: LinkDef[], extra: Partial<Model> = {}): Model => ({ name: 't', nodes, links, settings: { ...DEFAULT_SETTINGS, duration: 3 * 3600 }, ...extra });
const run = (m: Model, t = 3 * 3600) => {
  const s = new Simulator(m);
  s.advanceTo(t);
  return s;
};

describe('diagnóstico de linha travada', () => {
  it('linha saudável não gera aviso', () => {
    const m = simpleModel();
    expect(staticIssues(m)).toEqual([]);
    expect(stallIssues(m, run(m))).toEqual([]);
  });

  it('componente que nunca chega: aponta a montagem e o fornecedor', () => {
    const m = model(
      [node('source', 'S', 0), node('machine', 'A', 100, { cycleTime: 10 }), node('machine', 'P2', 100, { cycleTime: 10 }), node('machine', 'X', 200, { cycleTime: 10 }), node('sink', 'FG', 300)],
      [link('S', 'A'), link('A', 'X'), link('P2', 'X', { role: 'part' }), link('X', 'FG')],
    );
    const iss = stallIssues(m, run(m));
    expect(iss[0].key).toMatch(/^parts:/);
    expect(iss[0].title).toContain('P2');
    expect(iss[0].action?.link?.patch.role).toBeUndefined();
  });

  it('agrupamento que nunca completa', () => {
    const m = model(
      [node('source', 'S', 0, { maxArrivals: 10 }), node('machine', 'A', 100, { cycleTime: 10 }), node('machine', 'B', 200, { cycleTime: 10, batchSize: 4, queueCap: 4 }), node('sink', 'FG', 300)],
      [link('S', 'A'), link('A', 'B'), link('B', 'FG')],
    );
    const iss = stallIssues(m, run(m));
    expect(iss.map((x) => x.key)).toContain('batch:B');
  });

  it('recurso com quantidade zero e montagem sem principal aparecem antes de rodar', () => {
    const m = model(
      [node('source', 'S', 0), node('machine', 'A', 100, { cycleTime: 10 }), node('machine', 'X', 200, { cycleTime: 10 }), node('sink', 'FG', 300)],
      [link('S', 'A'), link('A', 'X', { role: 'part', poolId: 'OP' }), link('X', 'FG')],
      { pools: [makePool('operator', { id: 'OP', count: 0 })] },
    );
    const keys = staticIssues(m).map((x) => x.key);
    expect(keys).toContain('zero:OP');
    expect(keys).toContain('nomain:X');
  });

  it('linha sem produto acabado', () => {
    const m = model([node('source', 'S', 0), node('machine', 'A', 100)], [link('S', 'A')]);
    expect(staticIssues(m).map((x) => x.key)).toContain('nosink');
  });
  it('produto Principal que nunca chega: não manda aumentar fila, aponta a entrada', () => {
    // material entra como Componente; a Principal vem de um posto sem entrada
    const m = model(
      [node('source', 'S', 0), node('machine', 'M', 100, { cycleTime: 20 }), node('machine', 'P1', 200, { cycleTime: 30, queueCap: 3 }), node('sink', 'FG', 300)],
      [link('S', 'P1', { role: 'part' }), link('M', 'P1'), link('P1', 'FG')],
    );
    const st = staticIssues(m);
    expect(st[0].key).toBe('noin:M');
    expect(st[0].action).toBeUndefined();
    const iss = stallIssues(m, run(m));
    expect(iss.map((x) => x.key)).toEqual(['waitmain:P1']);
    // aplicar a correção faz a linha produzir
    const fixed = { ...m, links: m.links.map((l) => (l.id === iss[0].action!.link!.id ? { ...l, ...iss[0].action!.link!.patch } : l)) };
    expect(run(fixed).completed).toBeGreaterThan(100);
  });
});
