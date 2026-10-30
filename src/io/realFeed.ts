// Fontes de dados reais da operação: API do computador de cada posto, arquivo exportado
// ou a fonte simulada (a linha do modelo rodando no lugar da linha real, até a API existir).

import { Rng } from '../engine/rng';
import { Simulator } from '../engine/simulator';
import type { RealEvent } from '../engine/timeStudy';
import type { Model } from '../engine/types';

export interface FeedOptions {
  /** Horas de operação a gerar. */
  hours: number;
  /** Fração de leituras com uma parada curta embutida (testa o descarte de discrepantes). */
  glitch: number;
  /** Variação de cada operação dentro do ciclo (cv). */
  opCv: number;
  /** Diferença máxima entre a linha "real" e o SOE, sorteada por posto (0,15 = até ±15%). */
  drift: number;
}

export const FEED_DEFAULTS: FeedOptions = { hours: 2, glitch: 0.03, opCv: 0.12, drift: 0.15 };

/**
 * Roda o modelo e devolve as leituras que a linha real mandaria: uma por peça em cada posto,
 * ou uma por operação quando o posto tem operações cadastradas.
 */
export function simulatedFeed(model: Model, o: FeedOptions = FEED_DEFAULTS): RealEvent[] {
  const m: Model = { ...model, settings: { ...model.settings, duration: Math.max(600, o.hours * 3600), startFull: true } };
  const sim = new Simulator(m);
  const rng = new Rng((model.settings.seed || 1) * 7919 + 13);
  const out: RealEvent[] = [];
  // cada posto real fica um pouco acima ou abaixo do SOE (método, habilidade, ajuste do posto)
  const bias = new Map(model.nodes.map((n) => [n.id, 1 + (rng.next() * 2 - 1) * o.drift]));
  sim.onCycle = ({ node, serial, start, end }) => {
    if (start < sim.t0 || !(node.type === 'machine' || node.type === 'inspection' || node.type === 'rework')) return;
    const a = start - sim.t0;
    let b = a + (end - start) * (bias.get(node.id) ?? 1);
    // chão de fábrica: de vez em quando a peça fica parada no posto (falta de material, dúvida, retrabalho rápido)
    if (rng.next() < o.glitch) b += (b - a) * (2 + rng.next() * 3);
    const serie = `SN${String(serial).padStart(6, '0')}`;
    const ops = (node.operations ?? []).filter((op) => op.activities.some((x) => x.time > 0));
    if (!ops.length) {
      out.push({ posto: node.name, serie, inicio: a, fim: b, turno: 'T1' });
      return;
    }
    // reparte o ciclo entre as operações, cada uma com sua variação
    const w = ops.map((op) => rng.lognormal(op.activities.reduce((s, x) => s + (x.time || 0), 0), o.opCv));
    const total = w.reduce((s, x) => s + x, 0) || 1;
    let t = a;
    ops.forEach((op, i) => {
      const d = ((b - a) * w[i]) / total;
      out.push({ posto: node.name, serie, inicio: t, fim: t + d, operacao: op.name, turno: 'T1' });
      t += d;
    });
  };
  sim.runToEnd();
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function pick(r: Record<string, unknown>, keys: string[]): unknown {
  for (const [k, v] of Object.entries(r)) if (keys.includes(norm(k))) return v;
  return undefined;
}

/** Horário: segundos, milissegundos (época), "hh:mm:ss" ou data ISO. Devolve segundos. */
export function toSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e11 ? v / 1000 : v;
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const hms = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?$/.exec(s);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number((hms[3] ?? '0').replace(',', '.'));
  const num = Number(s.replace(',', '.'));
  if (Number.isFinite(num)) return num > 1e11 ? num / 1000 : num;
  const d = Date.parse(s);
  return Number.isFinite(d) ? d / 1000 : null;
}

/**
 * Converte linhas (API, Excel, CSV) em leituras. Aceita nomes em português ou inglês.
 * Campos de pessoa (operador, matrícula, nome) são ignorados de propósito (LGPD).
 */
export function eventsFromRows(rows: Record<string, unknown>[]): RealEvent[] {
  const out: RealEvent[] = [];
  for (const r of rows) {
    const posto = pick(r, ['posto', 'station', 'estacao', 'workstation']);
    const inicio = toSeconds(pick(r, ['inicio', 'start', 'entrada', 'scanin', 'begin']));
    let fim = toSeconds(pick(r, ['fim', 'end', 'saida', 'scanout', 'finish']));
    const dur = pick(r, ['duracao', 'duration', 'ciclo', 'cycle', 'tempo']);
    if (posto === undefined || posto === '' || inicio === null) continue;
    if (fim === null && dur !== undefined) fim = inicio + Number(String(dur).replace(',', '.'));
    if (fim === null || !Number.isFinite(fim)) continue;
    const op = pick(r, ['operacao', 'operation', 'op', 'atividade']);
    const turno = pick(r, ['turno', 'shift']);
    out.push({
      posto: String(posto),
      serie: String(pick(r, ['serie', 'serial', 'sn', 'numerodeserie', 'peca', 'id']) ?? `${posto}-${out.length}`),
      inicio,
      fim,
      ...(op !== undefined && op !== '' ? { operacao: String(op) } : {}),
      ...(turno !== undefined && turno !== '' ? { turno: String(turno) } : {}),
    });
  }
  return out;
}

/** Busca as leituras na API (GET que devolve uma lista JSON, ou { eventos: [...] }). */
export async function fetchEvents(url: string): Promise<RealEvent[]> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`a API respondeu ${res.status}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body?.eventos ?? body?.events ?? body?.data ?? []);
  return eventsFromRows(Array.isArray(list) ? list : []);
}

/** Planilha das leituras (para conferir ou mandar para a TI como modelo do formato da API). */
export function eventsToRows(events: RealEvent[]): Record<string, unknown>[] {
  return events.map((e) => ({
    posto: e.posto,
    serie: e.serie,
    operacao: e.operacao ?? '',
    turno: e.turno ?? '',
    inicio: Math.round(e.inicio * 10) / 10,
    fim: Math.round(e.fim * 10) / 10,
    duracao: Math.round((e.fim - e.inicio) * 10) / 10,
  }));
}
