// Empaqueta la extensión en dist/ con esbuild. `--watch` reconstruye al guardar.
import { build, context } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/worklets', { recursive: true });

const common = {
  bundle: true,
  target: 'chrome116',
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'info',
};

const jobs = [
  // Service worker (módulo ES) y páginas de la extensión.
  {
    ...common,
    format: 'esm',
    entryPoints: {
      background: 'src/background.ts',
      sidepanel: 'src/sidepanel/main.ts',
      permissions: 'src/permissions.ts',
    },
    outdir: 'dist',
  },
  // Lector de página: script clásico autocontenido. El footer hace que chrome.scripting.executeScript
  // devuelva el resultado de read() como valor de la última expresión.
  {
    ...common,
    format: 'iife',
    globalName: '__cpPageReader',
    entryPoints: { pageReader: 'src/pageReader.ts' },
    outdir: 'dist',
    footer: { js: '__cpPageReader.read();' },
  },
];

function copyStatic() {
  const manifest = readFileSync('static/manifest.json', 'utf8').replace('__VERSION__', pkg.version);
  writeFileSync('dist/manifest.json', manifest);
  for (const f of ['sidepanel.html', 'sidepanel.css', 'permissions.html'])
    cpSync(`static/${f}`, `dist/${f}`);
  if (existsSync('static/icons')) cpSync('static/icons', 'dist/icons', { recursive: true });
  // El worklet de PCM es el mismo que usa la web: una sola fuente.
  cpSync('../web/public/worklets/pcm-processor.js', 'dist/worklets/pcm-processor.js');
}

copyStatic();
if (watch) {
  for (const job of jobs) await (await context(job)).watch();
  console.log('Observando cambios… (recarga la extensión en chrome://extensions tras cada build)');
} else {
  for (const job of jobs) await build(job);
  console.log(`Extensión ${pkg.version} lista en apps/extension/dist`);
}
