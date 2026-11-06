// Roteiro de produção: sequência dos postos com mão de obra direta, mão de obra indireta
// (multifuncional, coordenador, reparo...) e o allowance pessoal coberto pelos multifuncionais.

import { cycleRows, effectiveTakt } from './balance';
import type { LineKpi } from './metrics';
import { baseCycle, type Model } from './types';

export type StaffKind = 'multi' | 'coordenador' | 'reparo' | 'lider' | 'abastecedor' | 'qualidade' | 'outro';

export const STAFF_LABEL: Record<StaffKind, string> = {
  multi: 'Multifuncional',
  coordenador: 'Coordenador',
  reparo: 'Reparo',
  lider: 'Líder de linha',
  abastecedor: 'Abastecedor',
  qualidade: 'Qualidade (IPQC)',
  outro: 'Outro',
};

export interface StaffRole {
  id: string;
  kind: StaffKind;
  /** Nome da função como aparece no roteiro. */
  funcao: string;
  qtd: number;
  /** O que a função faz (vai na coluna de observação). */
  obs?: string;
}

export interface StaffConfig {
  roles: StaffRole[];
  /** Minutos de necessidades pessoais (banheiro, água) por operador direto por turno. */
  pessoalMin: number;
  /** Fadiga e outras folgas (%) somadas ao allowance. */
  fadigaPct: number;
  /** Turnos por dia (para peças/dia e HC por dia). */
  turnos: number;
  /** Cabeçalho do documento. */
  produto?: string;
  docNo?: string;
  rev?: string;
  elaborado?: string;
  revisado?: string;
  aprovado?: string;
}

export const DEFAULT_STAFF: StaffConfig = {
  roles: [
    { id: 'multi', kind: 'multi', funcao: 'Multifuncional', qtd: 3, obs: 'Cobre banheiro e pausas pessoais dos operadores (allowance)' },
    { id: 'coord', kind: 'coordenador', funcao: 'Coordenador', qtd: 1, obs: 'Responsável pela linha no turno' },
    { id: 'reparo', kind: 'reparo', funcao: 'Reparo', qtd: 1, obs: 'Análise e reparo das peças reprovadas' },
  ],
  pessoalMin: 20,
  fadigaPct: 0,
  turnos: 1,
  rev: '00',
};

export interface RoutingRow {
  seq: number;
  id: string;
  posto: string;
  tipo: string;
  /** Gigas / postos em paralelo. */
  gigas: number;
  /** Operadores diretos dedicados (0 quando a equipe é compartilhada). */
  operadores: number;
  /** Nome da equipe compartilhada que atende o posto. */
  equipe?: string;
  /** Ciclo padrão do posto (s, por giga). */
  ciclo: number;
  /** Carga por peça da linha (s): ciclo ÷ eficiência ÷ gigas × fração ÷ lote. */
  carga: number;
  /** Carga com allowance (s). */
  cargaAllow: number;
  /** Carga ÷ takt. */
  ocupacao: number;
  ocupacaoAllow: number;
  /** Capacidade do posto (peças/h). */
  uph: number;
  /** Simulado: ocupação e peças (se houver simulação rodada). */
  utilSim?: number;
  pecasSim?: number;
  offline: boolean;
  gargalo: boolean;
}

export interface Routing {
  linha: string;
  takt: number;
  /** Tempo disponível do turno (min), sem as pausas planejadas. */
  disponivelMin: number;
  rows: RoutingRow[];
  diretos: number;
  /** Equipes compartilhadas (pools de operador). */
  equipes: { nome: string; qtd: number }[];
  indiretos: { funcao: string; qtd: number; obs: string; kind: StaffKind }[];
  totalIndiretos: number;
  hc: number;
  /** Allowance pessoal (fração): pessoal ÷ (disponível − pessoal) + fadiga. */
  allowance: number;
  /** Multifuncionais e cobertura do allowance. */
  multis: number;
  /** Minutos de cobertura que os diretos precisam no turno. */
  coberturaMin: number;
  /** Ocupação dos multifuncionais só com a cobertura pessoal (0-1+). */
  ocupacaoMulti: number;
  /** Multifuncionais necessários só para cobrir o pessoal (arredondado para cima). */
  multisNecessarios: number;
  /** Diretos por multifuncional. */
  diretosPorMulti: number;
  /** Produção: UPH planejado (gargalo), simulado e por pessoa. */
  uphPlan: number;
  uphSim?: number;
  pecasTurno: number;
  pecasDia: number;
  uphPorPessoa: number;
  /** Balanceamento da linha principal: média ÷ maior carga. */
  balanceamento: number;
  gargalo?: string;
}

const TIPO: Record<string, string> = { machine: 'Máquina', inspection: 'Inspeção / teste', rework: 'Reparo' };

/** Ocupação útil máxima de um multifuncional (o resto é deslocamento e espera entre coberturas). */
export const MULTI_UTIL = 0.85;

export function buildRouting(model: Model, staff: StaffConfig = DEFAULT_STAFF, kpi?: LineKpi): Routing {
  const s = model.settings;
  const takt = effectiveTakt(model);
  const pausas = (s.stops ?? []).reduce((a, p) => a + Math.max(0, p.duration), 0);
  const disponivelMin = Math.max(0, s.duration / 60 - pausas);
  const pessoal = Math.max(0, staff.pessoalMin);
  const allowance = (disponivelMin > pessoal ? pessoal / (disponivelMin - pessoal) : 0) + Math.max(0, staff.fadigaPct) / 100;

  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const pools = new Map((model.pools ?? []).map((p) => [p.id, p]));
  const ct = cycleRows(model, kpi);
  const main = ct.filter((r) => !r.offline);
  const maxPlan = Math.max(0, ...main.map((r) => r.plan));
  const gargaloId = main.find((r) => r.plan === maxPlan && maxPlan > 0)?.id;

  const rows: RoutingRow[] = ct.map((r, i) => {
    const n = byId.get(r.id)!;
    const k = kpi?.nodes.find((x) => x.id === r.id);
    const ops = n.poolId ? 0 : Math.max(0, n.operators);
    const cargaAllow = r.plan * (1 + allowance);
    return {
      seq: i + 1,
      id: n.id,
      posto: n.name,
      tipo: n.manual ? 'Manual' : TIPO[n.type] ?? n.type,
      gigas: Math.max(1, n.capacity),
      operadores: ops,
      equipe: n.poolId ? pools.get(n.poolId)?.name : undefined,
      ciclo: baseCycle(n, s),
      carga: r.plan,
      cargaAllow,
      ocupacao: takt > 0 ? r.plan / takt : 0,
      ocupacaoAllow: takt > 0 ? cargaAllow / takt : 0,
      uph: r.plan > 0 ? 3600 / r.plan : 0,
      utilSim: k && kpi && kpi.elapsed > 0 ? k.utilization : undefined,
      pecasSim: k && kpi && kpi.elapsed > 0 ? k.processed : undefined,
      offline: r.offline,
      gargalo: r.id === gargaloId,
    };
  });

  const equipes = (model.pools ?? []).filter((p) => p.kind === 'operator' && p.count > 0).map((p) => ({ nome: p.name, qtd: p.count }));
  const diretos = rows.reduce((a, r) => a + r.operadores, 0) + equipes.reduce((a, e) => a + e.qtd, 0);
  const indiretos = staff.roles
    .filter((r) => r.qtd > 0)
    .map((r) => ({ funcao: r.funcao || STAFF_LABEL[r.kind], qtd: r.qtd, obs: r.obs ?? '', kind: r.kind }));
  const totalIndiretos = indiretos.reduce((a, r) => a + r.qtd, 0);
  const hc = diretos + totalIndiretos;

  const multis = indiretos.filter((r) => r.kind === 'multi').reduce((a, r) => a + r.qtd, 0);
  const coberturaMin = diretos * pessoal;
  const capMulti = Math.max(0, disponivelMin - pessoal) * MULTI_UTIL;
  const ocupacaoMulti = multis > 0 && capMulti > 0 ? coberturaMin / (multis * capMulti) : coberturaMin > 0 ? Infinity : 0;
  const multisNecessarios = capMulti > 0 ? Math.max(0, Math.ceil(coberturaMin / capMulti - 1e-9)) : 0;

  const uphPlan = maxPlan > 0 ? 3600 / maxPlan : 0;
  const uphSim = kpi && kpi.elapsed > 0 && kpi.completed > 0 ? kpi.throughputPerHour : undefined;
  const uph = uphSim ?? uphPlan;
  const pecasTurno = (uph * disponivelMin) / 60;
  const media = main.length ? main.reduce((a, r) => a + r.plan, 0) / main.length : 0;

  return {
    linha: model.name,
    takt,
    disponivelMin,
    rows,
    diretos,
    equipes,
    indiretos,
    totalIndiretos,
    hc,
    allowance,
    multis,
    coberturaMin,
    ocupacaoMulti,
    multisNecessarios,
    diretosPorMulti: multis > 0 ? diretos / multis : 0,
    uphPlan,
    uphSim,
    pecasTurno,
    pecasDia: pecasTurno * Math.max(1, staff.turnos),
    uphPorPessoa: hc > 0 ? uph / hc : 0,
    balanceamento: maxPlan > 0 ? media / maxPlan : 0,
    gargalo: gargaloId ? byId.get(gargaloId)?.name : undefined,
  };
}
