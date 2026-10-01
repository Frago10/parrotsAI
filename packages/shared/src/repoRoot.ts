// Localiza la raíz del monorepo (donde está pnpm-workspace.yaml) para resolver rutas de datos
// de forma estable sin importar desde qué app se ejecute el proceso. Solo para Node (servidor).
import { existsSync } from 'node:fs';
import path from 'node:path';

export function findRepoRoot(from: string = process.cwd()): string {
  let dir = path.resolve(from);
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(from);
}

/** Carpeta de registros JSONL de sesión: SESSION_LOG_DIR relativa a la raíz del repo. */
export function sessionLogDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SESSION_LOG_DIR ?? './data/sessions';
  return path.isAbsolute(configured) ? configured : path.resolve(findRepoRoot(), configured);
}
