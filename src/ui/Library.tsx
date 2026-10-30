// Biblioteca de soluções: lista de dúvidas, passo a passo com prints e botão para abrir o exemplo pronto.

import { useMemo, useState } from 'react';
import { combineModel, elementsModel, simpleModel, supplyModel, transportModel } from '../model/builder';
import { useStore } from '../store';
import { LIBRARY, type LibExample, type LibItem } from './library';
import { Modal } from './Modal';

const IMGS = import.meta.glob('../assets/library/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const img = (k: string) => IMGS[`../assets/library/${k}.webp`];

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Busca por palavra-chave: sem acento, todas as palavras precisam aparecer (pergunta, tema, passos, dica ou palavras-chave). */
export function searchLibrary(q: string): LibItem[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return LIBRARY;
  return LIBRARY.map((x) => {
    const head = fold(`${x.q} ${x.tag} ${x.keys ?? ''}`);
    const body = fold(`${x.why} ${x.steps.map((s) => s.text).join(' ')} ${x.tip ?? ''}`);
    if (!words.every((w) => head.includes(w) || body.includes(w))) return null;
    // pergunta, tema e palavras-chave pesam mais que o texto dos passos
    return { x, score: words.reduce((a, w) => a + (head.includes(w) ? 3 : 1), 0) };
  })
    .filter((r): r is { x: LibItem; score: number } => !!r)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.x);
}

const EXAMPLES: Record<LibExample, { build: () => ReturnType<typeof simpleModel>; msg: string }> = {
  transport: { build: transportModel, msg: 'Exemplo: dois buffers abastecem o Posto destino; o abastecedor leva 4 peças por viagem. Clique em ▶ Start.' },
  combine: { build: combineModel, msg: 'Exemplo: três postos, AMR e abastecedor levam as peças ao Posto X, que junta tudo em um produto. Clique em ▶ Start.' },
  elements: { build: elementsModel, msg: 'Exemplo: linha com operações e atividades. Veja Análises → Yamazumi.' },
  supply: { build: supplyModel, msg: 'Exemplo: supermercado → kitting → milk run → linha (10 montagem, 5 off-line, 4 teste, 5 packing) → FGI → expedição, meta 100 UPH. Clique em ▶ Start.' },
  simple: { build: simpleModel, msg: 'Linha exemplo simples carregada.' },
};

export function Library({ onClose, start }: { onClose: () => void; start?: string }) {
  const [sel, setSel] = useState(start ?? LIBRARY[0].id);
  const [q, setQ] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const list = useMemo(() => searchLibrary(q), [q]);
  // com busca ativa, mostra o primeiro resultado se o escolhido saiu da lista
  const it = (q.trim() && !list.some((x) => x.id === sel) ? list[0] : LIBRARY.find((x) => x.id === sel)) ?? LIBRARY[0];

  const openExample = (k: LibExample, item: LibItem) => {
    const ex = EXAMPLES[k];
    // o exemplo de abastecimento já vem com a meta (100 UPH); os outros começam com a meta zerada
    if (k === 'supply') useStore.getState().setModel(ex.build(), ex.msg);
    else useStore.getState().openModel(ex.build(), ex.msg);
    if (item.screen) useStore.getState().setAnalysis(item.screen);
    onClose();
  };

  return (
    <Modal title="💡 Biblioteca de soluções" sub="As dúvidas mais comuns, com passo a passo em imagens e um exemplo pronto para abrir." onClose={onClose} wide>
      <div className="lib">
        <nav className="lib-list" aria-label="Dúvidas">
          <div className="lib-searchbox">
            <span aria-hidden>🔍</span>
            <input className="lib-search" placeholder="Palavra-chave: AMR, Yamazumi, API, takt…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar por palavra-chave" autoFocus />
            {q && <button className="lib-clear" onClick={() => setQ('')} aria-label="Limpar busca">×</button>}
          </div>
          <small className="muted">{q.trim() ? `${list.length} de ${LIBRARY.length} respostas` : `${LIBRARY.length} respostas`}</small>
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
