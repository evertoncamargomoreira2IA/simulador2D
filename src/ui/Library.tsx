// Biblioteca de soluções: lista de dúvidas, passo a passo com prints e botão para abrir o exemplo pronto.

import { useMemo, useState } from 'react';
import { combineModel, elementsModel, simpleModel, transportModel } from '../model/builder';
import { useStore } from '../store';
import { LIBRARY, type LibExample, type LibItem } from './library';
import { Modal } from './Modal';

const IMGS = import.meta.glob('../assets/library/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const img = (k: string) => IMGS[`../assets/library/${k}.webp`];

const EXAMPLES: Record<LibExample, { build: () => ReturnType<typeof simpleModel>; msg: string }> = {
  transport: { build: transportModel, msg: 'Exemplo: dois buffers abastecem o Posto destino; o abastecedor leva 4 peças por viagem. Clique em ▶ Start.' },
  combine: { build: combineModel, msg: 'Exemplo: três postos, AMR e abastecedor levam as peças ao Posto X, que junta tudo em um produto. Clique em ▶ Start.' },
  elements: { build: elementsModel, msg: 'Exemplo: linha com operações e atividades. Veja Análises → Yamazumi.' },
  simple: { build: simpleModel, msg: 'Linha exemplo simples carregada.' },
};

export function Library({ onClose, start }: { onClose: () => void; start?: string }) {
  const [sel, setSel] = useState(start ?? LIBRARY[0].id);
  const [q, setQ] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? LIBRARY.filter((x) => `${x.q} ${x.tag} ${x.why}`.toLowerCase().includes(t)) : LIBRARY;
  }, [q]);
  const it = LIBRARY.find((x) => x.id === sel) ?? LIBRARY[0];

  const openExample = (k: LibExample, item: LibItem) => {
    const ex = EXAMPLES[k];
    useStore.getState().openModel(ex.build(), ex.msg);
    if (item.screen) useStore.getState().setAnalysis(item.screen);
    onClose();
  };

  return (
    <Modal title="💡 Biblioteca de soluções" sub="As dúvidas mais comuns, com passo a passo em imagens e um exemplo pronto para abrir." onClose={onClose} wide>
      <div className="lib">
        <nav className="lib-list" aria-label="Dúvidas">
          <input className="lib-search" placeholder="Buscar dúvida…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar dúvida" />
          {list.map((x) => (
            <button key={x.id} className={`lib-item${x.id === it.id ? ' on' : ''}`} onClick={() => setSel(x.id)}>
              <small>{x.tag}</small>
              {x.q}
            </button>
          ))}
          {list.length === 0 && <p className="hint">Nada encontrado. Tente outra palavra.</p>}
        </nav>
        <article className="lib-body">
          <h3>{it.q}</h3>
          <p className="lib-why">
            <b>Por que acontece:</b> {it.why}
          </p>
          <ol className="lib-steps">
            {it.steps.map((s, i) => (
              <li key={i}>
                <span className="lib-n">{i + 1}</span>
                <div>
                  <p>{s.text}</p>
                  {s.img && img(s.img) && (
                    <button className="lib-shot" onClick={() => setZoom(img(s.img!))} title="Clique para ampliar">
                      <img src={img(s.img)} alt={`Passo ${i + 1}: ${s.text}`} loading="lazy" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {it.tip && (
            <p className="howto-tip">
              <span aria-hidden>👉</span> {it.tip}
            </p>
          )}
          <div className="row-btns">
            {it.example && (
              <button className="btn primary" onClick={() => openExample(it.example!, it)}>
                ▶ Abrir exemplo pronto
              </button>
            )}
            {it.screen && !it.example && (
              <button className="btn" onClick={() => { useStore.getState().setAnalysis(it.screen!); onClose(); }}>
                Ir para a tela
              </button>
            )}
          </div>
        </article>
      </div>
      {zoom && (
        <div className="lib-zoom" onClick={() => setZoom(null)} role="dialog" aria-label="Imagem ampliada">
          <img src={zoom} alt="" />
        </div>
      )}
    </Modal>
  );
}
