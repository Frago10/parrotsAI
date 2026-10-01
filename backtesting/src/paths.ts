// Rutas del paquete resueltas desde este archivo para que funcionen desde cualquier cwd.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DATASETS_DIR = path.join(PACKAGE_ROOT, 'datasets');
export const SESSIONS_DIR = path.join(DATASETS_DIR, 'sessions');
export const REPORTS_DIR = path.join(PACKAGE_ROOT, 'reports');
export const QUESTIONS_DATASET = path.join(DATASETS_DIR, 'questions.v1.json');
