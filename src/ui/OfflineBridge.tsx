// Ponte do arquivo offline para o projeto online.
// O arquivo offline não consegue gravar no banco do claude.ai (o navegador não deixa), então o
// 🔗 Projeto online copia o modelo para a área de transferência (e baixa o JSON de reserva).
// No online, Ctrl+V em qualquer lugar (ou 📋 Colar do offline) pergunta se quer importar.

import { useEffect, useState } from 'react';
import type { Model } from '../engine/types';
import { exportModelJson } from '../io/exporter';
import { useStore } from '../store';
import { Modal } from './Modal';

const TAG = 'sim2dModelo';
type Packet = { [TAG]: 1; enviadoEm: number; model: Model };

const plain = (m: Model): Model => ({ ...m, settings: { ...m.settings, replay: undefined, replayPrev: undefined } });

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    // reserva para navegador sem permissão: copia por uma caixa de texto escondida
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Offline → online: copia o modelo e baixa o JSON (se a cópia falhar, o arquivo resolve). */
export async function sendToOnline(m: Model): Promise<void> {
  const ok = await copyText(JSON.stringify({ [TAG]: 1, enviadoEm: Date.now(), model: plain(m) } satisfies Packet));
  void exportModelJson(m);
  useStore
    .getState()
    .setMessage(
      ok
        ? '🔗 Modelo copiado! No link online que abriu, aperte Ctrl+V em qualquer lugar e confirme "Importar". (O JSON também foi baixado, de reserva.)'
        : '🔗 Não consegui copiar: no link online, use Importar e escolha o JSON que acabou de baixar.',
    );
}

/** Lê um texto colado: devolve o modelo se veio do 🔗 do offline (ou se é um JSON de modelo). */
export function parsePasted(t: string): { model: Model; enviadoEm?: number } | null {
  if (!t || t.length < 20 || !/^\s*\{/.test(t)) return null;
  try {
    const o = JSON.parse(t) as Partial<Packet> & Partial<Model>;
    if (o[TAG] && o.model && Array.isArray(o.model.nodes)) return { model: o.model, enviadoEm: o.enviadoEm };
    if (Array.isArray(o.nodes) && Array.isArray(o.links) && o.settings) return { model: o as Model };
  } catch {
    /* não é modelo */
  }
  return null;
}

/** Online: pergunta se importa o modelo colado (Ctrl+V) que veio do offline. */
export function PasteImport() {
  const [got, setGot] = useState<{ model: Model; enviadoEm?: number } | null>(null);
  useEffect(() => {
    const on = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const p = parsePasted(e.clipboardData?.getData('text') ?? '');
      if (!p) return;
      e.preventDefault();
      setGot(p);
    };
    const ask = (e: Event) => setGot((e as CustomEvent<{ model: Model; enviadoEm?: number }>).detail);
    window.addEventListener('paste', on);
    window.addEventListener('sim2d-pasted', ask);
    return () => {
      window.removeEventListener('paste', on);
      window.removeEventListener('sim2d-pasted', ask);
    };
  }, []);
  if (!got) return null;
  const m = got.model;
  const postos = m.nodes.filter((n) => n.type === 'machine' || n.type === 'inspection' || n.type === 'rework').length;
  return (
    <Modal title="📥 Importar o modelo que veio do offline?" sub="O modelo atual desta tela é trocado por ele (dá para desfazer com Ctrl+Z)." onClose={() => setGot(null)}>
      <p>
        <b>{m.name}</b> · {postos} postos · {m.links.length} ligações · takt {m.settings.takt} s
        {got.enviadoEm ? ` · enviado às ${new Date(got.enviadoEm).toLocaleTimeString('pt-BR')}` : ''}
      </p>
      <div className="row-btns">
        <button
          className="btn primary"
          onClick={() => {
            const st = useStore.getState();
            st.setRun('idle');
            st.setModel(m, `📥 "${m.name}" importado do arquivo offline: as duas versões estão iguais agora. Salve para guardar na conta.`);
            st.setShowStart(false);
            setGot(null);
          }}
        >
          Importar e abrir
        </button>
        <button className="btn" onClick={() => setGot(null)}>Agora não</button>
      </div>
    </Modal>
  );
}

/** Botão do início: tenta ler a área de transferência; se o navegador não deixar, orienta o Ctrl+V. */
export async function pasteFromClipboard(): Promise<void> {
  try {
    const p = parsePasted(await navigator.clipboard.readText());
    if (p) {
      window.dispatchEvent(new CustomEvent('sim2d-pasted', { detail: p }));
      return;
    }
    useStore.getState().setMessage('A área de transferência não tem um modelo. No arquivo offline, clique em 🔗 Projeto online antes.');
  } catch {
    useStore.getState().setMessage('O navegador não deixou ler a área de transferência: aperte Ctrl+V aqui na tela.');
  }
}
