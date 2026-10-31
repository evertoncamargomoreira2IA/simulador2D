import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SIM_PUBLIC=1 ignora a pasta private/ (prints da biblioteca sem dados privados).
const pub = process.env.SIM_PUBLIC === '1';
// Exemplo privado opcional (fora do git): private/example.json vira o modelo inicial.
const examplePath = new URL('./private/example.json', import.meta.url);
const example = !pub && existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : 'null';
// Segundo exemplo privado (só a linha principal, com atividades); usa a planta do primeiro.
const mainPath = new URL('./private/example-main.json', import.meta.url);
const exampleMain = !pub && existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : 'null';
// Nome do app opcional (fora do git): private/app-name.txt troca o "Simulador 2D" na barra e na aba.
const namePath = new URL('./private/app-name.txt', import.meta.url);
const appName = !pub && existsSync(namePath) ? readFileSync(namePath, 'utf8').trim() : '';

// SIM_OFFLINE=1: versão offline (backup): abre com a linha de 10 postos e tema cinza e verde.
const offline = process.env.SIM_OFFLINE === '1';
// Link do projeto online (fora do git): private/online-url.txt vira o botão 🔗 Projeto online da versão offline.
const urlPath = new URL('./private/online-url.txt', import.meta.url);
const onlineUrl = !pub && existsSync(urlPath) ? readFileSync(urlPath, 'utf8').trim() : '';

// `--mode single` gera um único index.html com JS/CSS embutidos (usado no artefato).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  define: { __EXAMPLE__: example, __EXAMPLE_MAIN__: exampleMain, __APP_NAME__: JSON.stringify(appName || 'Simulador 2D'), __OFFLINE__: JSON.stringify(offline), __ONLINE_URL__: JSON.stringify(onlineUrl) },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
