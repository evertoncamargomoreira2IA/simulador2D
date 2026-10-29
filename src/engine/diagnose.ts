// Diagnóstico de trava: acha o bloco que não anda por causa de configuração e diz o que fazer.
// Dois níveis: erros de configuração do modelo (antes de rodar) e peças paradas durante a simulação.

import type { LinkDef, Model, NodeDef, PoolDef } from './types';
import type { Simulator, StuckFact } from './simulator';

export interface FixAction {
  label: string;
  node?: { id: string; patch: Partial<NodeDef> };
  link?: { id: string; patch: Partial<LinkDef> };
  pool?: { id: string; patch: Partial<PoolDef> };
  addLink?: { from: string; to: string };
}

export interface Issue {
  /** chave estável para não repetir o mesmo aviso */
  key: string;
  nodeId?: string;
  linkId?: string;
  title: string;
  why: string;
  fix: string;
  action?: FixAction;
}

const nameOf = (m: Model, id: string) => m.nodes.find((n) => n.id === id)?.name ?? id;
const poolName = (m: Model, id: string) => m.pools?.find((p) => p.id === id)?.name ?? id;

/** Erros de configuração que travam a linha antes mesmo de rodar. */
export function staticIssues(m: Model): Issue[] {
  const out: Issue[] = [];
  const pools = new Map((m.pools ?? []).map((p) => [p.id, p]));
  const usedPool = (id: string, where: string, nodeId?: string, linkId?: string) => {
    const p = pools.get(id);
    if (!p) {
      out.push({
        key: `nopool:${nodeId ?? linkId}`,
        nodeId,
        linkId,
        title: `${where} usa um recurso que não existe mais`,
        why: 'O operador ou veículo foi apagado, mas o vínculo ficou. Ninguém vai atender.',
        fix: 'Tire o vínculo ou vincule outro recurso.',
        action: nodeId ? { label: 'Tirar o vínculo', node: { id: nodeId, patch: { poolId: undefined } } } : { label: 'Voltar para esteira', link: { id: linkId!, patch: { poolId: undefined, tripQty: undefined } } },
      });
    } else if (Math.round(p.count) < 1) {
      out.push({
        key: `zero:${p.id}`,
        nodeId,
        linkId,
        title: `${p.name} está com quantidade 0`,
        why: `${where} depende de ${p.name}, mas não há nenhuma unidade. A peça fica esperando para sempre.`,
        fix: 'Coloque pelo menos 1 na quantidade do recurso.',
        action: { label: 'Colocar 1 unidade', pool: { id: p.id, patch: { count: 1 } } },
      });
    }
  };
  for (const n of m.nodes) {
    const ins = m.links.filter((l) => l.to === n.id);
    const outs = m.links.filter((l) => l.from === n.id);
    if (n.type === 'source' && outs.length === 0)
      out.push({ key: `srcout:${n.id}`, nodeId: n.id, title: `${n.name} não está ligado a nada`, why: 'O material não tem para onde ir, então nenhuma peça entra na linha.', fix: 'Use Conectar (ou arraste a bolinha do bloco) até o primeiro posto.' });
    if (n.type !== 'source' && n.type !== 'sink' && ins.length === 0 && outs.length > 0) {
      const src = m.nodes.find((x) => x.type === 'source');
      out.push({
        key: `noin:${n.id}`,
        nodeId: n.id,
        title: `${n.name} não recebe material`,
        why: `Nenhuma seta chega em ${n.name}, então ele nunca produz. Quem depende dele (${outs.map((l) => nameOf(m, l.to)).join(', ')}) fica esperando.`,
        fix: src ? `Ligue ${src.name} (ou o posto anterior) a ${n.name}. Se ele não faz parte do fluxo, apague o bloco.` : `Ligue um bloco de entrada a ${n.name}, ou apague o bloco.`,
        // se ele entrega a Principal de uma montagem, a correção certa vem no aviso da montagem
        action: src && !outs.some((l) => m.links.some((x) => x.to === l.to && x.role === 'part')) ? { label: `Ligar ${src.name} → ${n.name}`, addLink: { from: src.id, to: n.id } } : undefined,
      });
    }
    if (n.poolId) usedPool(n.poolId, n.name, n.id);
    const parts = ins.filter((l) => l.role === 'part');
    if (parts.length && parts.length === ins.length)
      out.push({
        key: `nomain:${n.id}`,
        nodeId: n.id,
        title: `${n.name} só recebe componentes, sem entrada Principal`,
        why: 'Na montagem, a entrada Principal é a peça que vira o produto. Sem ela o posto junta componentes e nunca começa.',
        fix: 'No painel do posto, em Combinar peças, marque uma entrada como Principal.',
        action: { label: `Tornar ${nameOf(m, parts[0].from)} a Principal`, link: { id: parts[0].id, patch: { role: undefined, partQty: undefined } } },
      });
  }
  for (const l of m.links) if (l.poolId) usedPool(l.poolId, `O trecho ${nameOf(m, l.from)} → ${nameOf(m, l.to)}`, undefined, l.id);

  // alguma fonte chega ao produto acabado?
  const sinks = new Set(m.nodes.filter((n) => n.type === 'sink').map((n) => n.id));
  const reach = new Set<string>();
  const stack = m.nodes.filter((n) => n.type === 'source').map((n) => n.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    for (const l of m.links) if (l.from === id) stack.push(l.to);
  }
  if (m.nodes.some((n) => n.type === 'source') && ![...sinks].some((s) => reach.has(s)))
    out.push({ key: 'nosink', title: 'A linha não chega ao produto acabado', why: 'Nenhum caminho sai do material e chega num bloco Finished Goods. A produção fica sempre zero.', fix: 'Coloque um Finished Goods no fim e ligue o último posto a ele.' });
  return out;
}

/** Quanto tempo sem entregar peça conta como linha travada (s de simulação). */
export function stallWindow(m: Model): number {
  const cycles = m.nodes.filter((n) => n.type !== 'source' && n.type !== 'sink').map((n) => n.cycleTime || 0);
  const sum = cycles.reduce((a, b) => a + b, 0);
  return Math.max(900, 2 * sum, 20 * Math.max(0, ...cycles));
}

function factIssue(m: Model, f: StuckFact): Issue {
  const n = nameOf(m, f.node);
  switch (f.kind) {
    case 'parts':
      return {
        key: `parts:${f.link}`,
        nodeId: f.node,
        linkId: f.link,
        title: `${n} está esperando componente de ${nameOf(m, f.from)}`,
        why: `A montagem precisa de ${f.need} peça(s) de ${nameOf(m, f.from)} por produto e tem ${f.have}. O produto chegou, mas o componente não vem.`,
        fix: `Confira se ${nameOf(m, f.from)} recebe material e está produzindo. Se essa peça não é consumida na montagem, mude a entrada para Principal.`,
        action: { label: 'Mudar para Principal', link: { id: f.link, patch: { role: undefined, partQty: undefined } } },
      };
    case 'batch':
      return {
        key: `batch:${f.node}`,
        nodeId: f.node,
        title: `${n} espera juntar ${f.need} peças e só tem ${f.have}`,
        why: `O campo "Agrupar N peças" do posto está em ${f.need}: ele só começa com o lote completo, e não chegam mais peças.`,
        fix: 'Zere o Agrupar N peças (ou diminua). Para levar várias peças de uma vez, use Peças por viagem no vínculo de transporte.',
        action: { label: 'Tirar o agrupamento', node: { id: f.node, patch: { batchSize: undefined } } },
      };
    case 'noUnits':
      return {
        key: `units:${f.pool}`,
        nodeId: f.node,
        linkId: f.link,
        title: `${poolName(m, f.pool)} não tem nenhuma unidade`,
        why: `${n} precisa de ${poolName(m, f.pool)}, mas a quantidade é 0.`,
        fix: 'Coloque pelo menos 1 na quantidade do recurso.',
        action: { label: 'Colocar 1 unidade', pool: { id: f.pool, patch: { count: 1 } } },
      };
    case 'noMain':
      return {
        key: `nomain:${f.node}`,
        nodeId: f.node,
        title: `${n} só recebe componentes, sem entrada Principal`,
        why: 'Sem a entrada Principal o posto nunca começa.',
        fix: 'Em Combinar peças, marque uma entrada como Principal.',
      };
    case 'waitMain':
      return {
        key: `waitmain:${f.node}`,
        nodeId: f.node,
        title: `${n} tem componente, mas o produto não chega de ${f.from.map((x) => nameOf(m, x)).join(' / ')}`,
        why: `Em Combinar peças, ${nameOf(m, f.partFrom)} entra como Componente e ${f.from.map((x) => nameOf(m, x)).join(' / ')} como Principal (a peça que vira o produto). Os componentes chegaram, mas a Principal não vem, então o posto não começa. Aumentar a fila não resolve.`,
        fix: `Confira se ${f.from.map((x) => nameOf(m, x)).join(' / ')} recebe material. Se o produto entra por ${nameOf(m, f.partFrom)}, mude essa entrada para Principal.`,
        action: { label: `Tornar ${nameOf(m, f.partFrom)} a Principal`, link: { id: f.part, patch: { role: undefined, partQty: undefined } } },
      };
    case 'trip':
      return {
        key: `trip:${f.link}`,
        nodeId: f.node,
        linkId: f.link,
        title: `${n} espera completar a viagem de ${f.need} peças (tem ${f.have})`,
        why: 'O transporte só sai com a viagem cheia, e não chegam mais peças para completar.',
        fix: 'Diminua as Peças por viagem no vínculo (ou deixe 1).',
        action: { label: 'Levar 1 peça por viagem', link: { id: f.link, patch: { tripQty: undefined } } },
      };
    case 'full':
      return {
        key: `full:${f.link}`,
        nodeId: f.to,
        linkId: f.link,
        title: `${nameOf(m, f.to)} está cheio e não recebe de ${n}`,
        why: `A fila de entrada de ${nameOf(m, f.to)} não tem lugar e ele não está andando.`,
        fix: `Aumente a Fila de entrada de ${nameOf(m, f.to)} ou veja por que ele não processa.`,
        action: { label: 'Fila de entrada +2', node: { id: f.to, patch: { queueCap: (m.nodes.find((x) => x.id === f.to)?.queueCap ?? 0) + 2 } } },
      };
  }
}

/** Peças paradas por configuração durante a simulação. Vazio se a linha está andando. */
export function stallIssues(m: Model, sim: Simulator): Issue[] {
  const quiet = sim.now - sim.lastOutputAt > stallWindow(m);
  if (!sim.deadlocked && !(quiet && sim.wip > 0)) return [];
  const facts = sim.stuckFacts();
  // "destino cheio" é consequência quando o próprio destino também está parado (segue a cadeia até a causa)
  const own = new Set(facts.map((f) => f.node));
  const roots = facts.filter((f) => f.kind !== 'full' || !own.has(f.to)).sort((a, b) => Number(a.kind === 'full') - Number(b.kind === 'full'));
  const issues = roots.map((f) => factIssue(m, f)).filter((x, i, a) => a.findIndex((y) => y.key === x.key) === i);
  if (!issues.length && sim.deadlocked)
    issues.push({ key: 'deadlock', title: 'Nada está andando na linha', why: 'Há peças na linha, mas nenhum posto trabalha e nenhum recurso se mexe.', fix: 'Ligue a camada Números e procure o posto com fila parada. Confira os vínculos de transporte e as filas de entrada.' });
  return issues;
}
