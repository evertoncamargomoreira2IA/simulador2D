// Planta vetorial genérica (80 m × 46 m, 20 px/m) do exemplo de abastecimento e FGI.
// Vetorial para ficar nítida em qualquer zoom: paredes, corredores, racks, bancadas e docas.

import type { Background } from '../engine/types';

type Box = [number, number, number, number];

export const PLANT_AREAS: Record<string, Box> = {
  Recebimento: [20, 20, 220, 280],
  Supermercado: [260, 20, 640, 280],
  Kitting: [920, 20, 660, 280],
  'Off-line': [380, 380, 1000, 100],
  'Linha de montagem': [260, 490, 1100, 130],
  Teste: [1380, 380, 200, 240],
  Expedição: [20, 700, 220, 200],
  FGI: [260, 700, 440, 200],
  Packing: [720, 700, 860, 200],
};

export function supplyPlant(): Background {
  const paths: number[][] = [];
  const circles: [number, number, number][] = [];
  const texts: Background['texts'] = [];
  const rect = (x: number, y: number, w: number, h: number) => paths.push([x, y, x + w, y, x + w, y + h, x, y + h, x, y]);
  const line = (...p: number[]) => paths.push(p);
  // linha tracejada horizontal: traços de 12 px com 8 px de espaço
  const dashed = (x0: number, x1: number, y: number) => {
    for (let x = x0; x < x1; x += 20) line(x, y, Math.min(x + 12, x1), y);
  };
  // contorno de área com cantos chanfrados
  const area = ([x, y, w, h]: Box, c = 8) =>
    line(x + c, y, x + w - c, y, x + w, y + c, x + w, y + h - c, x + w - c, y + h, x + c, y + h, x, y + h - c, x, y + c, x + c, y);

  // paredes (dupla)
  rect(0, 0, 1600, 920);
  rect(6, 6, 1588, 908);

  // pilares nas paredes
  for (let x = 200; x <= 1400; x += 200)
    for (const y of [6, 914]) {
      circles.push([x, y, 6]);
      rect(x - 6, y - 6, 12, 12);
    }

  // corredores: bordas, linha central e sentido (setas para a esquerda)
  for (const y of [300, 370, 630, 690]) line(20, y, 1580, y);
  for (const y of [335, 660]) {
    dashed(20, 1580, y);
    for (let x = 200; x < 1580; x += 200) line(x + 10, y - 6, x, y, x + 10, y + 6, x + 10, y - 6);
  }

  // supermercado: 4 fileiras de flow rack com baias
  for (const y of [50, 110, 170, 230]) {
    rect(300, y, 560, 28);
    for (let x = 356; x < 860; x += 56) line(x, y, x, y + 28);
  }

  // recebimento: docas e pallets
  for (const y of [60, 180]) rect(0, y, 12, 60);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) rect(60 + c * 80, 60 + r * 75, 50, 50);

  // kitting: mesas, carrinhos e vagas de kits prontos
  for (const x of [960, 1120, 1280]) {
    rect(x, 70, 120, 50);
    rect(x + 10, 130, 40, 30);
    rect(x + 70, 130, 40, 30);
  }
  for (let i = 0; i < 8; i++) rect(1260 + i * 38, 200, 34, 40);

  // off-line: bancadas
  for (const cx of [430, 650, 870, 1090, 1310]) rect(cx - 60, 410, 120, 40);

  // linha de montagem: mesa contínua com divisões de posto e fita de chão
  rect(270, 537, 1080, 36);
  for (let x = 375; x < 1350; x += 110) line(x, 537, x, 573);
  rect(264, 494, 1092, 122);

  // teste: 4 bancadas 2 × 2
  for (const dx of [-45, 45]) for (const dy of [-30, 30]) rect(1480 + dx - 35, 555 + dy - 20, 70, 40);

  // packing: bancada, divisões e pallets de caixas
  rect(740, 782, 820, 36);
  for (let x = 910; x < 1560; x += 170) line(x, 782, x, 818);
  for (const x of [800, 1100, 1400]) rect(x, 840, 60, 40);

  // FGI: grade de pallets com corredor no meio
  for (let x = 280; x + 40 <= 680; x += 48) {
    if (x > 455 && x < 505) continue;
    for (let y = 720; y + 40 <= 880; y += 48) rect(x, y, 40, 40);
  }

  // expedição: docas e niveladores
  for (const y of [720, 780, 840]) {
    rect(0, y, 12, 50);
    rect(12, y + 5, 60, 40);
  }

  for (const [name, b] of Object.entries(PLANT_AREAS)) {
    area(b);
    texts.push({ x: b[0] + 10, y: b[1] + 26, h: 18, t: name.toUpperCase() });
  }
  texts.push({ x: 640, y: 330, h: 12, t: 'CORREDOR MILK RUN ←' });
  texts.push({ x: 640, y: 655, h: 12, t: 'CORREDOR EMPILHADEIRA ←' });
  texts.push({ x: 780, y: 912, h: 14, t: '80 m' });
  texts.push({ x: 18, y: 480, h: 14, t: '46 m', r: -90 });
  texts.push({ x: 1540, y: 44, h: 16, t: 'N ↑' });

  return { paths, circles, texts, width: 1600, height: 920, originX: 0, originY: 0, pxPerMeter: 20, opacity: 0.9 };
}
