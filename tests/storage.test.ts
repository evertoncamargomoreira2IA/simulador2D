import { describe, expect, it } from 'vitest';
import { lp2Model } from '../src/model/builder';
import { browserStore } from '../src/io/storage';

describe('modelos salvos no navegador', () => {
  it('salva, lista, abre e apaga', async () => {
    const mem = new Map<string, string>();
    (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const m = lp2Model();
    await browserStore.save('a1', m);
    await browserStore.save('a2', { ...m, name: 'Outro' });
    const list = await browserStore.list();
    expect(list.map((x) => x.id).sort()).toEqual(['a1', 'a2']);
    expect((await browserStore.load('a1'))?.nodes.length).toBe(m.nodes.length);
    await browserStore.remove('a1');
    expect((await browserStore.list()).map((x) => x.id)).toEqual(['a2']);
  });
});

describe('modelos salvos na conta', () => {
  it('divide modelos grandes em partes e junta de volta', async () => {
    const { dbStore } = await import('../src/io/storage');
    const store = new Map<string, any>();
    const snap = (id: string, v: any) => ({ id, exists: v !== undefined, data: () => v });
    const db = {
      doc: (p: string) => ({ get: async () => snap(p.split('/').pop()!, store.get(p)), set: async (d: any) => { expect(JSON.stringify(d).length).toBeLessThan(256 * 1024); store.set(p, d); }, delete: async () => void store.delete(p) }),
      collection: (p: string) => ({ get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(p + '/')).map(([k, v]) => snap(k, v)) }) }),
    };
    const s = dbStore(db, 'u1');
    const m = { ...lp2Model(), background: { paths: [Array.from({ length: 120000 }, (_, i) => i)], circles: [], texts: [], width: 1, height: 1, originX: 0, originY: 0, pxPerMeter: 40 } } as any;
    await s.save('x', m);
    expect(store.size).toBeGreaterThan(2);
    expect((await s.load('x'))?.background?.paths[0].length).toBe(120000);
    expect((await s.list()).length).toBe(1);
    await s.save('x', lp2Model());
    expect(store.size).toBe(1);
    await s.remove('x');
    expect(store.size).toBe(0);
  });
});
