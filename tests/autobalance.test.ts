import { describe, expect, it } from 'vitest';
import { autoBalance } from '../src/engine/autobalance';
import { elementsModel } from '../src/model/builder';
import { Simulator } from '../src/engine/simulator';
import { lineKpi } from '../src/engine/metrics';
import { stopMinutes, STOP_PRESETS } from '../src/engine/types';

const st = (id: string, times: number[]) => ({ id, ops: [{ name: id, activities: times.map((t, i) => ({ name: `${id}${i}`, time: t, kind: 'va' as const })) }] });

describe('balanceamento automático', () => {
  it('usa o menor número de postos no takt e respeita a ordem', () => {
    const r = autoBalance([st('A', [20, 20, 20]), st('B', [10, 10]), st('C', [15, 5]), st('D', [10])], 50);
    expect(r.needed).toBe(3);
    expect(r.used).toBe(3);
    expect(r.maxLoad).toBeLessThanOrEqual(50);
    const names = Object.values(r.draft).flatMap((o) => o.flatMap((x) => x.activities.map((a) => a.name)));
    expect(names).toEqual(['A0', 'A1', 'A2', 'B0', 'B1', 'C0', 'C1', 'D0']);
    expect(r.draft.D).toEqual([]);
  });
  it('quando não cabe no takt, iguala a carga entre os postos que existem', () => {
    const r = autoBalance([st('A', [30, 30]), st('B', [30, 30])], 50);
    expect(r.used).toBe(2);
    expect(r.maxLoad).toBe(60);
    expect(r.needed).toBe(4);
  });
  it('exemplo com atividades cabe no takt', () => {
    const m = elementsModel();
    const posts = m.nodes.filter((n) => n.operations?.length && n.capacity <= 1);
    const r = autoBalance(posts.map((n) => ({ id: n.id, ops: n.operations!, efficiency: n.efficiency })), m.settings.takt);
    expect(r.maxLoad).toBeLessThanOrEqual(m.settings.takt + 1e-6);
  });
});

describe('paradas do turno', () => {
  it('almoço e troca de modelo reduzem a produção na proporção do tempo parado', () => {
    const m = elementsModel();
    const run = (stops = m.settings.stops) => {
      const s = new Simulator({ ...m, settings: { ...m.settings, stops } });
      s.runToEnd();
      return lineKpi(s).completed;
    };
    const base = run([]);
    const withStops = run(STOP_PRESETS);
    const min = stopMinutes({ stops: STOP_PRESETS, duration: m.settings.duration });
    expect(min).toBe(90);
    const expected = base * (1 - min / (m.settings.duration / 60));
    expect(withStops).toBeLessThan(base);
    expect(Math.abs(withStops - expected) / expected).toBeLessThan(0.08);
  });
});
