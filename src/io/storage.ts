// Modelos salvos. Dentro do artefato do claude.ai ficam na conta de quem usa
// (banco do artefato, área privada de cada pessoa); fora dele, ou sem permissão
// de escrita, ficam no navegador.

import type { Model } from '../engine/types';

export interface SavedMeta {
  id: string;
  nome: string;
  atualizado: number;
  blocos: number;
}

export interface ModelStore {
  /** 'conta' = salvo na conta (abre em qualquer computador); 'navegador' = só neste navegador. */
  where: 'conta' | 'navegador';
  list(): Promise<SavedMeta[]>;
  load(id: string): Promise<Model | null>;
  save(id: string, model: Model): Promise<SavedMeta>;
  remove(id: string): Promise<void>;
}

// O banco aceita até 256 KiB por documento: o JSON do modelo (com a planta DXF) vai em partes.
const PART = 180_000;

interface DocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(d: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
interface DbLike {
  doc(path: string): DocRef;
  collection(path: string): { get(): Promise<{ docs: { id: string; data(): Record<string, unknown> | undefined }[] }> };
}
interface Host {
  use?: (name: string) => Promise<unknown>;
}

export function newSaveId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const meta = (id: string, model: Model): SavedMeta => ({ id, nome: model.name, atualizado: Date.now(), blocos: model.nodes.length });

function split(json: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < json.length; i += PART) parts.push(json.slice(i, i + PART));
  return parts.length ? parts : [''];
}

export function dbStore(db: DbLike, uid: string): ModelStore {
  const base = `data/users/${uid}`;
  const doc = (id: string) => db.doc(`${base}/${id}`);
  return {
    where: 'conta',
    async list() {
      const snap = await db.collection(base).get();
      return snap.docs
        .map((d) => d.data())
        .filter((d): d is Record<string, unknown> => !!d && d.tipo === 'modelo')
        .map((d) => ({ id: String(d.id), nome: String(d.nome), atualizado: Number(d.atualizado), blocos: Number(d.blocos) }))
        .sort((a, b) => b.atualizado - a.atualizado);
    },
    async load(id) {
      const head = await doc(id).get();
      const h = head.data();
      if (!head.exists || !h) return null;
      const n = Number(h.partes) || 1;
      let json = String(h.json ?? '');
      for (let i = 1; i < n; i++) {
        const p = await doc(`${id}-p${i}`).get();
        json += String(p.data()?.json ?? '');
      }
      return JSON.parse(json) as Model;
    },
    async save(id, model) {
      const parts = split(JSON.stringify(model));
      const old = await doc(id).get();
      const oldN = Number(old.data()?.partes) || 1;
      for (let i = 1; i < parts.length; i++) await doc(`${id}-p${i}`).set({ tipo: 'parte', json: parts[i] });
      const m = meta(id, model);
      await doc(id).set({ tipo: 'modelo', ...m, partes: parts.length, json: parts[0] });
      for (let i = parts.length; i < oldN; i++) await doc(`${id}-p${i}`).delete();
      return m;
    },
    async remove(id) {
      const h = await doc(id).get();
      const n = Number(h.data()?.partes) || 1;
      await doc(id).delete();
      for (let i = 1; i < n; i++) await doc(`${id}-p${i}`).delete();
    },
  };
}

const LS_INDEX = 'sim2d.salvos';
const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch (e) {
    throw new Error(`o navegador não deixou gravar (${(e as Error).name === 'QuotaExceededError' ? 'sem espaço' : 'bloqueado'})`);
  }
};

export const browserStore: ModelStore = {
  where: 'navegador',
  async list() {
    try {
      return (JSON.parse(lsGet(LS_INDEX) ?? '[]') as SavedMeta[]).sort((a, b) => b.atualizado - a.atualizado);
    } catch {
      return [];
    }
  },
  async load(id) {
    const s = lsGet(`sim2d.modelo.${id}`);
    return s ? (JSON.parse(s) as Model) : null;
  },
  async save(id, model) {
    lsSet(`sim2d.modelo.${id}`, JSON.stringify(model));
    const m = meta(id, model);
    const list = (await this.list()).filter((x) => x.id !== id);
    lsSet(LS_INDEX, JSON.stringify([m, ...list]));
    return m;
  },
  async remove(id) {
    lsSet(`sim2d.modelo.${id}`, null);
    lsSet(LS_INDEX, JSON.stringify((await this.list()).filter((x) => x.id !== id)));
  },
};

let cached: Promise<ModelStore> | null = null;

/** Escolhe onde salvar: conta (banco do artefato) quando disponível, senão o navegador. */
export function modelStore(): Promise<ModelStore> {
  if (!cached) {
    cached = (async () => {
      const host = (window as unknown as { claude?: Host }).claude;
      if (!host?.use) return browserStore;
      try {
        const [db, user] = (await Promise.all([host.use('db'), host.use('user')])) as [DbLike | null, { id(): Promise<string | null> } | null];
        const uid = db && user ? await user.id() : null;
        return db && uid ? dbStore(db, uid) : browserStore;
      } catch {
        return browserStore;
      }
    })();
  }
  return cached;
}

/** Usado quando a conta recusa a gravação (ex.: quem só tem acesso de leitura): passa a usar o navegador. */
export function fallBackToBrowser(): void {
  cached = Promise.resolve(browserStore);
}
