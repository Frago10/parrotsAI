// Catálogo de modelos LLM disponibles en la sesión. Los precios son USD por millón de tokens.
export type LlmProviderId = 'anthropic' | 'openai' | 'google' | 'fake';
export type ModelSpeed = 'fast' | 'balanced' | 'detailed';

export interface ModelSpec {
  id: string;
  provider: LlmProviderId;
  label: string;
  speed: ModelSpeed;
  vision: boolean;
  costInPerM: number;
  costOutPerM: number;
  /** Variable de entorno que debe existir para poder usarlo. */
  requiresEnv: string | null;
  /** Modelo usado por el clasificador de preguntas cuando este es el modelo de la sesión. */
  classifierModel: string;
}

export const MODEL_CATALOG: ModelSpec[] = [
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    label: 'Claude Haiku 4.5',
    speed: 'fast',
    vision: true,
    costInPerM: 1,
    costOutPerM: 5,
    requiresEnv: 'ANTHROPIC_API_KEY',
    classifierModel: 'claude-haiku-4-5',
  },
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5.5',
    speed: 'balanced',
    vision: true,
    costInPerM: 2,
    costOutPerM: 10,
    requiresEnv: 'ANTHROPIC_API_KEY',
    classifierModel: 'claude-haiku-4-5',
  },
  {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    label: 'Claude Opus 5.5',
    speed: 'detailed',
    vision: true,
    costInPerM: 4,
    costOutPerM: 20,
    requiresEnv: 'ANTHROPIC_API_KEY',
    classifierModel: 'claude-haiku-4-5',
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    label: 'GPT-4o mini',
    speed: 'fast',
    vision: true,
    costInPerM: 0.15,
    costOutPerM: 0.6,
    requiresEnv: 'OPENAI_API_KEY',
    classifierModel: 'gpt-4o-mini',
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'google',
    label: 'Gemini 2.5 Flash',
    speed: 'fast',
    vision: true,
    costInPerM: 0.3,
    costOutPerM: 2.5,
    requiresEnv: 'GOOGLE_API_KEY',
    classifierModel: 'gemini-2.5-flash',
  },
  {
    id: 'fake-fast',
    provider: 'fake',
    label: 'Simulador (sin API, para pruebas)',
    speed: 'fast',
    vision: false,
    costInPerM: 0,
    costOutPerM: 0,
    requiresEnv: null,
    classifierModel: 'fake-fast',
  },
];

export const DEFAULT_MODEL_ID = 'claude-haiku-4-5';

/** Modelos retirados y su reemplazo; la app migra la sesión y avisa al usuario. */
export const RETIRED_MODELS: Record<string, string> = {
  'claude-3-5-haiku-latest': 'claude-haiku-4-5',
  'claude-3-5-sonnet-latest': 'claude-sonnet-5-5',
  'claude-sonnet-4-5': 'claude-sonnet-5-5',
  'claude-sonnet-4-6': 'claude-sonnet-5-5',
  'claude-opus-4-5': 'claude-opus-5-5',
  'claude-opus-4-6': 'claude-opus-5-5',
};

export function findModel(id: string): ModelSpec | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/** Devuelve el modelo vigente para un id (migrando los retirados) y si hubo migración. */
export function resolveModel(id: string): { model: ModelSpec; migratedFrom: string | null } {
  const direct = findModel(id);
  if (direct) return { model: direct, migratedFrom: null };
  const replacement = RETIRED_MODELS[id];
  const model = (replacement && findModel(replacement)) || findModel(DEFAULT_MODEL_ID)!;
  return { model, migratedFrom: id };
}

export function speedLabel(speed: ModelSpeed, locale: 'es' | 'en' = 'es'): string {
  const es: Record<ModelSpeed, string> = { fast: 'Rápido', balanced: 'Equilibrado', detailed: 'Detallado' };
  const en: Record<ModelSpeed, string> = { fast: 'Fast', balanced: 'Balanced', detailed: 'Detailed' };
  return (locale === 'es' ? es : en)[speed];
}

/** Costo estimado en USD de una llamada LLM. */
export function estimateCostUsd(modelId: string, tokensIn: number, tokensOut: number): number {
  const m = findModel(modelId);
  if (!m) return 0;
  return (tokensIn / 1_000_000) * m.costInPerM + (tokensOut / 1_000_000) * m.costOutPerM;
}
