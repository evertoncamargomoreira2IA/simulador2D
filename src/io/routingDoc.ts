// Documento do roteiro de produção: HTML pronto para imprimir/PDF (A4 paisagem) e planilha Excel.
// O nome da empresa no cabeçalho vem de private/company.txt (fora do git); sem ele, usa o nome do app.

import * as XLSX from 'xlsx';
import type { Routing, StaffConfig } from '../engine/routing';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const n1 = (v: number) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : '—');
const n0 = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('pt-BR') : '—');
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');

export function companyName(): string {
  return (typeof __COMPANY__ === 'string' && __COMPANY__) || __APP_NAME__;
}

export interface DocMeta {
  data: string;
  estudo: string;
}

/** Situação do posto pela ocupação com allowance. */
function status(o: number): { cls: string; txt: string } {
  if (o > 1) return { cls: 'red', txt: 'Acima do takt' };
  if (o > 0.95) return { cls: 'amb', txt: 'No limite' };
  return { cls: 'ok', txt: 'OK' };
}

export function routingHtml(r: Routing, staff: StaffConfig, meta: DocMeta): string {
  const empresa = companyName();
  const rows = r.rows
    .map((x) => {
      const st = status(x.ocupacaoAllow);
      return `<tr class="${x.gargalo ? 'gar' : ''}">
<td class="c">${x.seq}</td><td>${esc(x.setor)}</td><td>${esc(x.posto)}${x.gargalo ? ' <span class="tag">GARGALO</span>' : ''}${x.offline ? ' <span class="tag off">OFF-LINE</span>' : ''}</td>
<td>${esc(x.tipo)}</td><td class="c">${x.gigas}</td><td class="c">${x.equipe ? `<small>${esc(x.equipe)}</small>` : x.operadores}</td>
<td class="n">${n1(x.ciclo)}</td><td class="n">${n1(x.carga)}</td><td class="n">${n1(x.cargaAllow)}</td>
<td class="n">${pct(x.ocupacaoAllow)}</td><td class="n">${n0(x.uph)}</td>
<td class="n">${x.utilSim !== undefined ? pct(x.utilSim) : '—'}</td><td class="c"><span class="st ${st.cls}">${st.txt}</span></td></tr>`;
    })
    .join('');
  const ind = [
    ...r.equipes.map((e) => `<tr><td>Direto</td><td>${esc(e.nome)} (equipe compartilhada)</td><td class="c">${e.qtd}</td><td>Atende mais de um posto</td></tr>`),
    ...r.indiretos.map((x) => `<tr><td>Indireto</td><td>${esc(x.funcao)}</td><td class="c">${x.qtd}</td><td>${esc(x.obs)}</td></tr>`),
  ].join('');
  const multiOk = r.multis >= r.multisNecessarios;
  const kpi = (lbl: string, val: string, sub = '') => `<div class="kpi"><span>${lbl}</span><b>${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Roteiro de produção - ${esc(r.linha)}</title>
<style>
@page{size:A4 landscape;margin:10mm}
*{box-sizing:border-box}
body{font:11px/1.35 "Segoe UI",Arial,sans-serif;color:#1b2430;margin:0;background:#fff}
.doc{max-width:1120px;margin:0 auto;padding:14px}
table{border-collapse:collapse;width:100%}
.head td{border:1.5px solid #0b3d7a;padding:6px 8px;vertical-align:middle}
.brand{width:22%;text-align:center;background:#0b3d7a;color:#fff;font-weight:800;font-size:20px;letter-spacing:2px}
.brand small{display:block;font-size:9px;letter-spacing:1px;font-weight:600;opacity:.85}
.title{text-align:center;font-size:18px;font-weight:800;color:#0b3d7a;letter-spacing:1px}
.title small{display:block;font-size:11px;color:#4a5668;font-weight:600;letter-spacing:0}
.meta{width:22%;font-size:10px}.meta b{color:#0b3d7a}
.info{margin-top:6px}.info td{border:1px solid #b8c4d6;padding:4px 6px;font-size:10px}.info th{background:#e8eef7;border:1px solid #b8c4d6;padding:4px 6px;text-align:left;font-size:10px;color:#0b3d7a;width:11%}
h3{margin:12px 0 4px;font-size:12px;color:#fff;background:#0b3d7a;padding:4px 8px;letter-spacing:.5px}
.kpis{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin-top:8px}
.kpi{border:1px solid #b8c4d6;border-top:3px solid #0b3d7a;padding:4px 6px}
.kpi span{display:block;font-size:9px;color:#4a5668;text-transform:uppercase}.kpi b{font-size:15px;color:#0b3d7a}.kpi small{display:block;font-size:9px;color:#4a5668}
.grid th{background:#0b3d7a;color:#fff;padding:5px 4px;font-size:10px;border:1px solid #0b3d7a}
.grid td{border:1px solid #c9d3e2;padding:4px;font-size:10.5px}
.grid tbody tr:nth-child(even){background:#f4f7fb}
.grid tr.gar{background:#fff1e6!important}
.grid tfoot td{background:#e8eef7;font-weight:700}
.c{text-align:center}.n{text-align:right;font-variant-numeric:tabular-nums}
.tag{font-size:8px;background:#d9480f;color:#fff;padding:1px 4px;border-radius:3px;font-weight:700}.tag.off{background:#5c6b80}
.st{font-size:9px;padding:1px 5px;border-radius:8px;font-weight:700}.st.ok{background:#d3f0dc;color:#1c6b37}.st.amb{background:#fff0c2;color:#8a5a00}.st.red{background:#fbd5d5;color:#a51d1d}
.two{display:grid;grid-template-columns:1.25fr 1fr;gap:10px}
.allow td{border:1px solid #c9d3e2;padding:4px 6px}.allow td:first-child{background:#f4f7fb;width:62%}
.note{font-size:9.5px;color:#4a5668;margin:4px 0 0}
.verdict{margin-top:4px;padding:5px 8px;border-left:4px solid ${multiOk ? '#1c6b37' : '#a51d1d'};background:${multiOk ? '#eaf7ee' : '#fdecec'};font-weight:600}
.sign{margin-top:14px}.sign td{border:1px solid #0b3d7a;padding:6px 8px;height:52px;vertical-align:bottom;width:25%;font-size:10px}
.sign th{border:1px solid #0b3d7a;background:#e8eef7;color:#0b3d7a;font-size:10px;padding:4px}
.foot{display:flex;justify-content:space-between;font-size:9px;color:#6b778a;margin-top:6px}
@media print{.doc{padding:0}h3,.grid th,.brand{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="doc">
<table class="head"><tr>
<td class="brand">${esc(empresa.toUpperCase())}<small>ENGENHARIA DE PROCESSOS</small></td>
<td class="title">ROTEIRO DE PRODUÇÃO<small>Mão de obra direta e indireta · Allowance · Capacidade</small></td>
<td class="meta"><b>Doc. nº:</b> ${esc(staff.docNo || '—')}<br><b>Revisão:</b> ${esc(staff.rev || '00')}<br><b>Data:</b> ${esc(meta.data)}<br><b>Página:</b> 1 / 1</td>
</tr></table>
<table class="info"><tr><th>Linha</th><td>${esc(r.linha)}</td><th>Produto</th><td>${esc(staff.produto || '—')}</td><th>Estudo</th><td>${esc(meta.estudo)}</td><th>Turnos/dia</th><td>${staff.turnos}</td></tr>
<tr><th>Takt</th><td>${n1(r.takt)} s</td><th>Tempo disponível</th><td>${n0(r.disponivelMin)} min/turno</td><th>Gargalo</th><td>${esc(r.gargalo || '—')}</td><th>Balanceamento</th><td>${pct(r.balanceamento)}</td></tr></table>
<div class="kpis">
${kpi('HC direto', n0(r.diretos))}${kpi('HC indireto', n0(r.totalIndiretos))}${kpi('HC total', n0(r.hc))}
${kpi('UPH planejado', n0(r.uphPlan))}${kpi('UPH simulado', r.uphSim !== undefined ? n0(r.uphSim) : '—', r.uphSim !== undefined ? '' : 'rode a simulação')}
${kpi('UPPH', n1(r.uphPorPessoa), 'peças/h por pessoa')}${kpi('Peças/turno', n0(r.pecasTurno))}${kpi('Allowance', pct(r.allowance), 'pessoal + fadiga')}
</div>
<h3>1. SEQUÊNCIA DE OPERAÇÕES E MÃO DE OBRA DIRETA</h3>
<table class="grid"><thead><tr><th>Seq.</th><th>Setor</th><th>Posto</th><th>Tipo</th><th>Gigas</th><th>Operadores</th><th>Ciclo (s)</th><th>Carga/peça (s)</th><th>Carga c/ allowance (s)</th><th>Carga ÷ takt</th><th>Cap. (UPH)</th><th>Ocupação simulada</th><th>Situação</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="5">Total mão de obra direta</td><td class="c">${n0(r.diretos)}</td><td colspan="7"></td></tr></tfoot></table>
<div class="two">
<div><h3>2. MÃO DE OBRA INDIRETA E DE APOIO</h3>
<table class="grid"><thead><tr><th>Grupo</th><th>Função</th><th>Qtd.</th><th>Responsabilidade</th></tr></thead><tbody>${ind || '<tr><td colspan="4" class="c">Nenhuma função indireta informada</td></tr>'}</tbody>
<tfoot><tr><td colspan="2">Total indireto</td><td class="c">${n0(r.totalIndiretos)}</td><td></td></tr><tr><td colspan="2">HEADCOUNT TOTAL DA LINHA</td><td class="c">${n0(r.hc)}</td><td></td></tr></tfoot></table></div>
<div><h3>3. ALLOWANCE PESSOAL E COBERTURA DOS MULTIFUNCIONAIS</h3>
<table class="allow">
<tr><td>Necessidades pessoais por operador (banheiro, água)</td><td class="n">${n0(staff.pessoalMin)} min/turno</td></tr>
<tr><td>Allowance pessoal = ${n0(staff.pessoalMin)} ÷ (${n0(r.disponivelMin)} − ${n0(staff.pessoalMin)})</td><td class="n">${pct(r.allowance - staff.fadigaPct / 100)}</td></tr>
<tr><td>Fadiga e outras folgas</td><td class="n">${pct(staff.fadigaPct / 100)}</td></tr>
<tr><td><b>Allowance total aplicado na carga</b></td><td class="n"><b>${pct(r.allowance)}</b></td></tr>
<tr><td>Cobertura necessária = ${n0(r.diretos)} diretos × ${n0(staff.pessoalMin)} min</td><td class="n">${n0(r.coberturaMin)} min/turno</td></tr>
<tr><td>Multifuncionais informados / necessários (ocupação útil 85%)</td><td class="n">${n0(r.multis)} / ${n0(r.multisNecessarios)}</td></tr>
<tr><td>Ocupação dos multifuncionais só com a cobertura</td><td class="n">${Number.isFinite(r.ocupacaoMulti) ? pct(r.ocupacaoMulti) : 'sem cobertura'}</td></tr>
<tr><td>Diretos por multifuncional</td><td class="n">${r.multis ? n1(r.diretosPorMulti) : '—'}</td></tr>
</table>
<div class="verdict">${multiOk ? `Os ${n0(r.multis)} multifuncionais cobrem as pausas pessoais: a linha não para quando o operador sai do posto.` : `Faltam ${n0(r.multisNecessarios - r.multis)} multifuncional(is): sem cobertura, cada pausa para o posto e a produção cai.`}</div>
<p class="note">Com cobertura, o tempo pessoal do operador é feito pelo multifuncional; o tempo restante dele fica para treinamento, absenteísmo e apoio ao gargalo.</p>
</div></div>
<table class="sign"><tr><th>Elaborado por</th><th>Revisado por</th><th>Aprovado por</th><th>Produção</th></tr>
<tr><td>${esc(staff.elaborado || '')}</td><td>${esc(staff.revisado || '')}</td><td>${esc(staff.aprovado || '')}</td><td></td></tr></table>
<div class="foot"><span>Gerado pelo ${esc(__APP_NAME__)} em ${esc(meta.data)} · baseado no modelo simulado</span><span>Documento controlado: cópia impressa sem assinatura não tem validade</span></div>
</div></body></html>`;
}

/** Planilha do roteiro: abas Roteiro, Indiretos e Allowance. */
export function routingXlsx(r: Routing, staff: StaffConfig, meta: DocMeta): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const head = [
    ['ROTEIRO DE PRODUÇÃO', '', '', companyName()],
    ['Linha', r.linha, 'Produto', staff.produto ?? '', 'Doc. nº', staff.docNo ?? '', 'Revisão', staff.rev ?? '00', 'Data', meta.data],
    ['Takt (s)', +r.takt.toFixed(2), 'Disponível (min)', Math.round(r.disponivelMin), 'Gargalo', r.gargalo ?? '', 'HC total', r.hc, 'UPH', Math.round(r.uphSim ?? r.uphPlan)],
    [],
    ['Seq.', 'Setor', 'Posto', 'Tipo', 'Gigas', 'Operadores', 'Equipe', 'Ciclo (s)', 'Carga/peça (s)', 'Carga c/ allowance (s)', 'Carga ÷ takt', 'Cap. (UPH)', 'Ocupação simulada', 'Situação'],
    ...r.rows.map((x) => [
      x.seq, x.setor, x.posto + (x.gargalo ? ' (gargalo)' : ''), x.tipo, x.gigas, x.operadores, x.equipe ?? '', +x.ciclo.toFixed(2), +x.carga.toFixed(2), +x.cargaAllow.toFixed(2),
      +x.ocupacaoAllow.toFixed(3), Math.round(x.uph), x.utilSim !== undefined ? +x.utilSim.toFixed(3) : '', status(x.ocupacaoAllow).txt,
    ]),
    ['', '', 'Total direto', '', '', r.diretos],
  ];
  const ws = XLSX.utils.aoa_to_sheet(head);
  ws['!cols'] = [6, 14, 26, 14, 7, 10, 18, 10, 13, 18, 11, 10, 15, 13].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const ind = XLSX.utils.aoa_to_sheet([
    ['Grupo', 'Função', 'Qtd.', 'Responsabilidade'],
    ...r.equipes.map((e) => ['Direto', `${e.nome} (equipe compartilhada)`, e.qtd, 'Atende mais de um posto']),
    ...r.indiretos.map((x) => ['Indireto', x.funcao, x.qtd, x.obs]),
    ['', 'Total indireto', r.totalIndiretos],
    ['', 'Headcount total', r.hc],
  ]);
  ind['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 6 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ind, 'Indiretos');
  const al = XLSX.utils.aoa_to_sheet([
    ['Item', 'Valor'],
    ['Pessoal por operador (min/turno)', staff.pessoalMin],
    ['Tempo disponível (min/turno)', Math.round(r.disponivelMin)],
    ['Allowance pessoal', +(r.allowance - staff.fadigaPct / 100).toFixed(4)],
    ['Fadiga e outras (%)', staff.fadigaPct],
    ['Allowance total', +r.allowance.toFixed(4)],
    ['Cobertura necessária (min)', r.coberturaMin],
    ['Multifuncionais informados', r.multis],
    ['Multifuncionais necessários', r.multisNecessarios],
    ['Ocupação dos multifuncionais', Number.isFinite(r.ocupacaoMulti) ? +r.ocupacaoMulti.toFixed(3) : 'sem cobertura'],
    ['UPPH (peças/h por pessoa)', +r.uphPorPessoa.toFixed(2)],
    ['Peças por turno', Math.round(r.pecasTurno)],
    ['Peças por dia', Math.round(r.pecasDia)],
  ]);
  al['!cols'] = [{ wch: 34 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, al, 'Allowance');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
