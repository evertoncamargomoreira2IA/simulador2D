// Pop-up do roteiro de produção: postos e mão de obra direta (do modelo), campos da mão de obra
// indireta (multifuncional, coordenador, reparo...), allowance pessoal e exportação no padrão do documento.

import { useMemo, useRef, useState } from 'react';
import { buildRouting, DEFAULT_STAFF, STAFF_LABEL, type StaffConfig, type StaffKind, type StaffRole } from '../engine/routing';
import { download } from '../io/exporter';
import { routingHtml, routingXlsx } from '../io/routingDoc';
import { useStore } from '../store';
import { HowTo } from './HowTo';
import { Modal } from './Modal';

const STUDY: Record<string, string> = { simulacao: 'Simulação', historico: 'Reprodução histórica', monitoramento: 'Monitoramento real' };
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');
const safe = (s: string) => s.replace(/[^\w\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'linha';

export function RoutingModal({ onClose }: { onClose: () => void }) {
  const model = useStore((s) => s.model);
  const kpi = useStore((s) => s.kpi);
  const [staff, setStaffLocal] = useState<StaffConfig>(() => structuredClone(model.settings.staff ?? DEFAULT_STAFF));
  const [view, setView] = useState<'campos' | 'documento'>('campos');
  const frame = useRef<HTMLIFrameElement>(null);
  const r = useMemo(() => buildRouting(model, staff, kpi.elapsed > 0 ? kpi : undefined), [model, staff, kpi]);
  const meta = { data: new Date().toLocaleDateString('pt-BR'), estudo: STUDY[model.settings.study ?? 'simulacao'] ?? 'Simulação' };
  const html = useMemo(() => routingHtml(r, staff, meta), [r, staff, meta.data, meta.estudo]); // eslint-disable-line react-hooks/exhaustive-deps

  const put = (p: Partial<StaffConfig>) => setStaffLocal((s) => ({ ...s, ...p }));
  const role = (id: string, p: Partial<StaffRole>) => put({ roles: staff.roles.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const addRole = (kind: StaffKind) => put({ roles: [...staff.roles, { id: `r${Date.now().toString(36)}`, kind, funcao: STAFF_LABEL[kind], qtd: 1, obs: '' }] });
  const save = () => useStore.getState().setStaff(staff);
  const close = () => (save(), onClose());
  const name = `roteiro-producao-${safe(model.name)}`;
  const print = () => {
    save();
    setView('documento');
    setTimeout(() => frame.current?.contentWindow?.print(), 300);
  };

  const multiOk = r.multis >= r.multisNecessarios;
  return (
    <Modal title="📋 Roteiro de produção" sub={`${r.rows.length} postos · ${r.diretos} diretos + ${r.totalIndiretos} indiretos = ${r.hc} pessoas · ${meta.estudo}`} onClose={close} wide>
      <HowTo
        title="Roteiro de produção"
        why="Junta a sequência dos postos com a mão de obra direta (vem do modelo), a indireta (você informa aqui) e o allowance pessoal coberto pelos multifuncionais. Sai um documento pronto para imprimir, salvar em PDF ou Excel."
        steps={[
          'Rode a simulação antes: a ocupação simulada e o UPH simulado entram no roteiro.',
          'Em "Mão de obra indireta", ajuste a quantidade de multifuncionais, coordenador e reparo (ou adicione outras funções).',
          'Informe os minutos de banheiro/água por operador no turno: o allowance é calculado e somado à carga de cada posto.',
          'Veja o veredito: se os multifuncionais cobrem as pausas, a linha não para.',
          'Abra "Documento" para conferir e use Imprimir / PDF, Baixar HTML ou Baixar Excel.',
        ]}
        tip="Allowance pessoal = minutos pessoais ÷ (tempo disponível − minutos pessoais). Ex.: 20 ÷ (480 − 20) = 4,3%."
      />
      <div className="seg" role="tablist" style={{ margin: '8px 0' }}>
        <button className={`btn${view === 'campos' ? ' primary' : ''}`} onClick={() => setView('campos')}>✏️ Campos</button>
        <button className={`btn${view === 'documento' ? ' primary' : ''}`} onClick={() => (save(), setView('documento'))}>📄 Documento</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={print} title="Abre a impressão; escolha 'Salvar como PDF' para ter o PDF">🖨 Imprimir / PDF</button>
        <button className="btn" onClick={() => (save(), download(`${name}.html`, html, 'text/html'))}>⬇ HTML</button>
        <button className="btn" onClick={() => (save(), download(`${name}.xlsx`, routingXlsx(r, staff, meta), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))}>⬇ Excel</button>
      </div>

      {view === 'documento' ? (
        <iframe ref={frame} className="routing-frame" title="Roteiro de produção" srcDoc={html} />
      ) : (
        <div className="routing">
          <div className="twin-kpis">
            <div className="tile"><div className="k">HC direto</div><div className="v">{r.diretos}</div></div>
            <div className="tile"><div className="k">HC indireto</div><div className="v">{r.totalIndiretos}</div></div>
            <div className="tile"><div className="k">HC total</div><div className="v">{r.hc}</div></div>
            <div className="tile"><div className="k">UPH {r.uphSim !== undefined ? 'simulado' : 'planejado'}</div><div className="v">{Math.round(r.uphSim ?? r.uphPlan)}</div></div>
            <div className="tile"><div className="k">UPPH</div><div className="v">{r.uphPorPessoa.toFixed(1)}</div></div>
            <div className="tile"><div className="k">Allowance</div><div className="v">{pct(r.allowance)}</div></div>
          </div>

          <h4>Mão de obra indireta e de apoio</h4>
          <table className="grid-table">
            <thead><tr><th>Tipo</th><th>Função no roteiro</th><th>Qtd.</th><th>Responsabilidade</th><th /></tr></thead>
            <tbody>
              {staff.roles.map((x) => (
                <tr key={x.id}>
                  <td>
                    <select value={x.kind} onChange={(e) => role(x.id, { kind: e.target.value as StaffKind })} aria-label="Tipo da função">
                      {Object.entries(STAFF_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><input value={x.funcao} onChange={(e) => role(x.id, { funcao: e.target.value })} aria-label="Função" /></td>
                  <td><input type="number" min={0} step={1} value={x.qtd} style={{ width: 60 }} onChange={(e) => role(x.id, { qtd: Math.max(0, Math.round(+e.target.value || 0)) })} aria-label={`Quantidade de ${x.funcao}`} /></td>
                  <td><input value={x.obs ?? ''} style={{ width: '100%' }} onChange={(e) => role(x.id, { obs: e.target.value })} aria-label="Responsabilidade" /></td>
                  <td><button className="btn icon" onClick={() => put({ roles: staff.roles.filter((y) => y.id !== x.id) })} aria-label={`Remover ${x.funcao}`}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {(Object.keys(STAFF_LABEL) as StaffKind[]).map((k) => (
              <button key={k} className="btn small" onClick={() => addRole(k)}>+ {STAFF_LABEL[k]}</button>
            ))}
          </div>

          <h4>Allowance pessoal (banheiro, água)</h4>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            <label>Minutos por operador no turno <input type="number" min={0} max={120} value={staff.pessoalMin} style={{ width: 70 }} onChange={(e) => put({ pessoalMin: Math.max(0, +e.target.value || 0) })} /></label>
            <label>Fadiga e outras folgas (%) <input type="number" min={0} max={50} value={staff.fadigaPct} style={{ width: 70 }} onChange={(e) => put({ fadigaPct: Math.max(0, +e.target.value || 0) })} /></label>
            <label>Turnos por dia <input type="number" min={1} max={3} value={staff.turnos} style={{ width: 60 }} onChange={(e) => put({ turnos: Math.min(3, Math.max(1, Math.round(+e.target.value || 1))) })} /></label>
          </div>
          <p className="hint">
            Tempo disponível {Math.round(r.disponivelMin)} min (turno sem as pausas planejadas). Allowance = {staff.pessoalMin} ÷ ({Math.round(r.disponivelMin)} − {staff.pessoalMin}){staff.fadigaPct ? ` + ${staff.fadigaPct}%` : ''} = <b>{pct(r.allowance)}</b>.
            Cobertura: {r.diretos} diretos × {staff.pessoalMin} min = {Math.round(r.coberturaMin)} min; precisa de <b>{r.multisNecessarios}</b> multifuncional(is), há <b>{r.multis}</b>
            {Number.isFinite(r.ocupacaoMulti) && r.multis > 0 ? ` (ocupação ${pct(r.ocupacaoMulti)} só com a cobertura)` : ''}.
          </p>
          <p className={`verdict-line ${multiOk ? 'ok' : 'bad'}`}>
            {multiOk ? '✅ Os multifuncionais cobrem as pausas pessoais: a linha não para.' : `⚠️ Faltam ${r.multisNecessarios - r.multis} multifuncional(is): cada pausa para o posto.`}
          </p>

          <h4>Cabeçalho do documento</h4>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {(
              [
                ['produto', 'Produto'],
                ['docNo', 'Doc. nº'],
                ['rev', 'Revisão'],
                ['elaborado', 'Elaborado por'],
                ['revisado', 'Revisado por'],
                ['aprovado', 'Aprovado por'],
              ] as const
            ).map(([k, l]) => (
              <label key={k}>{l} <input value={staff[k] ?? ''} style={{ width: k === 'rev' ? 50 : 140 }} onChange={(e) => put({ [k]: e.target.value })} /></label>
            ))}
          </div>

          <h4>Sequência dos postos (do modelo)</h4>
          <table className="grid-table">
            <thead><tr><th>Seq.</th><th>Posto</th><th>Gigas</th><th>Operadores</th><th>Ciclo (s)</th><th>Carga c/ allowance (s)</th><th>÷ takt</th><th>Ocupação sim.</th></tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.id} className={x.gargalo ? 'gar' : ''}>
                  <td>{x.seq}</td>
                  <td>{x.posto}{x.gargalo ? ' 🔶' : ''}{x.offline ? ' (off-line)' : ''}</td>
                  <td>{x.gigas}</td>
                  <td>{x.equipe ?? x.operadores}</td>
                  <td>{x.ciclo.toFixed(1)}</td>
                  <td>{x.cargaAllow.toFixed(1)}</td>
                  <td className={x.ocupacaoAllow > 1 ? 'bad' : ''}>{pct(x.ocupacaoAllow)}</td>
                  <td>{x.utilSim !== undefined ? pct(x.utilSim) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">Takt {r.takt.toFixed(1)} s · gargalo {r.gargalo ?? '—'} · balanceamento {pct(r.balanceamento)}. Os operadores diretos vêm de cada posto (painel de propriedades) e das equipes compartilhadas.</p>
        </div>
      )}
    </Modal>
  );
}
