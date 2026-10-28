import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Exemplo privado opcional (fora do git): private/example.json vira o modelo inicial.
const examplePath = new URL('./private/example.json', import.meta.url);
const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : 'null';
// Segundo exemplo privado (só a linha principal, com atividades); usa a planta do primeiro.
const mainPath = new URL('./private/example-main.json', import.meta.url);
const exampleMain = existsSync(mainPath) ? readFileSync(mainPath, 'utf8') : 'null';

// `--mode single` gera um único index.html com JS/CSS embutidos (usado no artefato).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  define: { __EXAMPLE__: example, __EXAMPLE_MAIN__: exampleMain },
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
