// Exportação: modelo (JSON/CSV), resultados (CSV/Excel).

import * as XLSX from 'xlsx';
import type { LineKpi } from '../engine/metrics';
import type { Model } from '../engine/types';

interface ClaudeHost {
  use?: (name: string) => Promise<{ save: (r: { filename: string; data: BlobPart }) => Promise<unknown> } | null>;
}

/** Salva um arquivo. Dentro do artefato do claude.ai usa a capacidade `downloads`; fora dele, um link. */
export async function download(name: string, content: BlobPart, mime: string): Promise<void> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const dl = await host.use('downloads').catch(() => null);
    if (dl) {
      await dl.save({ filename: name, data: content }).catch(() => undefined);
      return;
    }
  }
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const h = Object.keys(rows[0]);
  return [h.join(','), ...rows.map((r) => h.map((k) => csvCell(r[k])).join(','))].join('\n');
}

export function modelRows(m: Model): Record<string, unknown>[] {
  return m.nodes.map((n) => ({
    id: n.id,
    nome: n.name,
    tipo: n.type,
    tempo_ciclo: n.cycleTime,
    cv: n.cv,
    capacidade: n.capacity,
    fila: n.queueCap,
    operadores: n.operators,
    disponibilidade: n.availability,
    mttr: n.mttr,
    x: Math.round(n.x),
    y: Math.round(n.y),
    proximo: m.links
      .filter((l) => l.from === n.id)
      .map((l) => (l.weight !== 1 ? `${l.to}:${l.weight}` : l.to))
      .join(','),
  }));
}

export function resultRows(k: LineKpi): Record<string, unknown>[] {
  const r2 = (v: number) => Math.round(v * 1000) / 1000;
  return k.nodes.map((n) => ({
    id: n.id,
    nome: n.name,
    tipo: n.type,
    processadas: n.processed,
    utilizacao: r2(n.utilization),
    trabalhando_s: Math.round(n.states.working),
    espera_s: Math.round(n.states.starved),
    bloqueado_s: Math.round(n.states.blocked),
    parado_s: Math.round(n.states.down),
    setup_s: Math.round(n.states.setup),
    disponibilidade: r2(n.availability),
    performance: r2(n.performance),
    qualidade: r2(n.quality),
    oee: r2(n.oee),
    falhas: n.failures,
    gargalo: n.id === k.bottleneckId ? 'SIM' : '',
  }));
}

export function lineRows(k: LineKpi): Record<string, unknown>[] {
  return [
    { indicador: 'Tempo simulado (h)', valor: k.elapsed / 3600 },
    { indicador: 'Produção (peças)', valor: k.completed },
    { indicador: 'Throughput (peças/h)', valor: k.throughputPerHour },
    { indicador: 'Cycle time real (s)', valor: k.cycleTime },
    { indicador: 'Lead time médio (s)', valor: k.leadTime },
    { indicador: 'Tempo agregando valor (s)', valor: k.valueAddedTime },
    { indicador: 'Tempo em fila (s)', valor: k.queueTime },
    { indicador: 'Tempo bloqueado (s)', valor: k.blockedTime },
    { indicador: 'Tempo de transporte (s)', valor: k.transportTime },
    { indicador: 'WIP médio', valor: k.avgWip },
    { indicador: 'OEE da linha (takt)', valor: k.oee },
    { indicador: 'Aderência ao takt', valor: k.taktCompliance },
    { indicador: 'First pass yield', valor: k.firstPassYield },
    { indicador: 'Gargalo', valor: k.nodes.find((n) => n.id === k.bottleneckId)?.name ?? '' },
  ];
}

export function exportModelJson(m: Model): Promise<void> {
  return download(`${slug(m.name)}.json`, JSON.stringify(m, null, 2), 'application/json');
}

export function exportModelCsv(m: Model): Promise<void> {
  return download(`${slug(m.name)}_modelo.csv`, toCsv(modelRows(m)), 'text/csv;charset=utf-8');
}

export function exportResultsXlsx(m: Model, k: LineKpi): Promise<void> {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lineRows(k)), 'Linha');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resultRows(k)), 'Postos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(modelRows(m)), 'Modelo');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return download(`${slug(m.name)}_resultados.xlsx`, out, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function exportResultsCsv(m: Model, k: LineKpi): Promise<void> {
  return download(`${slug(m.name)}_resultados.csv`, toCsv(resultRows(k)), 'text/csv;charset=utf-8');
}

const slug = (s: string) => s.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'modelo';
