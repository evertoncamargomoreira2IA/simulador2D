// Importar SOE: escolher a aba e aplicar as atividades no modelo aberto ou criar uma linha nova.

import { useMemo, useState } from 'react';
import type * as XLSX from 'xlsx';
import { MANUAL_PATCH } from '../engine/types';
import { mergeSoe, parseSoe, soeSheets, type SoeResult } from '../io/soe';
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
  const [sheet, setSheet] = useState(usable[0] ?? '');
  const soe = parsed[sheet] ?? null;
  const match = soe ? mergeSoe(model, soe) : null;
  const [mode, setMode] = useState<'merge' | 'new'>(() => (match && match.matched > 0 ? 'merge' : 'new'));
  const [useTakt, setUseTakt] = useState(false);
  if (!src) return null;

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
      {usable.length === 0 ? (
        <p className="hint">Nenhuma aba com colunas de posto, atividade e tempo foi encontrada.</p>
      ) : (
        <div className="soe">
          <ul className="ops-list" aria-label="Abas">
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
            {soe && (
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
