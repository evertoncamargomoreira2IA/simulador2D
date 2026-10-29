// Abrir arquivos: pelo botão Importar ou arrastando para dentro do simulador.

import type { Background } from '../engine/types';
import { parseDxf, snapNodesToLabels } from '../io/dxf';
import { importFile } from '../io/importer';
import * as XLSX from 'xlsx';
import { soeSheets } from '../io/soe';
import { isTemplate } from '../io/template';
import { useStore } from '../store';
import { openSoe } from './SoeImport';

const IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;
/** Lado maior da imagem guardada no modelo: mantém o modelo leve para salvar. */
const MAX_SIDE = 3000;

export const ACCEPT = '.xlsx,.xlsm,.xls,.csv,.txt,.json,.dxf,.png,.jpg,.jpeg,.webp,.gif,.bmp';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('a imagem não abriu'));
    img.src = src;
  });
}

/** Imagem do layout como planta de fundo, com a largura real informada em metros. */
async function imageBackground(f: File, metersWide: number, ppm: number): Promise<Background> {
  const url = URL.createObjectURL(f);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const width = metersWide * ppm;
    return {
      paths: [],
      circles: [],
      texts: [],
      width,
      height: (width * c.height) / c.width,
      originX: 0,
      originY: 0,
      pxPerMeter: ppm,
      image: c.toDataURL('image/jpeg', 0.85),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Planta (DXF ou imagem) vira o fundo do modelo aberto; planilha e JSON abrem como modelo. */
export async function importAnyFile(f: File): Promise<void> {
  const st = useStore.getState();
  try {
    if (/\.dxf$/i.test(f.name)) {
      const m = st.model;
      const bg = parseDxf(await f.text(), m.settings.pxPerMeter || 40);
      const nodes = m.nodes.map((n) => ({ ...n }));
      const moved = snapNodesToLabels(bg, nodes);
      st.setModel(
        { ...m, nodes, background: bg },
        `Planta "${f.name}" carregada (${(bg.width / bg.pxPerMeter).toFixed(0)} × ${(bg.height / bg.pxPerMeter).toFixed(0)} m). ${moved ? `${moved} blocos posicionados pelo nome no desenho.` : 'Arraste os blocos sobre a planta.'}`,
      );
      return;
    }
    if (IMAGE.test(f.name) || f.type.startsWith('image/')) {
      const m = st.model;
      const ans = window.prompt(`Largura real do layout "${f.name}" em metros (para a escala):`, '60');
      if (ans === null) return;
      const meters = Number(ans.replace(',', '.'));
      if (!(meters > 0)) throw new Error('largura inválida');
      const bg = await imageBackground(f, meters, m.settings.pxPerMeter || 40);
      st.setModel(
        { ...m, background: bg },
        `Layout "${f.name}" carregado como planta (${meters} × ${(bg.height / bg.pxPerMeter).toFixed(0)} m). Arraste os blocos sobre ele.`,
      );
      return;
    }
    if (/\.pdf$/i.test(f.name)) {
      st.setMessage('PDF ainda não abre direto: exporte o layout como PNG/JPG ou DXF e arraste de novo.');
      return;
    }
    if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      if (!isTemplate(wb) && soeSheets(wb).length) return openSoe(wb, f.name.replace(/\.[^.]+$/, ''));
    }
    const r = await importFile(f, st.model.settings.takt || 12);
    const cur = useStore.getState().model;
    if (r.keepBackground && cur.background) {
      const k = (cur.settings.pxPerMeter || 40) / (r.model.settings.pxPerMeter || 40);
      const nodes = r.model.nodes.map((n) => ({ ...n, x: n.x * k, y: n.y * k }));
      st.setModel({ ...r.model, nodes, background: cur.background, zones: cur.zones, settings: { ...r.model.settings, pxPerMeter: cur.settings.pxPerMeter } }, `${r.info} Planta mantida.`);
    } else st.setModel(r.model, r.info);
  } catch (err) {
    st.setMessage(`Não foi possível abrir "${f.name}": ${(err as Error).message}`);
  }
}
