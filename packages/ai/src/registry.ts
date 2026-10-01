// Selección de proveedor según el modelo de la sesión y las claves disponibles.
import { findModel, type LlmProviderId, resolveModel } from '@callpilot/shared';
import { AnthropicProvider } from './anthropic';
import { FakeLlmProvider, type FakeProviderOptions } from './fake';
import type { LlmProvider } from './types';

export interface ProviderResolution {
  provider: LlmProvider;
  /** Modelo efectivo (puede cambiar si el solicitado no tiene clave o fue retirado). */
  modelId: string;
  classifierModelId: string;
  /** Aviso para el usuario si hubo degradación o migración. */
  notice: string | null;
}

const cache = new Map<string, LlmProvider>();

export function getProvider(id: LlmProviderId, fakeOpts?: FakeProviderOptions): LlmProvider {
  const key = id;
  const existing = cache.get(key);
  if (existing) return existing;
  let p: LlmProvider;
  switch (id) {
    case 'anthropic':
      p = new AnthropicProvider();
      break;
    case 'fake':
      p = new FakeLlmProvider(
        fakeOpts ?? {
          chunkDelayMs: Number(process.env.FAKE_LLM_CHUNK_DELAY_MS ?? 12),
          firstTokenDelayMs: Number(process.env.FAKE_LLM_FIRST_TOKEN_MS ?? 250),
        },
      );
      break;
    default:
      throw new Error(`Proveedor LLM no implementado todavía: ${id}`);
  }
  cache.set(key, p);
  return p;
}

/** Resuelve el proveedor para el modelo pedido, degradando al simulador si falta la clave. */
export function resolveProviderForModel(
  requestedModelId: string,
  env: NodeJS.ProcessEnv = process.env,
): ProviderResolution {
  const { model, migratedFrom } = resolveModel(requestedModelId);
  const notices: string[] = [];
  if (migratedFrom) notices.push(`El modelo ${migratedFrom} fue retirado; se usa ${model.label}.`);

  const forced = env.LLM_PROVIDER as LlmProviderId | undefined;
  if (forced === 'fake' || (model.requiresEnv && !env[model.requiresEnv])) {
    if (model.provider !== 'fake') {
      notices.push(
        forced === 'fake'
          ? 'LLM_PROVIDER=fake: se usa el simulador en lugar del modelo real.'
          : `Falta ${model.requiresEnv}: se usa el simulador en lugar de ${model.label}.`,
      );
    }
    return {
      provider: getProvider('fake'),
      modelId: 'fake-fast',
      classifierModelId: 'fake-fast',
      notice: notices.join(' ') || null,
    };
  }
  if (model.provider === 'openai' || model.provider === 'google') {
    notices.push(`${model.label} todavía no está implementado; se usa el simulador.`);
    return {
      provider: getProvider('fake'),
      modelId: 'fake-fast',
      classifierModelId: 'fake-fast',
      notice: notices.join(' '),
    };
  }
  const classifier = findModel(model.classifierModel) ?? model;
  return {
    provider: getProvider(model.provider),
    modelId: model.id,
    classifierModelId: classifier.id,
    notice: notices.join(' ') || null,
  };
}

/** Solo para tests: limpia el caché de proveedores. */
export function resetProviderCache(): void {
  cache.clear();
}
