// Importar SOE: escolher a aba e aplicar as atividades no modelo aberto ou criar uma linha nova.

import { useMemo, useState } from 'react';
import type * as XLSX from 'xlsx';
import { MANUAL_PATCH } from '../engine/types';
import { mergeSoe, parseSoe, soeSheets, type SoeResult } from '../io/soe';
import { blockNames, lineModel, parseLineWorkbook } from '../io/lineForm';
import { buildLine } from '../model/builder';
import { useStore } from '../store';
import { Modal } from './Modal';
import { fmt } from './theme';

let pending: { wb: XLSX.WorkBook; name: string } | null = null;

/** Abre a janela de importação de SOE para esta planilha. */
export function openSoe(wb: XLSX.WorkBook, name: string) {
  pending = { wb, name };
  useStore.getState().setShowSoe(true);
}

export function SoeImport({ onClose }: { onClose: () => void }) {
  const model = useStore((s) => s.model);
  const src = pending;
  const sheets = useMemo(() => (src ? soeSheets(src.wb) : []), [src]);
  const parsed = useMemo(() => {
    const out: Record<string, SoeResult | null> = {};
    for (const s of sheets) {
      try {
        out[s] = parseSoe(src!.wb, s);
      } catch {
        out[s] = null;
      }
    }
    return out;
  }, [sheets, src]);
  const usable = sheets.filter((s) => (parsed[s]?.stations.length ?? 0) > 0);
  // Linha completa: todas as abas de SOE + aba Postos (roteiro), Indiretos e Config.
  const spec = useMemo(() => {
    try {
      return src ? parseLineWorkbook(src.wb, src.name) : null;
    } catch {
      return null;
    }
  }, [src]);
  const full = !!spec && (usable.length > 1 || src!.wb.SheetNames.some((n) => /^postos?$/i.test(n.trim())));
  const ALL = '__all__';
  const [sheet, setSheet] = useState(full ? ALL : usable[0] ?? '');
  const [keepLayout, setKeepLayout] = useState(() => !!model.background);
  const soe = parsed[sheet] ?? null;
  const match = soe ? mergeSoe(model, soe) : null;
  const [mode, setMode] = useState<'merge' | 'new'>(() => (match && match.matched > 0 ? 'merge' : 'new'));
  const [useTakt, setUseTakt] = useState(false);
  if (!src) return null;

  const applyFull = () => {
    if (!spec) return;
    const m = lineModel(spec, keepLayout && model.background ? model : undefined);
    const blocks = m.nodes.filter((n) => n.type !== 'source' && n.type !== 'sink').length;
    useStore.getState().setModel(
      m,
      `Linha completa "${spec.name}": ${spec.sheets.length} abas de SOE, ${spec.stations.length} postos, ${blocks} blocos (um por operador nos postos manuais). Veja ▶ Start, Yamazumi e 📋 Roteiro.`,
    );
    onClose();
  };

  const apply = () => {
    if (!soe) return;
    const st = useStore.getState();
    const takt = { takt: useTakt && soe.takt ? soe.takt : 0 };
    if (mode === 'merge' && match && match.matched > 0) {
      st.setModel(
        { ...match.model, settings: { ...match.model.settings, ...takt, studyMode: 'elements' } },
        `SOE "${soe.sheet}": atividades aplicadas em ${match.matched} postos. Estudo por elemento ligado; veja Operações e o Yamazumi.`,
      );
    } else {
      const line = buildLine(
        soe.stations.map((s) => ({ name: s.name, cycleTime: Math.round(s.total * 100) / 100, operators: 1, availability: 1 })),
        { name: `${src.name} – ${soe.sheet}`, rejectPct: 0 },
      );
      line.nodes = line.nodes.map((n) => (n.type === 'machine' ? { ...n, ...MANUAL_PATCH, operators: 1 } : n));
      const m = mergeSoe(line, soe).model;
      st.setModel(
        { ...m, settings: { ...m.settings, ...takt, studyMode: 'elements', startFull: true, warmup: 0 } },
        `Linha criada do SOE "${soe.sheet}": ${soe.stations.length} postos com atividades. Veja Operações e o Yamazumi.`,
      );
    }
    onClose();
  };

  return (
    <Modal title="Importar SOE" sub={`"${src.name}": escolha a aba de atividades. Cada bloco de atividades vira um posto; os rótulos de texto viram operações.`} onClose={onClose} wide>
      {usable.length === 0 && !full ? (
        <p className="hint">Nenhuma aba com colunas de posto, atividade e tempo foi encontrada.</p>
      ) : (
        <div className="soe">
          <ul className="ops-list" aria-label="Abas">
            {full && (
              <li>
                <button className={sheet === ALL ? 'on' : ''} onClick={() => setSheet(ALL)}>
                  <b>📚 Linha completa (todas as abas)</b>
                  <small className="muted">
                    {spec!.sheets.length} abas · {spec!.stations.length} postos{spec!.staff ? ' · indiretos' : ''}
                  </small>
                </button>
              </li>
            )}
            {usable.map((s) => (
              <li key={s}>
                <button className={s === sheet ? 'on' : ''} onClick={() => setSheet(s)}>
                  <b>{s}</b>
                  <small className="muted">
                    {parsed[s]!.stations.length} postos · {parsed[s]!.stations.reduce((a, x) => a + x.operations.reduce((b, o) => b + o.activities.length, 0), 0)} atividades
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <div>
            {sheet === ALL && spec && (
              <>
                <table className="grid-table">
                  <thead>
                    <tr><th>Setor</th><th>Posto</th><th>Blocos</th><th>Gigas</th><th>Tempo (s)</th><th>Alimenta</th></tr>
                  </thead>
                  <tbody>
                    {spec.stations.map((s) => (
                      <tr key={s.setor + s.posto}>
                        <td>{s.setor}</td>
                        <td>{s.posto}</td>
                        <td>{blockNames(s).length}</td>
                        <td>{s.gigas}</td>
                        <td className={spec.takt && s.tempo / Math.max(1, blockNames(s).length > 1 ? blockNames(s).length : s.gigas) > spec.takt ? 'bad' : ''}>{fmt(s.tempo, 1)}</td>
                        <td>{s.alimenta ? `${s.alimenta}${s.ligacao === 'componente' ? ' (componente)' : ''}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="fields section">
                  <label className="field full check">
                    <input type="checkbox" checked={keepLayout && !!model.background} disabled={!model.background} onChange={(e) => setKeepLayout(e.target.checked)} />
                    <span>Usar o layout aberto: blocos com o mesmo nome ficam na posição do desenho{model.background ? '' : ' (abra um trabalho com layout para usar)'}</span>
                  </label>
                  <p className="hint">Takt {spec.takt ? `${fmt(spec.takt, 1)} s` : 'da operação'} · posto manual com N operadores vira N blocos · sem a aba Postos, cada setor vira uma linha separada.</p>
                </div>
                <div className="row-btns">
                  <button className="btn primary" onClick={applyFull}>Importar linha completa</button>
                  <button className="btn" onClick={onClose}>Cancelar</button>
                </div>
              </>
            )}
            {sheet !== ALL && soe && (
              <>
                <table className="grid-table">
                  <thead>
                    <tr><th>Posto</th><th>Operações</th><th>Atividades</th><th>Tempo (s)</th></tr>
                  </thead>
                  <tbody>
                    {soe.stations.map((s) => (
                      <tr key={s.name}>
                        <td>{s.name}</td>
                        <td>{s.operations.map((o) => o.name).join(', ')}</td>
                        <td>{s.operations.reduce((a, o) => a + o.activities.length, 0)}</td>
                        <td className={soe.takt && s.total > soe.takt ? 'bad' : ''}>{fmt(s.total, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="fields section">
                  <label className="field full check">
                    <input type="radio" name="soe-mode" checked={mode === 'merge' && !!match?.matched} disabled={!match?.matched} onChange={() => setMode('merge')} />
                    <span>Aplicar nos postos do modelo aberto ({match?.matched ?? 0} de {soe.stations.length} com o mesmo nome)</span>
                  </label>
                  <label className="field full check">
                    <input type="radio" name="soe-mode" checked={mode === 'new' || !match?.matched} onChange={() => setMode('new')} />
                    <span>Criar uma linha nova com estes postos</span>
                  </label>
                  {!!soe.takt && (
                    <label className="field full check">
                      <input type="checkbox" checked={useTakt} onChange={(e) => setUseTakt(e.target.checked)} />
                      <span>Usar o takt da planilha ({fmt(soe.takt, 1)} s · {fmt(3600 / soe.takt, 1)} UPH)</span>
                    </label>
                  )}
                </div>
                <div className="row-btns">
                  <button className="btn primary" onClick={apply}>Importar</button>
                  <button className="btn" onClick={onClose}>Cancelar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
