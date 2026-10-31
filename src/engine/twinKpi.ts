// Indicadores do gêmeo digital, calculados só com os scans (nada simulado):
// OEE ao vivo, previsão de fim de turno e Pareto das perdas (andon).

const clamp = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export interface Oee {
  /** Disponibilidade: tempo rodando ÷ tempo do turno até agora. */
  a: number;
  /** Performance: peças × ciclo padrão ÷ tempo rodando. */
  p: number;
  /** Qualidade: peças boas ÷ peças feitas. */
  q: number;
  oee: number;
}

/**
 * OEE = Disponibilidade × Performance × Qualidade.
 * relogio e ideal em segundos; paradoMin = minutos parados; refugo = peças ruins (0 sem dado de qualidade).
 */
export function oee(o: { relogio: number; feitas: number; ideal: number; paradoMin: number; refugo?: number }): Oee {
  const run = Math.max(0, o.relogio - o.paradoMin * 60);
  const a = o.relogio > 0 ? clamp(run / o.relogio) : 0;
  const p = run > 0 && o.ideal > 0 ? clamp((o.feitas * o.ideal) / run) : 0;
  const q = o.feitas > 0 ? clamp((o.feitas - (o.refugo ?? 0)) / o.feitas) : 1;
  return { a, p, q, oee: a * p * q };
}

export interface Forecast {
  /** Peças previstas no fim do turno, no ritmo atual. */
  fim: number;
  /** Meta do turno inteiro (duração ÷ takt). */
  meta: number;
  /** Ritmo usado (peças/h). */
  ritmo: number;
  /** Ritmo necessário daqui para frente para bater a meta (peças/h); 0 se já bateu. */
  precisa: number;
  /** Tempo que falta (s). */
  falta: number;
}

/**
 * Previsão de fim de turno: peças feitas + ritmo recente × tempo que falta.
 * recente = peças por hora na última janela (se houver); senão usa a média do turno.
 */
export function forecast(o: { pecas: number; relogio: number; duracao: number; takt: number; recente?: number }): Forecast {
  const falta = Math.max(0, o.duracao - o.relogio);
  const media = o.relogio > 0 ? (o.pecas * 3600) / o.relogio : 0;
  const ritmo = o.recente !== undefined && o.recente > 0 ? o.recente : media;
  const meta = o.takt > 0 ? o.duracao / o.takt : 0;
  const fim = o.pecas + (ritmo * falta) / 3600;
  const precisa = falta > 0 && meta > o.pecas ? ((meta - o.pecas) * 3600) / falta : 0;
  return { fim, meta, ritmo, precisa, falta };
}

/** Ritmo recente (peças/h) pelas horas dos scans do último posto: janela de 30 min do turno. */
export function recentRate(horas: number[], agora: number, janela = 1800): number | undefined {
  if (agora < janela / 2) return undefined;
  const w = Math.min(janela, agora);
  const n = horas.filter((h) => h > agora - w && h <= agora).length;
  return (n * 3600) / w;
}

export const ANDON_MOTIVOS = ['Falta de material', 'Máquina quebrada', 'Qualidade / retrabalho', 'Troca de modelo / setup', 'Falta de operador', 'Ajuste de processo', 'Outro'] as const;
export const SEM_MOTIVO = 'Sem motivo informado';

export interface AndonStop {
  id: string;
  posto: string;
  motivo: string;
  /** Hora do turno em que parou (s). */
  inicio: number;
  /** Hora em que voltou (s); vazio = ainda parado. */
  fim?: number;
}

/** Pareto das perdas: minutos por motivo, do maior para o menor, com o % acumulado. */
export function pareto(stops: AndonStop[], agora: number, perdidoTotalMin = 0): { motivo: string; min: number; acum: number }[] {
  const by = new Map<string, number>();
  for (const s of stops) by.set(s.motivo, (by.get(s.motivo) ?? 0) + Math.max(0, (s.fim ?? agora) - s.inicio) / 60);
  const marcado = [...by.values()].reduce((a, b) => a + b, 0);
  if (perdidoTotalMin - marcado > 0.5) by.set(SEM_MOTIVO, perdidoTotalMin - marcado);
  const rows = [...by.entries()].map(([motivo, min]) => ({ motivo, min })).sort((a, b) => b.min - a.min);
  const tot = rows.reduce((a, r) => a + r.min, 0) || 1;
  let acc = 0;
  return rows.map((r) => ({ ...r, acum: ((acc += r.min) / tot) * 100 }));
}
