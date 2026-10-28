// Salvar o modelo e abrir os modelos salvos.

import { useEffect, useState } from 'react';
import { fallBackToBrowser, modelStore, newSaveId, type SavedMeta } from '../io/storage';
import { download } from '../io/exporter';
import { useStore } from '../store';
import { Modal } from './Modal';

const WHERE = { conta: 'na sua conta', navegador: 'neste navegador' } as const;

/** Salva o modelo aberto. Sobrescreve o salvo que está aberto, ou cria um novo com `asNew`. */
export async function saveCurrent(asNew = false, name?: string): Promise<boolean> {
  const st = useStore.getState();
  const model = name && name !== st.model.name ? { ...st.model, name } : st.model;
  const id = !asNew && st.saved ? st.saved.id : newSaveId();
  let store = await modelStore();
  try {
    await store.save(id, model);
  } catch (e) {
    if (store.where !== 'conta') {
      st.setMessage(`Não foi possível salvar: ${(e as Error).message}.`);
      return false;
    }
    // Sem permissão de gravar na conta (ex.: acesso só de leitura): guarda no navegador.
    fallBackToBrowser();
    store = await modelStore();
    try {
      await store.save(id, model);
    } catch (e2) {
      st.setMessage(`Não foi possível salvar: ${(e2 as Error).message}.`);
      return false;
    }
  }
  if (model !== st.model) useStore.setState({ model });
  st.setSaved({ id, model });
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  st.setMessage(`"${model.name}" salvo ${WHERE[store.where]} às ${hora}.`);
  return true;
}

/** Abre um modelo salvo e marca como o salvo aberto. */
export async function openSaved(m: SavedMeta): Promise<boolean> {
  const store = await modelStore();
  const loaded = await store.load(m.id).catch(() => null);
  const st = useStore.getState();
  if (!loaded) {
    st.setMessage(`Não consegui abrir "${m.nome}".`);
    return false;
  }
  st.setModel(loaded, `"${m.nome}" aberto (salvo em ${new Date(m.atualizado).toLocaleString('pt-BR')}).`);
  st.setSaved({ id: m.id, model: useStore.getState().model });
  return true;
}

/** Baixa o trabalho aberto como arquivo .json (abre de volta em Importar). */
export async function downloadCurrent(): Promise<void> {
  const m = useStore.getState().model;
  const file = `${m.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'modelo'}.sim2d.json`;
  if (!(await download(file, JSON.stringify(m), 'application/json'))) return;
  useStore.getState().setMessage(`Arquivo "${file}" gerado. Para abrir depois: Importar → escolha o arquivo.`);
}

/** Campo da barra com os 10 últimos trabalhos salvos. */
export function RecentSelect() {
  const saved = useStore((s) => s.saved);
  const [list, setList] = useState<SavedMeta[]>([]);
  const load = async () => {
    try {
      setList((await (await modelStore()).list()).slice(0, 10));
    } catch {
      setList([]);
    }
  };
  useEffect(() => {
    load();
  }, [saved?.id, saved?.model]);
  return (
    <select
      className="btn recent"
      aria-label="Trabalhos recentes"
      title="Os 10 últimos trabalhos salvos"
      value=""
      onFocus={load}
      onMouseDown={load}
      onChange={(e) => {
        const m = list.find((x) => x.id === e.target.value);
        if (m) openSaved(m);
      }}
    >
      <option value="" disabled>Recentes…</option>
      {list.length === 0 && <option disabled>Nenhum trabalho salvo ainda</option>}
      {list.map((m) => (
        <option key={m.id} value={m.id}>
          {saved?.id === m.id ? '● ' : ''}{m.nome} · {new Date(m.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
        </option>
      ))}
    </select>
  );
}

export function SavedModels({ onClose }: { onClose: () => void }) {
  const model = useStore((s) => s.model);
  const saved = useStore((s) => s.saved);
  const [list, setList] = useState<SavedMeta[] | null>(null);
  const [where, setWhere] = useState<'conta' | 'navegador'>('navegador');
  const [name, setName] = useState(model.name);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const refresh = async () => {
    const store = await modelStore();
    setWhere(store.where);
    try {
      setList(await store.list());
    } catch {
      setList([]);
    }
  };
  useEffect(() => {
    refresh();
  }, []);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const open = (m: SavedMeta) =>
    run(async () => {
      if (await openSaved(m)) onClose();
    });

  const remove = (m: SavedMeta) =>
    run(async () => {
      const store = await modelStore();
      await store.remove(m.id).catch(() => undefined);
      setConfirm(null);
      if (useStore.getState().saved?.id === m.id) useStore.getState().setSaved(null);
    });

  return (
    <Modal
      title="Modelos salvos"
      sub={where === 'conta' ? 'Salvos na sua conta: abrem em qualquer computador, só você vê.' : 'Salvos neste navegador. Para levar para outro computador, use Baixar arquivo e depois Importar.'}
      onClose={onClose}
    >
      <div className="save-row">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do modelo" placeholder="Nome do modelo" />
        <button className="btn primary" disabled={busy || !name.trim() || !saved} onClick={() => run(() => saveCurrent(false, name.trim()))} title={saved ? 'Grava por cima do modelo salvo que está aberto' : 'Este modelo ainda não foi salvo'}>
          Salvar
        </button>
        <button className="btn" disabled={busy || !name.trim()} onClick={() => run(() => saveCurrent(true, name.trim()))}>
          Salvar como novo
        </button>
        <button className="btn" disabled={busy} onClick={() => downloadCurrent()} title="Guarda uma cópia no seu computador; abre de volta em Importar">
          Baixar arquivo
        </button>
      </div>
      {list === null ? (
        <p className="hint section">Carregando…</p>
      ) : list.length === 0 ? (
        <p className="hint section">Nenhum modelo salvo ainda.</p>
      ) : (
        <ul className="saved section">
          {list.map((m) => (
            <li key={m.id} className={saved?.id === m.id ? 'on' : ''}>
              <div>
                <b>{m.nome}</b>
                <p className="sub">
                  {m.blocos} blocos · {new Date(m.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {saved?.id === m.id ? ' · aberto agora' : ''}
                </p>
              </div>
              {confirm === m.id ? (
                <>
                  <button className="btn danger" disabled={busy} onClick={() => remove(m)}>Apagar mesmo</button>
                  <button className="btn" onClick={() => setConfirm(null)}>Cancelar</button>
                </>
              ) : (
                <>
                  <button className="btn" disabled={busy} onClick={() => open(m)}>Abrir</button>
                  <button className="btn" disabled={busy} onClick={() => setConfirm(m.id)} aria-label={`Apagar ${m.nome}`}>Apagar</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
