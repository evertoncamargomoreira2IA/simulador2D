// Reprodução histórica: em vez de sortear o tempo de cada posto na curva, o simulador usa os tempos
// gravados nas leituras, na ordem em que aconteceram, e roda o mesmo período da coleta.
// Serve para conferir o modelo contra um turno que já passou: se o modelo está certo,
// a produção reproduzida bate com a produção real.

import type { RealEvent } from './timeStudy';
import type { Model, StudyKind } from './types';

export const STUDY_LABEL: Record<StudyKind, string> = {
  simulacao: 'Simulação',
  historico: 'Reprodução histórica',
  monitoramento: 'Monitoramento real',
};

export const STUDY_WHY: Record<StudyKind, string> = {
  simulacao: 'E se? Os tempos são sorteados das curvas de cada posto (média, variação). Serve para testar mudanças antes de fazer: gigas, pessoas, layout, mix.',
  historico: 'O que aconteceu? Cada posto usa os tempos gravados nas leituras, na mesma ordem, pelo mesmo período. Serve para validar o modelo: a produção reproduzida tem que bater com a real.',
  monitoramento: 'O que está acontecendo agora? As leituras chegam da API de tempos em tempos e o painel compara o real com o simulado ao vivo. Serve para acompanhar o turno e agir no desvio.',
};

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface ReplayResult {
  model: Model;
  /** Postos do modelo que receberam tempos gravados (nome → quantidade de tempos). */
  matched: { name: string; count: number }[];
  /** Postos do modelo sem leituras: continuam com a curva (simulação). */
  missing: string[];
  /** Postos das leituras que não existem no modelo. */
  unknown: string[];
  /** Período das leituras (s) e peças que saíram do último posto lido. */
  span: number;
  realOut: number;
}

/** Tempos gravados por posto, na ordem: ciclo do posto inteiro ou, se só houver operações, a soma por peça. */
export function recordedTimes(events: RealEvent[]): Map<string, { name: string; times: number[] }> {
  const by = new Map<string, RealEvent[]>();
  for (const e of events) {
    const k = key(e.posto);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(e);
  }
  const out = new Map<string, { name: string; times: number[] }>();
  for (const [k, list] of by) {
    const whole = list.filter((e) => !e.operacao);
    let pairs: { at: number; t: number }[];
    if (whole.length) pairs = whole.map((e) => ({ at: e.inicio, t: e.fim - e.inicio }));
    else {
      const per = new Map<string, { at: number; t: number }>();
      for (const e of list) {
        const p = per.get(e.serie) ?? { at: e.inicio, t: 0 };
        p.at = Math.min(p.at, e.inicio);
        p.t += e.fim - e.inicio;
        per.set(e.serie, p);
      }
      pairs = [...per.values()];
    }
    const times = pairs.filter((p) => p.t > 0 && Number.isFinite(p.t)).sort((a, b) => a.at - b.at).map((p) => p.t);
    if (times.length) out.set(k, { name: list[0].posto, times });
  }
  return out;
}

/** Monta o modelo da reprodução histórica: mesmos blocos, tempos gravados e o período da coleta. */
export function replayModel(m: Model, events: RealEvent[], source = ''): ReplayResult | null {
  if (!events.length) return null;
  const rec = recordedTimes(events);
  const c = structuredClone(m);
  const replay: Record<string, number[]> = {};
  const matched: ReplayResult['matched'] = [];
  const missing: string[] = [];
  const used = new Set<string>();
  for (const n of c.nodes) {
    if (n.type === 'source' || n.type === 'sink' || n.type === 'buffer') continue;
    const r = rec.get(key(n.name));
    if (r) {
      replay[n.id] = r.times;
      matched.push({ name: n.name, count: r.times.length });
      used.add(key(n.name));
    } else missing.push(n.name);
  }
  if (!matched.length) return null;
  const t0 = Math.min(...events.map((e) => e.inicio));
  const t1 = Math.max(...events.map((e) => e.fim));
  const span = Math.max(60, Math.round(t1 - t0));
  // peças reais: as que passaram pelo último posto do modelo que tem leitura
  const last = [...c.nodes].reverse().find((n) => replay[n.id]);
  const realOut = last ? replay[last.id].length : 0;
  const prev = c.settings.replayPrev ?? { duration: c.settings.duration, warmup: c.settings.warmup, startFull: c.settings.startFull };
  c.settings = { ...c.settings, study: 'historico', replay, replaySource: source, replayPrev: prev, duration: span, warmup: 0, startFull: true };
  return { model: c, matched, missing, unknown: [...rec.keys()].filter((k) => !used.has(k)).map((k) => rec.get(k)!.name), span, realOut };
}

/** Volta para simulação: tira os tempos gravados (mantém o resto do modelo). */
export function simulationModel(m: Model, study: StudyKind = 'simulacao'): Model {
  const { replay: _r, replaySource: _s, replayPrev, ...settings } = m.settings;
  return { ...m, settings: { ...settings, ...(replayPrev ?? {}), study } };
}
