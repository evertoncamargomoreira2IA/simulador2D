// Canvas 2D (Konva): grid, blocos arrastáveis, links, peças animadas, zoom/pan e seleção.

import type Konva from 'konva';
import { isAssembly, variantPatch, type BlockVariant } from '../engine/types';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Circle, Group, Layer, Line, Rect, RegularPolygon, Shape, Stage, Text, Transformer } from 'react-konva';
import type { NodeRt, Simulator } from '../engine/simulator';
import type { Background, LinkDef, NodeDef, NodeType } from '../engine/types';
import { footprint } from '../engine/analytics';
import { distToPoly, pointAt } from '../engine/path';
import { useStore } from '../store';
import { createOperator } from './operators';
import { mixHex, useCanvasColors, type CanvasColors } from './theme';

/** Cor do posto de referência do UPH (diferente dos estados). */
const REF_COLOR = '#8b5cf6';
const W = 64;
const H = 40;
export const DRAG_MIME = 'application/x-sim-node';

/** Blocos do menu de adição rápida (soltar a seta no vazio). */
const QUICK: { type: NodeType | BlockVariant; label: string }[] = [
  { type: 'manual', label: 'Posto manual' },
  { type: 'machine', label: 'Machine' },
  { type: 'assembly', label: 'Montagem' },
  { type: 'buffer', label: 'Buffer' },
  { type: 'inspection', label: 'Inspection' },
  { type: 'rework', label: 'Rework' },
  { type: 'sink', label: 'Finished Goods' },
];

interface View {
  x: number;
  y: number;
  scale: number;
}

export function CanvasView() {
  const wrap = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 0.75 });
  const [plantEdit, setPlantEdit] = useState(false);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number; add?: boolean } | null>(null);
  const colors = useCanvasColors();

  const model = useStore((s) => s.model);
  const sim = useStore((s) => s.sim);
  useStore((s) => s.tick);
  const kpi = useStore((s) => s.kpi);
  const selected = useStore((s) => s.selected);
  const selectedLink = useStore((s) => s.selectedLink);
  const tool = useStore((s) => s.tool);
  const connectFrom = useStore((s) => s.connectFrom);
  const layers = useStore((s) => s.layers);
  const gridSize = useStore((s) => s.gridSize);
  const message = useStore((s) => s.message);
  const run = useStore((s) => s.run);
  const selectedPool = useStore((s) => s.selectedPool);

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Enquadra o modelo ao carregar outro modelo.
  const fitKey = model.name + model.nodes.length + (model.background ? 'bg' : '');
  useEffect(() => fit(), [fitKey, size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Guarda o centro visível para a paleta colocar blocos novos onde o usuário está olhando.
  useEffect(() => {
    useStore.getState().setViewCenter({ x: (size.w / 2 - view.x) / view.scale, y: (size.h / 2 - view.y) / view.scale });
  }, [view, size]);

  function fit() {
    const ns = useStore.getState().model.nodes;
    const el = wrap.current;
    if (!el || ns.length === 0) return;
    const bg = useStore.getState().model.background;
    const xs = ns.map((n) => n.x);
    const ys = ns.map((n) => n.y);
    if (bg) {
      const k = bg.scale ?? 1;
      xs.push(bg.dx ?? 0, (bg.dx ?? 0) + bg.width * k);
      ys.push(bg.dy ?? 0, (bg.dy ?? 0) + bg.height * k);
    }
    for (const z of useStore.getState().model.zones ?? []) xs.push(z.x, z.x + z.w), ys.push(z.y, z.y + z.h);
    const minX = Math.min(...xs) - 80;
    const maxX = Math.max(...xs) + 80;
    const minY = Math.min(...ys) - 80;
    const maxY = Math.max(...ys) + 110;
    const scale = Math.min(1.6, Math.max(0.2, Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY))));
    setView({
      scale,
      x: (el.clientWidth - (maxX - minX) * scale) / 2 - minX * scale,
      y: (el.clientHeight - (maxY - minY) * scale) / 2 - minY * scale,
    });
  }

  // Ligação arrastando: da bolinha do bloco (ou do bloco, no modo Conectar) até o destino.
  // relink: arrastando a ponta (to) ou a origem (from) de uma ligação existente
  const [wire, setWire] = useState<{ from: string; x: number; y: number; moved: boolean; relink?: { id: string; end: 'to' | 'from' } } | null>(null);
  const nodeAt = (x: number, y: number) =>
    useStore.getState().model.nodes.find((n) => Math.abs(n.x - x) <= W / 2 + 6 && Math.abs(n.y - y) <= H / 2 + 6);
  /** Seta mais próxima do ponto (até 14 px da linha). */
  const linkAt = (x: number, y: number) => {
    const m = useStore.getState().model;
    let best: LinkDef | undefined;
    let bestD = 14;
    for (const l of m.links) {
      const a = m.nodes.find((n) => n.id === l.from);
      const b = m.nodes.find((n) => n.id === l.to);
      if (!a || !b) continue;
      const d = distToPoly(arrowPts(a, b, l.path), x, y);
      if (d < bestD) [best, bestD] = [l, d];
    }
    return best;
  };
  /** Operador/veículo solto: no posto vira a equipe do posto, na seta faz o transporte, no vazio só muda o ponto de espera. */
  function dropPool(poolId: string, x: number, y: number) {
    const st = useStore.getState();
    const m = st.model;
    const pool = m.pools?.find((p) => p.id === poolId);
    if (!pool) return;
    const n = nodeAt(x, y);
    if (n && pool.kind === 'operator' && n.type !== 'source' && n.type !== 'sink') {
      st.assignPool(n.id, poolId);
      return;
    }
    const l = n ? undefined : linkAt(x, y);
    if (l) {
      st.updateLink(l.id, { poolId });
      const name = (id: string) => m.nodes.find((k) => k.id === id)?.name ?? id;
      st.setMessage(`"${pool.name}" faz o transporte de ${name(l.from)} para ${name(l.to)}.`);
      return;
    }
    if (n) st.setMessage(`${pool.kind === 'operator' ? 'Entrada e saída não têm operador' : 'Veículo não opera posto'}: solte numa seta para ele fazer o transporte.`);
    st.patchModel({ pools: (m.pools ?? []).map((p) => (p.id === poolId ? { ...p, x: Math.round(x), y: Math.round(y) } : p)) });
  }
  function startWire(from: string) {
    const n = useStore.getState().model.nodes.find((x) => x.id === from);
    if (n) setWire({ from, x: n.x, y: n.y, moved: false });
  }
  function endWire() {
    if (!wire) return;
    const p = stageRef.current!.getPointerPosition();
    const st = useStore.getState();
    const target = p ? nodeAt(toWorld(p.x, p.y).x, toWorld(p.x, p.y).y) : undefined;
    setWire(null);
    if (wire.relink) {
      const l = st.model.links.find((x) => x.id === wire.relink!.id);
      if (!l || !target) return;
      const from = wire.relink.end === 'from' ? target.id : l.from;
      const to = wire.relink.end === 'to' ? target.id : l.to;
      if (from === to || (from === l.from && to === l.to)) return;
      if (st.model.links.some((x) => x.id !== l.id && x.from === from && x.to === to)) return st.setMessage('Essa ligação já existe.');
      if (target.type === (wire.relink.end === 'to' ? 'source' : 'sink')) return st.setMessage(wire.relink.end === 'to' ? 'Um Source só tem saída.' : 'Finished Goods não tem saída.');
      st.updateLink(l.id, { from, to });
      st.setMessage(`Ligação agora vai de ${st.model.nodes.find((n) => n.id === from)?.name} para ${st.model.nodes.find((n) => n.id === to)?.name}.`);
      return;
    }
    if (target && target.id !== wire.from) {
      st.addLink(wire.from, target.id);
      st.setConnectFrom(null);
    } else if (wire.moved && p) {
      // soltou a seta no vazio: menu de adição rápida já ligado
      setQuick({ from: wire.from, sx: p.x, sy: p.y, ...toWorld(p.x, p.y) });
    } else if (!wire.moved && st.tool === 'connect') st.setConnectFrom(wire.from);
  }
  // Menu do botão direito no bloco: detalhes e opções do posto.
  const [menu, setMenu] = useState<{ id: string; sx: number; sy: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [menu]);
  // Adição rápida ao soltar a seta fora de um bloco.
  const [quick, setQuick] = useState<{ from: string; sx: number; sy: number; x: number; y: number } | null>(null);
  function quickAdd(b: (typeof QUICK)[number]['type']) {
    if (!quick) return;
    const variant = b === 'manual' || b === 'assembly' ? b : null;
    const type: NodeType = variant ? 'machine' : (b as NodeType);
    useStore.getState().addAfter(quick.from, type, quick.x + W / 2, quick.y, variant ? variantPatch(variant, 1) : {});
    setQuick(null);
  }

  const toWorld = (px: number, py: number) => ({ x: (px - view.x) / view.scale, y: (py - view.y) / view.scale });

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const p = stageRef.current!.getPointerPosition()!;
    const factor = e.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
    const scale = Math.min(4, Math.max(0.1, view.scale * factor));
    const wx = (p.x - view.x) / view.scale;
    const wy = (p.y - view.y) / view.scale;
    setView({ scale, x: p.x - wx * scale, y: p.y - wy * scale });
  }

  function zoomBy(f: number) {
    const cx = size.w / 2;
    const cy = size.h / 2;
    const scale = Math.min(4, Math.max(0.1, view.scale * f));
    const wx = (cx - view.x) / view.scale;
    const wy = (cy - view.y) / view.scale;
    setView({ scale, x: cx - wx * scale, y: cy - wy * scale });
  }

  // Botão esquerdo no fundo: caixa de seleção (Shift soma à seleção).
  // Botão direito ou do meio (ou Alt + esquerdo): move a tela.
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const banded = useRef(false);
  useEffect(() => {
    const stop = () => (pan.current = null);
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);
  function onStageDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (quick) setQuick(null);
    if (menu) setMenu(null);
    if (e.evt.button === 1 || e.evt.button === 2 || (e.evt.button === 0 && e.evt.altKey)) {
      e.evt.preventDefault();
      pan.current = { sx: e.evt.clientX, sy: e.evt.clientY, vx: view.x, vy: view.y };
      return;
    }
    if (e.target !== e.target.getStage() || e.evt.button !== 0) return;
    const p = stageRef.current!.getPointerPosition()!;
    const w = toWorld(p.x, p.y);
    setBand({ x0: w.x, y0: w.y, x1: w.x, y1: w.y, add: e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey });
  }
  function onStageMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (pan.current) {
      const p = pan.current;
      setView({ ...view, x: p.vx + e.evt.clientX - p.sx, y: p.vy + e.evt.clientY - p.sy });
      return;
    }
    if (wire) {
      const p = stageRef.current!.getPointerPosition()!;
      const w = toWorld(p.x, p.y);
      setWire({ ...wire, x: w.x, y: w.y, moved: true });
      return;
    }
    if (!band) return;
    const p = stageRef.current!.getPointerPosition()!;
    const w = toWorld(p.x, p.y);
    setBand({ ...band, x1: w.x, y1: w.y });
  }
  function onStageUp() {
    if (wire) return endWire();
    if (!band) return;
    const [x0, x1] = [Math.min(band.x0, band.x1), Math.max(band.x0, band.x1)];
    const [y0, y1] = [Math.min(band.y0, band.y1), Math.max(band.y0, band.y1)];
    setBand(null);
    if (x1 - x0 < 3 / view.scale && y1 - y0 < 3 / view.scale) return; // foi um clique: onStageClick limpa a seleção
    const ids = model.nodes.filter((n) => n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1).map((n) => n.id);
    banded.current = true; // o click que vem logo depois não deve limpar a seleção
    const st = useStore.getState();
    st.select(band.add ? [...new Set([...st.selected, ...ids])] : ids);
    if (ids.length > 1) st.setMessage(`${ids.length} blocos selecionados: arraste um deles para mover todos juntos (Delete apaga).`);
  }
  function onStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (banded.current) {
      banded.current = false;
      return;
    }
    if (e.target === e.target.getStage() && !e.evt.shiftKey) {
      useStore.getState().select([]);
      useStore.getState().setConnectFrom(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    const type = e.dataTransfer.getData(DRAG_MIME) as NodeType | BlockVariant | 'operator';
    if (!type) return;
    e.preventDefault();
    const r = wrap.current!.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    if (type === 'operator') {
      // solto em cima de um posto: a equipe já atende esse posto
      createOperator(nodeAt(w.x, w.y), w);
      return;
    }
    const variant = type === 'assembly' || type === 'manual' ? type : null;
    useStore.getState().addNode(variant ? 'machine' : (type as NodeType), w.x, w.y, variant ? variantPatch(variant, 1) : {});
  }

  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes]);
  const productColor = useMemo(() => new Map((model.products ?? []).map((p) => [p.id, p.color])), [model.products]);
  const topIds = kpi.completed > 0 ? kpi.ranking.slice(0, 5).map((r) => r.id) : [];
  const co2ById = useMemo(() => {
    const m = new Map<string, number>();
    if (!layers.co2) return m;
    const fp = footprint(sim, kpi).nodes;
    const max = Math.max(1e-9, ...fp.map((n) => n.co2));
    for (const n of fp) m.set(n.id, n.co2 / max);
    return m;
  }, [layers.co2, kpi, sim]);
  const outCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of model.links) c.set(l.from, (c.get(l.from) ?? 0) + 1);
    return c;
  }, [model.links]);
  const outWeight = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of model.links) c.set(l.from, (c.get(l.from) ?? 0) + Math.max(0, l.weight));
    return c;
  }, [model.links]);
  const maxMoved = Math.max(1, ...sim.links.map((l) => l.moved));
  const movedByLink = new Map(sim.links.map((l) => [l.def.id, l.moved]));

  const draggable = tool === 'select' && run !== 'running';
  const canWire = run !== 'running';

  return (
    <div
      ref={wrap}
      onContextMenu={(e) => e.preventDefault()}
      className={`canvas-wrap${tool === 'connect' ? ' connect' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={false}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) setView({ ...view, x: e.target.x(), y: e.target.y() });
        }}
        onWheel={onWheel}
        onMouseDown={onStageDown}
        onMouseMove={onStageMove}
        onMouseUp={onStageUp}
        onMouseLeave={() => setWire(null)}
        onClick={onStageClick}
        onTap={onStageClick}
      >
        <Layer listening={false}>
          <Rect x={-view.x / view.scale} y={-view.y / view.scale} width={size.w / view.scale} height={size.h / view.scale} fill={colors.canvas} />
          {layers.grid && <Grid view={view} size={size} step={gridSize} colors={colors} />}
        </Layer>
        {model.background && layers.plant && (
          <Layer listening={false}>
            <Plant bg={model.background} line={colors.cad} text={colors.cadText} />
          </Layer>
        )}
        {model.background && plantEdit && (
          <Layer>
            <PlantHandle bg={model.background} color={colors.accent} />
          </Layer>
        )}

        {(model.zones?.length ?? 0) > 0 && (
          <Layer listening={false}>
            {model.zones!.map((z) => (
              <Group key={z.id}>
                <Rect x={z.x} y={z.y} width={z.w} height={z.h} cornerRadius={10} stroke={colors.accent} strokeWidth={1.5} dash={[8, 6]} fill={colors.accent} opacity={0.06} />
                <Rect x={z.x} y={z.y} width={z.w} height={z.h} cornerRadius={10} stroke={colors.accent} strokeWidth={1.5} dash={[8, 6]} opacity={0.7} />
                <Text x={z.x + 12} y={z.y + 10} text={z.name.toUpperCase()} fontSize={14} fontStyle="bold" letterSpacing={1.5} fill={colors.accent} />
              </Group>
            ))}
          </Layer>
        )}

        {layers.links && (
          <Layer>
            {model.links.map((l) => {
              const a = byId.get(l.from);
              const b = byId.get(l.to);
              if (!a || !b) return null;
              const pts = arrowPts(a, b, l.path);
              const mid = pointAt(pts, 0.5);
              const isReturn = a.type === 'rework';
              const isPart = l.role === 'part';
              const byVehicle = !!l.poolId;
              const sel = selectedLink === l.id;
              const moved = movedByLink.get(l.id) ?? 0;
              const heatW = layers.heat ? 1.5 + (moved / maxMoved) * 9 : 1.6;
              const heatC = layers.heat
                ? heatColor(moved / maxMoved)
                : isPart
                  ? colors.accent
                  : byVehicle
                    ? colors.human
                    : colors.muted;
              const multi = (outCount.get(l.from) ?? 0) > 1;
              const share = multi ? Math.max(0, l.weight) / (outWeight.get(l.from) || 1) : 1;
              return (
                <Group key={l.id}>
                  <Arrow
                    points={pts}
                    stroke={sel ? colors.accent : heatC}
                    fill={sel ? colors.accent : heatC}
                    strokeWidth={sel ? Math.max(3, heatW) : heatW}
                    pointerLength={7}
                    pointerWidth={7}
                    dash={isReturn ? [6, 4] : isPart ? [3, 3] : byVehicle ? [10, 4] : undefined}
                    opacity={layers.heat ? 0.85 : isPart ? 0.75 : 1}
                    hitStrokeWidth={12}
                    lineJoin="round"
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (e.evt.ctrlKey || e.evt.metaKey) useStore.getState().ctrlPick({ linkId: l.id });
                      else useStore.getState().select([], l.id);
                    }}
                    onDblClick={(e) => {
                      // duplo clique na seta: editar transporte, peças por viagem e carrinhos
                      e.cancelBubble = true;
                      useStore.getState().setTransportFor({ linkId: l.id, poolId: l.poolId });
                    }}
                  />
                  {sel && !wire && (
                    <>
                      {(['from', 'to'] as const).map((end) => (
                        <Circle
                          key={end}
                          x={end === 'to' ? pts[pts.length - 2] : pts[0]}
                          y={end === 'to' ? pts[pts.length - 1] : pts[1]}
                          radius={7}
                          fill={colors.canvas}
                          stroke={colors.accent}
                          strokeWidth={2.5}
                          hitStrokeWidth={10}
                          onMouseEnter={(e) => {
                            const c = e.target.getStage()?.container();
                            if (c) c.style.cursor = 'grab';
                          }}
                          onMouseLeave={(e) => {
                            const c = e.target.getStage()?.container();
                            if (c) c.style.cursor = '';
                          }}
                          onMouseDown={(e) => {
                            e.cancelBubble = true;
                            setWire({ from: l.from, x: end === 'to' ? b.x : a.x, y: end === 'to' ? b.y : a.y, moved: false, relink: { id: l.id, end } });
                          }}
                        />
                      ))}
                      <PathHandles link={l} pts={pts} colors={colors} />
                    </>
                  )}
                  {!!l.length && layers.labels && (
                    <Text
                      x={mid.x - 60}
                      y={mid.y + 6}
                      width={120}
                      align="center"
                      text={`${l.length} m`}
                      fontSize={12}
                      fontStyle="bold"
                      fill={byVehicle ? colors.human : colors.muted}
                      listening={false}
                    />
                  )}
                  {multi && layers.labels && (
                    <Text
                      x={mid.x + 4}
                      y={mid.y - 14}
                      text={`${Math.round(share * 100)}%`}
                      fontSize={11}
                      fill={colors.muted}
                      listening={false}
                    />
                  )}
                </Group>
              );
            })}
          </Layer>
        )}

        <Layer>
          {sim.nodes.map((rt) => {
            const n = byId.get(rt.def.id) ?? rt.def;
            return (
              <NodeShape
                key={n.id}
                def={n}
                rt={rt}
                colors={colors}
                selected={selected.includes(n.id) || connectFrom === n.id}
                bottleneck={kpi.bottleneckId === n.id && kpi.completed > 0}
                reference={model.refStation === n.id}
                draggable={draggable}
                labels={layers.labels}
                people={layers.people}
                counts={layers.counts}
                now={sim.now}
                topRank={layers.top5 ? topIds.indexOf(n.id) + 1 : 0}
                co2Heat={layers.co2 ? (co2ById.get(n.id) ?? 0) : 0}
                dim={layers.top5 && kpi.completed > 0 && !topIds.includes(n.id)}
                assembly={isAssembly(n, model.links)}
                stage={stageRef}
                onWire={canWire && n.type !== 'sink' ? () => startWire(n.id) : undefined}
                wireTarget={!!wire && wire.moved && wire.from !== n.id}
                onMenu={(cx, cy) => {
                  const r = wrap.current?.getBoundingClientRect();
                  if (!r) return;
                  setQuick(null);
                  useStore.getState().select([n.id]);
                  setMenu({ id: n.id, sx: cx - r.left, sy: cy - r.top });
                }}
                onSelect={(add) => {
                  const st = useStore.getState();
                  if (st.pendingPool && n.type !== 'source' && n.type !== 'sink') {
                    st.assignPool(n.id, st.pendingPool);
                    return;
                  }
                  if (st.tool === 'connect') {
                    if (st.connectFrom && st.connectFrom !== n.id) {
                      st.addLink(st.connectFrom, n.id);
                      st.setConnectFrom(null);
                    } else if (n.type !== 'sink') startWire(n.id);
                    return;
                  }
                  if (add) st.select(st.selected.includes(n.id) ? st.selected.filter((i) => i !== n.id) : [...st.selected, n.id]);
                  else if (!st.selected.includes(n.id)) st.select([n.id]);
                }}
              />
            );
          })}
        </Layer>

        {layers.links && (
          <Layer listening={false}>
            {/* carrinhos/bins de cada item atrás do posto (transporte com viagem de várias peças) */}
            {sim.nodes.flatMap((rt) => {
              const binned = rt.inLinks.filter((l) => sim.binCap(l) > 0);
              const n = byId.get(rt.def.id);
              if (!binned.length || !n) return [];
              return binned.map((l, i) => {
                const cap = sim.binCap(l);
                const have = sim.binHave(l);
                const bw = 46;
                const x = n.x - W / 2 - bw - 8;
                const y = n.y - (binned.length * 18) / 2 + i * 18;
                const f = Math.min(1, have / cap);
                return (
                  <Group key={`bin${l.def.id}`} x={x} y={y}>
                    <Rect width={bw} height={14} cornerRadius={3} fill={colors.canvas} stroke={colors.human} strokeWidth={1.2} />
                    <Rect width={bw * f} height={14} cornerRadius={3} fill={colors.human} opacity={0.35} />
                    <Text width={bw} y={2} align="center" text={`${have}/${cap}`} fontSize={9} fontStyle="bold" fill={colors.ink} />
                    {layers.labels && <Text x={-84} width={80} y={2} align="right" wrap="none" ellipsis text={l.from.def.name} fontSize={9} fill={colors.muted} />}
                  </Group>
                );
              });
            })}
          </Layer>
        )}

        {wire?.moved && (
          <Layer listening={false}>
            {(() => {
              const rl = wire.relink ? model.links.find((x) => x.id === wire.relink!.id) : undefined;
              if (rl && wire.relink!.end === 'from') {
                const b = byId.get(rl.to);
                const t = nodeAt(wire.x, wire.y);
                if (!b) return null;
                const ok = t && t.id !== rl.to;
                return (
                  <Arrow
                    points={[ok ? t.x + W / 2 : wire.x, ok ? t.y : wire.y, b.x - W / 2 - 4, b.y]}
                    stroke={colors.accent}
                    fill={colors.accent}
                    strokeWidth={2.5}
                    dash={ok ? undefined : [8, 5]}
                    pointerLength={10}
                    pointerWidth={10}
                  />
                );
              }
              const a = model.nodes.find((x) => x.id === wire.from);
              const t = nodeAt(wire.x, wire.y);
              if (!a) return null;
              const ok = t && t.id !== wire.from;
              return (
                <Arrow
                  points={[a.x + W / 2, a.y, ok ? t.x - W / 2 - 4 : wire.x, ok ? t.y : wire.y]}
                  stroke={colors.accent}
                  fill={colors.accent}
                  strokeWidth={2.5}
                  dash={ok ? undefined : [8, 5]}
                  pointerLength={10}
                  pointerWidth={10}
                />
              );
            })()}
          </Layer>
        )}

        {layers.people && sim.pools.length > 0 && (
          <Layer listening={draggable}>
            <Units sim={sim} colors={colors} labels={layers.labels} draggable={draggable} onDrop={dropPool} selectedPool={selectedPool} />
          </Layer>
        )}

        {layers.entities && (
          <Layer listening={false}>
            {/* peças do mix na cor do modelo */}
            {[...sim.transits].filter((t) => !t.unit).map((t) => {
              const a = t.link.from.def;
              const b = t.link.to.def;
              const span = t.end - t.start;
              const f = span > 0 ? Math.min(1, Math.max(0, (sim.now - t.start) / span)) : 1;
              const { x, y } = pointAt(arrowPts(a, b, t.link.def.path), f);
              if (t.entity.qty > 1) return <Load key={t.entity.id} x={x} y={y} qty={t.entity.qty} colors={colors} />;
              return (
                <Circle
                  key={t.entity.id}
                  x={x}
                  y={y}
                  radius={5}
                  fill={t.entity.reworks > 0 ? colors.state.blocked : (t.entity.product && productColor.get(t.entity.product)) || colors.transport}
                  stroke={colors.raised}
                  strokeWidth={1.5}
                />
              );
            })}
          </Layer>
        )}

        {band && (
          <Layer listening={false}>
            <Rect
              x={Math.min(band.x0, band.x1)}
              y={Math.min(band.y0, band.y1)}
              width={Math.abs(band.x1 - band.x0)}
              height={Math.abs(band.y1 - band.y0)}
              stroke={colors.accent}
              dash={[4, 4]}
              fill={colors.accent}
              opacity={0.12}
            />
          </Layer>
        )}
      </Stage>
      {menu && <NodeMenu {...menu} onClose={() => setMenu(null)} onAdd={(from, x, y) => setQuick({ from, sx: menu.sx, sy: menu.sy, x, y })} />}
      {quick && (
        <div
          className="quick-add"
          style={{ left: quick.sx, top: quick.sy }}
          role="menu"
          aria-label="Adicionar bloco ligado"
          ref={(el) => {
            // cabe inteiro na área do layout: sobe ou vai para a esquerda quando encosta no painel de baixo ou da direita
            const box = el?.parentElement;
            if (!el || !box) return;
            const pad = 8;
            const h = Math.min(el.scrollHeight, box.clientHeight - 2 * pad);
            el.style.maxHeight = `${h}px`;
            el.style.top = `${Math.max(pad, Math.min(quick.sy, box.clientHeight - h - pad))}px`;
            el.style.left = `${Math.max(pad, Math.min(quick.sx, box.clientWidth - el.offsetWidth - pad))}px`;
          }}
        >
          <p className="label">Adicionar ligado</p>
          {QUICK.map((q) => (
            <button key={q.type} role="menuitem" className="btn" onClick={() => quickAdd(q.type)}>
              {q.label}
            </button>
          ))}
          <button className="btn ghost" onClick={() => setQuick(null)}>Cancelar</button>
        </div>
      )}
      <div className="zoom">
        <button className="btn" onClick={() => zoomBy(1.2)} aria-label="Aproximar">+</button>
        <button className="btn" onClick={() => zoomBy(1 / 1.2)} aria-label="Afastar">−</button>
        <button className="btn" onClick={fit}>Enquadrar</button>
        {model.background && (
          <button
            className={`btn${plantEdit ? ' on' : ''}`}
            onClick={() => {
              setPlantEdit(!plantEdit);
              useStore.getState().setMessage(plantEdit ? 'Planta travada.' : 'Ajustar planta: puxe os cantos para aumentar ou diminuir e arraste para posicionar. Clique de novo para travar.');
            }}
            title="Aumentar, diminuir e mover a planta de fundo direto no layout"
          >
            {plantEdit ? 'Travar planta' : 'Ajustar planta'}
          </button>
        )}
      </div>
      <div className="toast">
        {tool === 'connect'
          ? connectFrom
            ? 'Conectar: agora clique no bloco de destino.'
            : 'Conectar: arraste de um bloco até o outro (ou clique na origem e depois no destino).'
          : message}
      </div>
    </div>
  );
}

function Grid({ view, size, step, colors }: { view: View; size: { w: number; h: number }; step: number; colors: CanvasColors }) {
  return (
    <Shape
      sceneFunc={(ctx) => {
        const x0 = -view.x / view.scale;
        const y0 = -view.y / view.scale;
        const x1 = x0 + size.w / view.scale;
        const y1 = y0 + size.h / view.scale;
        const s = view.scale < 0.4 ? step * 5 : step;
        const c = ctx._context;
        c.lineWidth = 1 / view.scale;
        for (let x = Math.floor(x0 / s) * s; x <= x1; x += s) {
          c.strokeStyle = Math.round(x / s) % 5 === 0 ? colors.gridMajor : colors.grid;
          c.beginPath();
          c.moveTo(x, y0);
          c.lineTo(x, y1);
          c.stroke();
        }
        for (let y = Math.floor(y0 / s) * s; y <= y1; y += s) {
          c.strokeStyle = Math.round(y / s) % 5 === 0 ? colors.gridMajor : colors.grid;
          c.beginPath();
          c.moveTo(x0, y);
          c.lineTo(x1, y);
          c.stroke();
        }
      }}
    />
  );
}

interface NodeShapeProps {
  def: NodeDef;
  rt: NodeRt;
  colors: CanvasColors;
  counts?: boolean;
  selected: boolean;
  bottleneck: boolean;
  /** Posto de referência do UPH. */
  reference?: boolean;
  draggable: boolean;
  labels: boolean;
  stage: React.RefObject<Konva.Stage | null>;
  onSelect: (add: boolean) => void;
  people: boolean;
  now: number;
  /** Posição no top 5 de gargalos (0 = fora ou camada desligada). */
  topRank: number;
  /** Fração do CO2e do maior emissor (0..1) para o mapa de calor. */
  co2Heat: number;
  dim: boolean;
  assembly: boolean;
  /** Começa uma ligação arrastando a bolinha do bloco. */
  onWire?: () => void;
  /** Botão direito: menu do posto (posição na tela). */
  onMenu?: (clientX: number, clientY: number) => void;
  /** Destaque de bloco que recebe a seta sendo arrastada. */
  wireTarget: boolean;
}

/** Posição do grupo de bonecos e se eles ficam lado a lado (horizontal) ou empilhados. */
function crewPlace(def: NodeDef, labels: boolean): { x: number; y: number; row: boolean } {
  if (def.crewOffset) return { ...def.crewOffset, row: true };
  switch (def.crewSide) {
    case 'bottom':
      return { x: 0, y: H / 2 + (labels ? 26 : 13), row: true };
    case 'left':
      return { x: -W / 2 - 14, y: 0, row: false };
    case 'right':
      return { x: W / 2 + 14, y: 0, row: false };
    default:
      return { x: 0, y: -H / 2 - 13, row: true };
  }
}

function NodeShape({ def, rt, colors, selected, bottleneck, reference, draggable, labels, counts, stage, onSelect, people, now, topRank, co2Heat, dim, assembly, onWire, wireTarget, onMenu }: NodeShapeProps) {
  const [hover, setHover] = useState(false);
  const stateColor = colors.state[rt.state];
  const stroke = selected ? colors.accent : stateColor;
  const sw = selected ? 3 : 2;
  const startRef = useRef<{ x: number; y: number; others: { id: string; x: number; y: number }[] } | null>(null);
  const fill = mixHex(stateColor, colors.raised, 0.24);
  const q = rt.queue.length + rt.reserved;
  const inProc = rt.processing.length + rt.done.length;
  const isBuffer = def.type === 'buffer';
  const cap = Math.max(1, def.capacity);
  const batch = Math.round(def.batchSize ?? 0);
  let queuedUnits = 0;
  for (const e of rt.queue) queuedUnits += e.qty;
  const crew = Math.min(3, Math.max(0, Math.round(def.operators)));
  const showCrew = crew > 0 && !def.poolId && !def.area && people && def.type !== 'source' && def.type !== 'sink' && def.type !== 'buffer';

  return (
    <Group
      id={def.id}
      x={def.x}
      y={def.y}
      opacity={dim ? 0.35 : 1}
      draggable={draggable}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(false);
      }}
      onDblClick={(e) => {
        e.cancelBubble = true;
        linkNearest(def.id);
      }}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        e.cancelBubble = true;
        onMenu?.(e.evt.clientX, e.evt.clientY);
      }}
      onDblTap={(e) => {
        e.cancelBubble = true;
        useStore.getState().setDetail(def.id);
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        const st = useStore.getState();
        const others = st.selected
          .filter((id) => id !== def.id)
          .map((id) => st.model.nodes.find((n) => n.id === id))
          .filter((n): n is NodeDef => !!n)
          .map((n) => ({ id: n.id, x: n.x, y: n.y }));
        startRef.current = { x: def.x, y: def.y, others };
      }}
      onDragMove={(e) => {
        e.cancelBubble = true;
        const s = startRef.current;
        if (!s) return;
        const dx = e.target.x() - s.x;
        const dy = e.target.y() - s.y;
        for (const o of s.others) stage.current?.findOne((k: Konva.Node) => k.id() === o.id)?.position({ x: o.x + dx, y: o.y + dy });
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        const s = startRef.current;
        if (!s) return;
        const dx = e.target.x() - s.x;
        const dy = e.target.y() - s.y;
        startRef.current = null;
        useStore.getState().moveNodes([def.id, ...s.others.map((o) => o.id)], dx, dy);
      }}
    >
      {def.area && rt.slots.length > 1 && (
        <Slots def={def} rt={rt} colors={colors} />
      )}
      {co2Heat > 0 && <Circle radius={22 + co2Heat * 40} fill={colors.state.down} opacity={0.1 + co2Heat * 0.35} listening={false} />}
      {topRank > 0 && (
        <Group listening={false}>
          <Rect x={-W / 2 - 9} y={-H / 2 - 9} width={W + 18} height={H + 18} cornerRadius={9} stroke={topRank === 1 ? colors.state.down : colors.state.blocked} strokeWidth={3} />
          <Circle x={-W / 2 - 4} y={-H / 2 - 4} radius={11} fill={topRank === 1 ? colors.state.down : colors.state.blocked} />
          <Text x={-W / 2 - 15} y={-H / 2 - 10} width={22} align="center" text={String(topRank)} fontSize={13} fontStyle="bold" fill={colors.canvas} />
        </Group>
      )}
      {reference && (
        <Group listening={false}>
          <Rect x={-W / 2 - 11} y={-H / 2 - 11} width={W + 22} height={H + 22} cornerRadius={10} stroke={REF_COLOR} strokeWidth={3} />
          <Rect x={W / 2 - 18} y={-H / 2 - 20} width={30} height={14} cornerRadius={4} fill={REF_COLOR} />
          <Text x={W / 2 - 18} y={-H / 2 - 18} width={30} align="center" text="REF" fontSize={10} fontStyle="bold" fill="#fff" />
        </Group>
      )}
      {bottleneck && (
        <Rect x={-W / 2 - 7} y={-H / 2 - 7} width={W + 14} height={H + 14} cornerRadius={8} stroke={colors.state.down} strokeWidth={2} dash={[5, 3]} />
      )}
      <Body type={def.type} fill={fill} stroke={stroke} sw={sw} />
      {isBuffer && (
        <Rect
          x={-W / 2 + 5}
          y={H / 2 - 10}
          width={(W - 10) * Math.min(1, (q + inProc) / cap)}
          height={5}
          fill={stateColor}
          listening={false}
        />
      )}
      <Text
        x={-W / 2}
        y={-7}
        width={W}
        align="center"
        text={assembly ? 'MT' : def.manual ? 'MN' : glyph(def.type)}
        fontSize={13}
        fontStyle="bold"
        fill={colors.ink}
        listening={false}
      />
      {/* peças em processo */}
      {!isBuffer &&
        def.type !== 'source' &&
        def.type !== 'sink' &&
        Array.from({ length: Math.min(inProc, 4) }).map((_, i) => (
          <Circle key={i} x={W / 2 - 8 - i * 9} y={-H / 2 + 8} radius={3.5} fill={rt.done.length > i ? colors.state.blocked : colors.transport} listening={false} />
        ))}
      {/* fila de entrada */}
      {Array.from({ length: Math.min(q, 6) }).map((_, i) => (
        <Rect key={i} x={-W / 2 - 9} y={H / 2 - 8 - i * 7} width={6} height={5} fill={colors.muted} listening={false} />
      ))}
      {showCrew && (() => {
        const pl = crewPlace(def, labels);
        return (
        <Group
          x={pl.x}
          y={pl.y}
          draggable={draggable}
          onMouseDown={(e) => {
            e.cancelBubble = true;
          }}
          onDragStart={(e) => {
            e.cancelBubble = true;
          }}
          onDragMove={(e) => {
            e.cancelBubble = true;
          }}
          onDragEnd={(e) => {
            e.cancelBubble = true;
            const g = e.target;
            useStore.getState().updateNode(def.id, { crewOffset: { x: Math.round(g.x()), y: Math.round(g.y()) } });
          }}
          onMouseEnter={(e) => {
            const c = e.target.getStage()?.container();
            if (c && draggable) c.style.cursor = 'move';
          }}
          onMouseLeave={(e) => {
            const c = e.target.getStage()?.container();
            if (c) c.style.cursor = '';
          }}
        >
          <Rect x={-crew * 8 - 4} y={-12} width={crew * 16 + 8} height={24} fill="transparent" />
          {Array.from({ length: crew }).map((_, i) => (
            <Group key={i} x={pl.row ? (i - (crew - 1) / 2) * 15 : 0} y={pl.row ? 0 : (i - (crew - 1) / 2) * 18}>
              <Person
                color={rt.state === 'working' ? colors.human : mixHex(colors.human, colors.muted, 0.6)}
                outline={colors.canvas}
                phase={rt.state === 'working' ? now + i * 1.7 + def.x * 0.01 : 0}
              />
            </Group>
          ))}
        </Group>
        );
      })()}
      {batch > 1 && (
        <Group listening={false}>
          <Rect x={-W / 2} y={H / 2 - 7} width={W} height={4} fill={colors.line} />
          <Rect x={-W / 2} y={H / 2 - 7} width={W * Math.min(1, queuedUnits / batch)} height={4} fill={colors.accent} />
          <Text x={W / 2 + 4} y={-6} text={`${queuedUnits}/${batch}`} fontSize={11} fontStyle="bold" fill={colors.accent} />
        </Group>
      )}
      {labels && (
        <>
          <Text x={-50} y={H / 2 + 5} width={100} align="center" text={def.name} fontSize={11} fill={colors.ink} listening={false} wrap="none" ellipsis />
          {(def.type === 'sink' || def.type === 'source') && (
            <Text x={-50} y={-H / 2 - 16} width={100} align="center" text={String(def.type === 'sink' ? rt.processed : rt.released)} fontSize={12} fontStyle="bold" fill={colors.muted} listening={false} />
          )}
        </>
      )}
      {counts && def.type !== 'source' && def.type !== 'sink' && (
        <Text
          x={-60}
          y={H / 2 + (labels ? 18 : 5)}
          width={120}
          align="center"
          text={isBuffer ? `${q + inProc}/${cap} peças` : `fila ${q} · fazendo ${rt.processing.length}/${cap}${rt.done.length ? ` · pronta ${rt.done.length}` : ''}`}
          fontSize={10}
          fontStyle="bold"
          fill={colors.accent}
          listening={false}
        />
      )}
      {wireTarget && <Rect x={-W / 2 - 5} y={-H / 2 - 5} width={W + 10} height={H + 10} cornerRadius={8} stroke={colors.accent} strokeWidth={2} dash={[5, 4]} listening={false} />}
      {onWire && (hover || selected) && (
        <Group
          x={W / 2 + 9}
          y={0}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            onWire();
          }}
          onMouseEnter={(e) => {
            const c = e.target.getStage()?.container();
            if (c) c.style.cursor = 'crosshair';
          }}
          onMouseLeave={(e) => {
            const c = e.target.getStage()?.container();
            if (c) c.style.cursor = '';
          }}
        >
          <Circle radius={11} fill="transparent" />
          <Circle radius={6.5} fill={colors.accent} stroke={colors.raised} strokeWidth={1.5} />
          <Line points={[-2.5, 0, 2.5, 0]} stroke={colors.raised} strokeWidth={1.6} />
          <Line points={[0.5, -2.5, 3, 0, 0.5, 2.5]} stroke={colors.raised} strokeWidth={1.6} />
        </Group>
      )}
    </Group>
  );
}

function Slots({ def, rt, colors }: { def: NodeDef; rt: NodeRt; colors: CanvasColors }) {
  const a = def.area!;
  const doneSlots = new Set(rt.done.map((e) => e.slot));
  const n = rt.slots.length;
  const rows = a.h >= 30 ? 2 : 1;
  const cols = Math.ceil(n / rows);
  const sw = Math.max(6, Math.min(22, a.w / cols - 4));
  const sh = Math.max(6, Math.min(16, rows === 2 ? a.h / 2 - 6 : a.h - 8));
  return (
    <Group listening={false}>
      <Rect x={-a.w / 2 - 6} y={-a.h / 2 - sh / 2 - 6} width={a.w + 12} height={a.h + sh + 12} cornerRadius={6} stroke={colors.accent} strokeWidth={1} dash={[4, 4]} opacity={0.55} />
      {rt.slots.map((p, i) => {
        const busy = rt.slotBusy[i];
        const c = !busy ? colors.line : doneSlots.has(i) ? colors.state.blocked : colors.state.working;
        return (
          <Rect
            key={i}
            x={p.x - def.x - sw / 2}
            y={p.y - def.y - sh / 2}
            width={sw}
            height={sh}
            cornerRadius={2}
            fill={busy ? mixHex(c, colors.raised, 0.55) : colors.raised}
            stroke={c}
            strokeWidth={1}
          />
        );
      })}
    </Group>
  );
}

/** Planta do DXF: um único Shape desenhado direto no canvas (milhares de linhas). */
const images = new Map<string, HTMLImageElement>();

const Plant = memo(function Plant({ bg, line, text }: { bg: Background; line: string; text: string }) {
  const [, loaded] = useState(0);
  let img = bg.image ? images.get(bg.image) : undefined;
  if (bg.image && !img) {
    img = new Image();
    img.onload = () => loaded((x) => x + 1);
    img.src = bg.image;
    images.clear();
    images.set(bg.image, img);
  }
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        const c = ctx._context;
        c.save();
        c.translate(bg.dx ?? 0, bg.dy ?? 0);
        c.scale(bg.scale ?? 1, bg.scale ?? 1);
        c.globalAlpha = bg.opacity ?? (bg.image ? 0.55 : 1);
        if (img?.complete && img.naturalWidth) c.drawImage(img, 0, 0, bg.width, bg.height);
        c.strokeStyle = line;
        c.lineWidth = 1.25 / (bg.scale ?? 1);
        c.beginPath();
        for (const p of bg.paths) {
          c.moveTo(p[0], p[1]);
          for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
        }
        for (const [x, y, r] of bg.circles) {
          c.moveTo(x + r, y);
          c.arc(x, y, r, 0, Math.PI * 2);
        }
        c.stroke();
        c.fillStyle = text;
        c.textBaseline = 'bottom';
        for (const t of bg.texts) {
          const h = Math.max(4, t.h);
          c.font = `${h}px system-ui, sans-serif`;
          if (t.r) {
            c.save();
            c.translate(t.x, t.y);
            c.rotate((t.r * Math.PI) / 180);
            c.fillText(t.t, 0, 0);
            c.restore();
          } else c.fillText(t.t, t.x, t.y);
        }
        c.restore();
      }}
    />
  );
});

/** Operadores (círculos) e veículos (retângulos) nas posições atuais. */
function Units({ sim, colors, labels, draggable, onDrop, selectedPool }: { sim: Simulator; colors: CanvasColors; labels: boolean; draggable: boolean; onDrop: (poolId: string, x: number, y: number) => void; selectedPool: string | null }) {
  const carrying = new Map<string, number>();
  for (const t of sim.transits) if (t.unit) carrying.set(t.unit.id, t.entity.qty);
  return (
    <>
      {sim.pools.flatMap((p) =>
        p.units.map((u, i) => {
          const pos = sim.positionOf(u, sim.now);
          const c = u.busy ? colors.human : mixHex(colors.human, colors.muted, 0.5);
          const drag = {
            draggable,
            onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
              const g = e.target;
              const [x, y] = [g.x(), g.y()];
              g.position(pos);
              onDrop(p.def.id, x, y);
            },
            onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
              const c = e.target.getStage()?.container();
              if (c && draggable) c.style.cursor = 'grab';
            },
            onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
              const c = e.target.getStage()?.container();
              if (c) c.style.cursor = '';
            },
            onDblClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
              // duplo clique no operador/veículo: abre o vínculo do trecho que ele atende
              e.cancelBubble = true;
              const st = useStore.getState();
              const l = st.model.links.find((x) => x.poolId === p.def.id);
              st.setTransportFor({ linkId: l?.id, poolId: p.def.id });
            },
            onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true;
              if (e.evt.ctrlKey || e.evt.metaKey) useStore.getState().ctrlPick({ poolId: p.def.id });
              else {
                useStore.getState().selectPool(p.def.id);
                useStore.getState().setMessage(`"${p.def.name}" selecionado: edite ou apague no painel da direita (Delete apaga). Arraste até um posto ou seta, ou Ctrl+clique nele e na seta para o vínculo.`);
              }
            },
          };
          if (p.def.kind === 'operator')
            return (
              <Group key={u.id} x={pos.x} y={pos.y} {...drag}>
                <Rect x={-10} y={-11} width={20} height={22} fill="transparent" />
                {selectedPool === p.def.id && <Circle radius={15} stroke={colors.accent} strokeWidth={2.5} dash={[4, 3]} />}
                <Person color={c} outline={colors.canvas} phase={u.busy ? sim.now + i : 0} scale={1.3} />
                {labels && <Text x={-12} y={12} width={24} align="center" text={`${i + 1}`} fontSize={9} fill={colors.human} />}
              </Group>
            );
          const qty = carrying.get(u.id) ?? 0;
          return (
            <Group key={u.id} x={pos.x} y={pos.y} {...drag}>
              {selectedPool === p.def.id && <Rect x={-18} y={-13} width={36} height={26} cornerRadius={5} stroke={colors.accent} strokeWidth={2.5} dash={[4, 3]} />}
              <Rect x={-13} y={-8} width={26} height={16} cornerRadius={3} fill={c} stroke={colors.canvas} strokeWidth={2} />
              {p.def.kind === 'forklift' && <Rect x={13} y={-6} width={7} height={2.5} fill={c} />}
              {p.def.kind === 'forklift' && <Rect x={13} y={3.5} width={7} height={2.5} fill={c} />}
              {u.loaded && <Rect x={-7} y={-5} width={14} height={10} fill={colors.transport} />}
              {qty > 1 && <Text x={-20} y={10} width={40} align="center" text={`${qty} pç`} fontSize={10} fontStyle="bold" fill={colors.human} />}
              {labels && <Text x={-30} y={-21} width={60} align="center" text={p.def.kind === 'agv' ? 'AGV' : p.def.kind === 'amr' ? 'AMR' : 'Empilh.'} fontSize={9} fill={colors.muted} />}
            </Group>
          );
        }),
      )}
    </>
  );
}

/** Bonequinho: cabeça e tronco; balança levemente enquanto trabalha. */
function Person({ color, outline, phase, scale = 1 }: { color: string; outline: string; phase: number; scale?: number }) {
  const bob = phase ? Math.sin(phase * 2.2) * 1.2 : 0;
  const arm = phase ? Math.sin(phase * 3.1) * 2.5 : 0;
  return (
    <Group scaleX={scale} scaleY={scale} y={bob}>
      <Rect x={-5} y={-1} width={10} height={9} cornerRadius={[5, 5, 2, 2]} fill={color} stroke={outline} strokeWidth={1} />
      <Line points={[-5, 1, -8, 6 + arm]} stroke={color} strokeWidth={2} lineCap="round" />
      <Line points={[5, 1, 8, 6 - arm]} stroke={color} strokeWidth={2} lineCap="round" />
      <Circle y={-5} radius={3.6} fill={color} stroke={outline} strokeWidth={1} />
    </Group>
  );
}

/** Carga (carrinho ou pallet) em transporte, com a quantidade. */
function Load({ x, y, qty, colors }: { x: number; y: number; qty: number; colors: CanvasColors }) {
  return (
    <Group x={x} y={y}>
      <Rect x={-11} y={-8} width={22} height={16} cornerRadius={2} fill={colors.transport} stroke={colors.raised} strokeWidth={1.5} />
      <Text x={-11} y={-5} width={22} align="center" text={String(qty)} fontSize={10} fontStyle="bold" fill={colors.raised} />
    </Group>
  );
}

function Body({ type, fill, stroke, sw }: { type: NodeType; fill: string; stroke: string; sw: number }) {
  switch (type) {
    case 'source':
      return <RegularPolygon sides={5} radius={H / 2 + 6} rotation={90} fill={fill} stroke={stroke} strokeWidth={sw} />;
    case 'sink':
      return (
        <>
          <Rect x={-W / 2} y={-H / 2} width={W} height={H} fill={fill} stroke={stroke} strokeWidth={sw} />
          <Rect x={-W / 2 + 4} y={-H / 2 + 4} width={W - 8} height={H - 8} stroke={stroke} strokeWidth={1} listening={false} />
        </>
      );
    case 'inspection':
      return <RegularPolygon sides={6} radius={H / 2 + 6} fill={fill} stroke={stroke} strokeWidth={sw} />;
    case 'rework':
      return <Rect x={-W / 2} y={-H / 2} width={W} height={H} cornerRadius={4} fill={fill} stroke={stroke} strokeWidth={sw} dash={[5, 3]} />;
    case 'buffer':
      return <Line points={[-W / 2, -H / 2, -W / 2, H / 2, W / 2, H / 2, W / 2, -H / 2]} closed={false} fill={fill} stroke={stroke} strokeWidth={sw} />;
    default:
      return <Rect x={-W / 2} y={-H / 2} width={W} height={H} cornerRadius={4} fill={fill} stroke={stroke} strokeWidth={sw} />;
  }
}

function glyph(t: NodeType): string {
  return { source: 'ENT', machine: 'M', buffer: 'BUF', inspection: 'QC', rework: 'RW', sink: 'FG' }[t];
}

/** Pontos de um link, saindo da borda do bloco de origem até a borda do destino. */
/**
 * Seta rápida (duplo clique no bloco): liga ao bloco mais próximo que ainda não recebe dele,
 * preferindo os que ainda não têm entrada. Sem candidato, abre os indicadores do posto.
 */
export function linkNearest(id: string) {
  const st = useStore.getState();
  const m = st.model;
  const a = m.nodes.find((n) => n.id === id);
  if (!a) return;
  if (a.type === 'sink') return st.setDetail(id);
  const fed = new Set(m.links.map((l) => l.to));
  let best: (typeof m.nodes)[number] | undefined;
  let bestD = Infinity;
  for (const n of m.nodes) {
    if (n.id === id || n.type === 'source' || m.links.some((l) => (l.from === id && l.to === n.id) || (l.from === n.id && l.to === id))) continue;
    const d = Math.hypot(n.x - a.x, n.y - a.y) * (fed.has(n.id) ? 3 : 1);
    if (d < bestD) (best = n), (bestD = d);
  }
  if (!best) return st.setDetail(id);
  st.addLink(id, best.id);
  st.select([best.id]);
  st.setMessage(`Seta de "${a.name}" para "${best.name}". Duplo clique de novo em "${best.name}" para seguir a linha (Ctrl+Z desfaz).`);
}

/** Pontos de curva da seta selecionada: arrastar move, duplo clique apaga; o ＋ no meio de cada trecho cria um ponto novo. */
function PathHandles({ link, pts, colors }: { link: LinkDef; pts: number[]; colors: CanvasColors }) {
  const path = link.path ?? [];
  const snapPt = (x: number, y: number) => {
    const st = useStore.getState();
    const g = st.gridSize / 2;
    return st.snap ? { x: Math.round(x / g) * g, y: Math.round(y / g) * g } : { x: Math.round(x), y: Math.round(y) };
  };
  const save = (p: { x: number; y: number }[]) => useStore.getState().updateLink(link.id, { path: p.length ? p : undefined });
  const cursor = (e: Konva.KonvaEventObject<MouseEvent>, c: string) => {
    const el = e.target.getStage()?.container();
    if (el) el.style.cursor = c;
  };
  const mids: { x: number; y: number; at: number }[] = [];
  for (let k = 0; k + 3 < pts.length; k += 2) mids.push({ x: (pts[k] + pts[k + 2]) / 2, y: (pts[k + 1] + pts[k + 3]) / 2, at: k / 2 });
  return (
    <>
      {mids.map((m) => (
        <Group
          key={`mid${m.at}-${path.length}-${m.x},${m.y}`}
          x={m.x}
          y={m.y}
          draggable
          onMouseDown={(e) => (e.cancelBubble = true)}
          onMouseEnter={(e) => cursor(e, 'grab')}
          onMouseLeave={(e) => cursor(e, '')}
          onDragEnd={(e) => {
            const p = [...path];
            p.splice(m.at, 0, snapPt(e.target.x(), e.target.y()));
            e.target.position(m);
            save(p);
          }}
        >
          <Circle radius={7} fill={colors.canvas} stroke={colors.accent} strokeWidth={1.5} dash={[2, 2]} hitStrokeWidth={8} />
          <Text x={-4} y={-6} text="+" fontSize={12} fontStyle="bold" fill={colors.accent} listening={false} />
        </Group>
      ))}
      {path.map((p, i) => (
        <Circle
          key={`wp${i}-${p.x},${p.y}`}
          x={p.x}
          y={p.y}
          radius={6}
          fill={colors.accent}
          stroke={colors.canvas}
          strokeWidth={2}
          hitStrokeWidth={10}
          draggable
          onMouseDown={(e) => (e.cancelBubble = true)}
          onMouseEnter={(e) => cursor(e, 'grab')}
          onMouseLeave={(e) => cursor(e, '')}
          onDragEnd={(e) => save(path.map((q, j) => (j === i ? snapPt(e.target.x(), e.target.y()) : q)))}
          onDblClick={(e) => {
            e.cancelBubble = true;
            save(path.filter((_, j) => j !== i));
          }}
        />
      ))}
    </>
  );
}

/** Pontos da seta: sai da borda de a, passa pelos pontos de curva e chega na borda de b. */
function arrowPts(a: { x: number; y: number }, b: { x: number; y: number }, path?: { x: number; y: number }[]): number[] {
  if (!path?.length) return edgePoints(a, b);
  const s = edgePoints(a, path[0]);
  const e = edgePoints(path[path.length - 1], b);
  return [s[0], s[1], ...path.flatMap((p) => [p.x, p.y]), e[2], e[3]];
}

function edgePoints(a: { x: number; y: number }, b: { x: number; y: number }): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cut = (ux: number, uy: number) => {
    const tx = Math.abs(ux) > 1e-6 ? (W / 2 + 4) / Math.abs(ux) : Infinity;
    const ty = Math.abs(uy) > 1e-6 ? (H / 2 + 4) / Math.abs(uy) : Infinity;
    return Math.min(tx, ty);
  };
  const ux = dx / len;
  const uy = dy / len;
  const c = Math.min(cut(ux, uy), len / 2 - 1);
  return [a.x + ux * c, a.y + uy * c, b.x - ux * c, b.y - uy * c];
}

function heatColor(f: number): string {
  // azul (pouco fluxo) → amarelo → vermelho (muito fluxo)
  const h = 220 - 220 * Math.min(1, Math.max(0, f));
  return `hsl(${h}, 80%, 50%)`;
}


/** Moldura da planta no modo "Ajustar planta": arrastar move, cantos mudam o tamanho (proporção fixa). */
function PlantHandle({ bg, color }: { bg: Background; color: string }) {
  const g = useRef<Konva.Group>(null);
  const tr = useRef<Konva.Transformer>(null);
  useEffect(() => {
    if (g.current && tr.current) {
      tr.current.nodes([g.current]);
      tr.current.getLayer()?.batchDraw();
    }
  }, [bg]);
  const k = bg.scale ?? 1;
  const commit = () => {
    const node = g.current;
    if (!node) return;
    const scale = Math.min(20, Math.max(0.02, node.scaleX()));
    useStore.getState().patchModel({ background: { ...bg, scale, dx: node.x(), dy: node.y() } });
  };
  return (
    <>
      <Group
        ref={g}
        x={bg.dx ?? 0}
        y={bg.dy ?? 0}
        scaleX={k}
        scaleY={k}
        draggable
        onMouseDown={(e) => (e.cancelBubble = true)}
        onDragEnd={commit}
        onTransformEnd={commit}
        onMouseEnter={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = 'move';
        }}
        onMouseLeave={(e) => {
          const c = e.target.getStage()?.container();
          if (c) c.style.cursor = '';
        }}
      >
        <Rect width={bg.width} height={bg.height} fill={color} opacity={0.06} stroke={color} strokeWidth={2} dash={[10, 6]} strokeScaleEnabled={false} />
      </Group>
      <Transformer
        ref={tr}
        rotateEnabled={false}
        keepRatio
        enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
        anchorSize={12}
        anchorStroke={color}
        borderStroke={color}
        flipEnabled={false}
        boundBoxFunc={(oldB, newB) => (newB.width < 20 || newB.height < 20 ? oldB : newB)}
      />
    </>
  );
}

/** Menu do botão direito no bloco: o que dá para ver e fazer com o posto. */
function NodeMenu({ id, sx, sy, onClose, onAdd }: { id: string; sx: number; sy: number; onClose: () => void; onAdd: (from: string, x: number, y: number) => void }) {
  const st = useStore.getState();
  const n = useStore((s) => s.model.nodes.find((x) => x.id === id));
  const isRef = useStore((s) => s.model.refStation === id);
  if (!n) return null;
  const station = n.type === 'machine' || n.type === 'inspection' || n.type === 'rework';
  const go = (f: () => void) => () => {
    f();
    onClose();
  };
  const items: [string, () => void, boolean?][] = [
    ['📊 Detalhes do posto (todos os indicadores)', () => st.setDetail(id)],
    ['✏️ Propriedades (painel da direita)', () => st.setMessage(`"${n.name}" selecionado: edite tempo, gigas, operadores e falhas no painel da direita.`)],
    ['🧩 Operações e atividades', () => st.setOpsFor(id), !station],
    ['📐 Yamazumi da linha', () => st.setAnalysis('yamazumi'), !station],
    ['⏱ Dados reais (tempo medido)', () => st.setAnalysis('coleta'), !station],
    ['📈 Curva do tempo (ajustar)', () => st.setFitFor(id), !station],
    ['🎨 Mix de modelos', () => st.setShowMix(true), !station],
    [isRef ? '☆ Tirar como posto de referência do UPH' : '⭐ Usar como posto de referência do UPH', () => st.setRefStation(isRef ? undefined : id), !station],
    ['➕ Adicionar bloco ligado depois', () => onAdd(id, n.x + 120, n.y), n.type === 'sink'],
    ['🗑 Apagar', () => st.deleteSelection()],
  ];
  return (
    <div
      className="quick-add node-menu"
      style={{ left: sx, top: sy }}
      role="menu"
      aria-label={`Opções de ${n.name}`}
      onContextMenu={(e) => e.preventDefault()}
      ref={(el) => {
        // cabe inteiro na área do layout
        const box = el?.parentElement;
        if (!el || !box) return;
        const pad = 8;
        el.style.top = `${Math.max(pad, Math.min(sy, box.clientHeight - el.offsetHeight - pad))}px`;
        el.style.left = `${Math.max(pad, Math.min(sx, box.clientWidth - el.offsetWidth - pad))}px`;
      }}
    >
      <p className="label">{n.name}</p>
      {items
        .filter(([, , hide]) => !hide)
        .map(([label, f]) => (
          <button key={label} role="menuitem" className="btn" onClick={go(f)}>
            {label}
          </button>
        ))}
    </div>
  );
}
