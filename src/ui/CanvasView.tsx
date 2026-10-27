// Canvas 2D (Konva): grid, blocos arrastáveis, links, peças animadas, zoom/pan e seleção.

import type Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Circle, Group, Layer, Line, Rect, RegularPolygon, Shape, Stage, Text } from 'react-konva';
import type { NodeRt } from '../engine/simulator';
import type { NodeDef, NodeType } from '../engine/types';
import { useStore } from '../store';
import { mixHex, useCanvasColors, type CanvasColors } from './theme';

const W = 64;
const H = 40;
export const DRAG_MIME = 'application/x-sim-node';

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
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
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

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Enquadra o modelo ao carregar outro modelo.
  const fitKey = model.name + model.nodes.length;
  useEffect(() => fit(), [fitKey, size.w > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  function fit() {
    const ns = useStore.getState().model.nodes;
    const el = wrap.current;
    if (!el || ns.length === 0) return;
    const xs = ns.map((n) => n.x);
    const ys = ns.map((n) => n.y);
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

  // Seleção por retângulo com Shift + arrastar no fundo; arrastar sem Shift faz pan.
  function onStageDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (e.target !== e.target.getStage()) return;
    if (e.evt.shiftKey) {
      const p = stageRef.current!.getPointerPosition()!;
      const w = toWorld(p.x, p.y);
      setBand({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
    }
  }
  function onStageMove() {
    if (!band) return;
    const p = stageRef.current!.getPointerPosition()!;
    const w = toWorld(p.x, p.y);
    setBand({ ...band, x1: w.x, y1: w.y });
  }
  function onStageUp() {
    if (!band) return;
    const [x0, x1] = [Math.min(band.x0, band.x1), Math.max(band.x0, band.x1)];
    const [y0, y1] = [Math.min(band.y0, band.y1), Math.max(band.y0, band.y1)];
    const ids = model.nodes.filter((n) => n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1).map((n) => n.id);
    useStore.getState().select(ids);
    setBand(null);
  }
  function onStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (e.target === e.target.getStage() && !e.evt.shiftKey) {
      useStore.getState().select([]);
      useStore.getState().setConnectFrom(null);
    }
  }

  function onDrop(e: React.DragEvent) {
    const type = e.dataTransfer.getData(DRAG_MIME) as NodeType;
    if (!type) return;
    e.preventDefault();
    const r = wrap.current!.getBoundingClientRect();
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    useStore.getState().addNode(type, w.x, w.y);
  }

  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model.nodes]);
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

  return (
    <div
      ref={wrap}
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
        draggable={!band}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) setView({ ...view, x: e.target.x(), y: e.target.y() });
        }}
        onWheel={onWheel}
        onMouseDown={onStageDown}
        onMouseMove={onStageMove}
        onMouseUp={onStageUp}
        onClick={onStageClick}
        onTap={onStageClick}
      >
        <Layer listening={false}>
          <Rect x={-view.x / view.scale} y={-view.y / view.scale} width={size.w / view.scale} height={size.h / view.scale} fill={colors.canvas} />
          {layers.grid && <Grid view={view} size={size} step={gridSize} colors={colors} />}
        </Layer>

        {layers.links && (
          <Layer>
            {model.links.map((l) => {
              const a = byId.get(l.from);
              const b = byId.get(l.to);
              if (!a || !b) return null;
              const pts = edgePoints(a, b);
              const isReturn = a.type === 'rework';
              const sel = selectedLink === l.id;
              const moved = movedByLink.get(l.id) ?? 0;
              const heatW = layers.heat ? 1.5 + (moved / maxMoved) * 9 : 1.6;
              const heatC = layers.heat ? heatColor(moved / maxMoved) : colors.muted;
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
                    dash={isReturn ? [6, 4] : undefined}
                    opacity={layers.heat ? 0.85 : 1}
                    hitStrokeWidth={12}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      useStore.getState().select([], l.id);
                    }}
                  />
                  {multi && layers.labels && (
                    <Text
                      x={(pts[0] + pts[2]) / 2 + 4}
                      y={(pts[1] + pts[3]) / 2 - 14}
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
                draggable={draggable}
                labels={layers.labels}
                stage={stageRef}
                onSelect={(add) => {
                  const st = useStore.getState();
                  if (st.tool === 'connect') {
                    if (!st.connectFrom) st.setConnectFrom(n.id);
                    else {
                      st.addLink(st.connectFrom, n.id);
                      st.setConnectFrom(null);
                    }
                    return;
                  }
                  if (add) st.select(st.selected.includes(n.id) ? st.selected.filter((i) => i !== n.id) : [...st.selected, n.id]);
                  else if (!st.selected.includes(n.id)) st.select([n.id]);
                }}
              />
            );
          })}
        </Layer>

        {layers.entities && (
          <Layer listening={false}>
            {[...sim.transits].map((t) => {
              const a = t.link.from.def;
              const b = t.link.to.def;
              const span = t.end - t.start;
              const f = span > 0 ? Math.min(1, Math.max(0, (sim.now - t.start) / span)) : 1;
              const pts = edgePoints(a, b);
              return (
                <Circle
                  key={t.entity.id}
                  x={pts[0] + (pts[2] - pts[0]) * f}
                  y={pts[1] + (pts[3] - pts[1]) * f}
                  radius={5}
                  fill={t.entity.reworks > 0 ? colors.state.blocked : colors.transport}
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
      <div className="zoom">
        <button className="btn" onClick={() => zoomBy(1.2)} aria-label="Aproximar">+</button>
        <button className="btn" onClick={() => zoomBy(1 / 1.2)} aria-label="Afastar">−</button>
        <button className="btn" onClick={fit}>Enquadrar</button>
      </div>
      <div className="toast">
        {tool === 'connect'
          ? connectFrom
            ? 'Conectar: agora clique no bloco de destino.'
            : 'Conectar: clique no bloco de origem.'
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
  selected: boolean;
  bottleneck: boolean;
  draggable: boolean;
  labels: boolean;
  stage: React.RefObject<Konva.Stage | null>;
  onSelect: (add: boolean) => void;
}

function NodeShape({ def, rt, colors, selected, bottleneck, draggable, labels, stage, onSelect }: NodeShapeProps) {
  const stateColor = colors.state[rt.state];
  const stroke = selected ? colors.accent : stateColor;
  const sw = selected ? 3 : 2;
  const startRef = useRef<{ x: number; y: number; others: { id: string; x: number; y: number }[] } | null>(null);
  const fill = mixHex(stateColor, colors.raised, 0.24);
  const q = rt.queue.length + rt.reserved;
  const inProc = rt.processing.length + rt.done.length;
  const isBuffer = def.type === 'buffer';
  const cap = Math.max(1, def.capacity);

  return (
    <Group
      id={def.id}
      x={def.x}
      y={def.y}
      draggable={draggable}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(false);
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
        text={glyph(def.type)}
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
      {labels && (
        <>
          <Text x={-50} y={H / 2 + 5} width={100} align="center" text={def.name} fontSize={11} fill={colors.ink} listening={false} wrap="none" ellipsis />
          {(def.type === 'sink' || def.type === 'source') && (
            <Text x={-50} y={-H / 2 - 16} width={100} align="center" text={String(def.type === 'sink' ? rt.processed : rt.released)} fontSize={12} fontStyle="bold" fill={colors.muted} listening={false} />
          )}
        </>
      )}
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
  return { source: 'MP', machine: 'M', buffer: 'BUF', inspection: 'QC', rework: 'RW', sink: 'FG' }[t];
}

/** Pontos de um link, saindo da borda do bloco de origem até a borda do destino. */
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

