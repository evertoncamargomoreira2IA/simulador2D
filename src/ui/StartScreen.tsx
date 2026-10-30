// Tela de início: novo trabalho, trabalho salvo, exemplo ou arquivo.

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from '../engine/types';
import { modelStore, type SavedMeta } from '../io/storage';
import { elementsModel, lp2Model, simpleModel, combineModel, supplyModel, transportModel } from '../model/builder';
import { privateExample, useStore } from '../store';
import { ACCEPT, importAnyFile } from './fileImport';
import { Modal } from './Modal';
import { openSaved } from './SaveDialog';
import { downloadSoeForm } from './Tutorial';

export function blankModel(name = 'Novo trabalho') {
  return { name, nodes: [], links: [], settings: { ...DEFAULT_SETTINGS } };
}

export function StartScreen({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [list, setList] = useState<SavedMeta[] | null>(null);
  const [where, setWhere] = useState<'conta' | 'navegador'>('navegador');
  const fileRef = useRef<HTMLInputElement>(null);
  const st = useStore.getState;

  useEffect(() => {
    (async () => {
      const store = await modelStore();
      setWhere(store.where);
      setList(await store.list().then((l) => l.slice(0, 10)).catch(() => []));
    })();
  }, []);

  const startBlank = () => {
    st().openModel(blankModel(name.trim() || 'Novo trabalho'), 'Trabalho novo. Arraste a planta (DXF ou imagem) para a tela e monte a linha pela paleta: cada bloco novo já sai ligado ao anterior.');
    onClose();
  };
  const example = (k: 'real' | 'main' | 'lp2' | 'simple' | 'elements' | 'combine' | 'transport' | 'supply') => {
    const ex = privateExample();
    const main = k === 'main' ? privateExample('main') : null;
    if (main) st().openModel(main, 'Main line com operações e atividades de cada posto. Veja Análises → Yamazumi.');
    if (k === 'real' && ex) st().openModel(ex, 'Linha real carregada sobre o layout DXF. Clique em ▶ Start.');
    if (k === 'lp2') st().openModel(lp2Model(), 'Exemplo LP2 carregado (70 postos, 12 s por posto).');
    if (k === 'elements') st().openModel(elementsModel(), 'Linha exemplo com operações e atividades: estudo por elemento. Veja Análises → Yamazumi.');
    if (k === 'transport') st().openModel(transportModel(), 'Exemplo: dois buffers abastecem o Posto destino; o abastecedor leva 4 peças por viagem. Clique em ▶ Start.');
    if (k === 'combine') st().openModel(combineModel(), 'Exemplo: 3 postos fazem peças diferentes, o AMR e o abastecedor levam até o Posto X, que junta tudo em um produto. Clique em ▶ Start e no Posto X.');
    if (k === 'supply') st().setModel(supplyModel(), 'Exemplo: supermercado → kitting → milk run → linha (10 montagem, 5 off-line, 4 teste, 5 packing) → FGI → expedição, meta 100 UPH. Clique em ▶ Start.');
    if (k === 'simple') st().openModel(simpleModel(), 'Linha exemplo simples carregada.');
    onClose();
  };

  return (
    <Modal title="Começar" sub="Escolha um trabalho salvo, comece um novo ou abra um exemplo. Também dá para arrastar um arquivo para a tela." onClose={onClose}>
      <div className="start">
        <section>
          <p className="label">Novo trabalho</p>
          <div className="save-row">
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && startBlank()} placeholder="Nome do trabalho (ex.: Linha 4 – proposta A)" aria-label="Nome do novo trabalho" />
            <button className="btn primary" onClick={startBlank}>Criar em branco</button>
          </div>
          <div className="row-btns section">
            <button className="btn" onClick={() => fileRef.current?.click()} title="Planilha padrão, Excel, CSV, JSON do simulador, DXF ou imagem do layout">
              Abrir arquivo…
            </button>
            <button className="btn" onClick={() => downloadSoeForm()} title="Planilha no padrão SOE: uma linha por atividade. Preencha e suba em Abrir arquivo: os postos viram blocos sozinhos.">
              📥 Formulário Yamazumi (SOE)
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (!/\.(xlsx|xls|csv|txt|json)$/i.test(f.name)) st().openModel(blankModel(f.name.replace(/\.[^.]+$/, '')));
                await importAnyFile(f);
                onClose();
              }}
            />
            {privateExample() && <button className="btn" onClick={() => example('real')}>Exemplo: linha real</button>}
            {__EXAMPLE_MAIN__ && <button className="btn" onClick={() => example('main')}>Exemplo: main line com atividades</button>}
            <button className="btn" onClick={() => example('lp2')}>Exemplo: LP2</button>
            <button className="btn" onClick={() => example('simple')}>Exemplo: linha simples</button>
            <button className="btn" onClick={() => example('elements')}>Exemplo: linha com atividades (Yamazumi)</button>
            <button className="btn" onClick={() => example('supply')}>Exemplo: abastecimento e FGI (100 UPH)</button>
            <button className="btn" onClick={() => example('combine')}>Exemplo: combinar peças com AMR</button>
            <button className="btn" onClick={() => example('transport')}>Exemplo: operador levando peças</button>
          </div>
        </section>
        <section className="section">
          <p className="label">Trabalhos salvos {where === 'conta' ? '(na sua conta)' : '(neste navegador)'}</p>
          {list === null ? (
            <p className="hint">Carregando…</p>
          ) : list.length === 0 ? (
            <p className="hint">Nenhum trabalho salvo ainda. Depois de montar, use Salvar (Ctrl+S).</p>
          ) : (
            <ul className="saved">
              {list.map((m) => (
                <li key={m.id}>
                  <div>
                    <b>{m.nome}</b>
                    <p className="sub">
                      {m.blocos} blocos · {new Date(m.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </div>
                  <button
                    className="btn primary"
                    onClick={async () => {
                      if (await openSaved(m)) onClose();
                    }}
                  >
                    Abrir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
