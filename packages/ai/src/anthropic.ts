// Proveedor Anthropic (Claude) con streaming y prompt caching del system prompt.
import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmCallOptions,
  LlmCompletion,
  LlmProvider,
  LlmRequest,
  LlmStreamEvent,
} from './types';
import { collectStream } from './types';

export interface AnthropicProviderOptions {
  apiKey?: string;
  /** Milisegundos de timeout por petición. */
  timeoutMs?: number;
}

/** Modelos de la familia 5.x aceptan output_config.effort; Haiku 4.5 no. */
function supportsEffort(model: string): boolean {
  return /claude-(?:opus|sonnet|fable)-5/.test(model);
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.client = new Anthropic({
      apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
      timeout: opts.timeoutMs ?? 60_000,
      maxRetries: 1,
    });
  }

  async *stream(req: LlmRequest, opts: LlmCallOptions = {}): AsyncIterable<LlmStreamEvent> {
    const params: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens,
      // El system prompt es estable durante toda la sesión: se cachea para abaratar cada respuesta.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (req.temperature != null && !supportsEffort(req.model)) params.temperature = req.temperature;
    if (req.effort && supportsEffort(req.model)) params.output_config = { effort: req.effort };

    const stream = this.client.messages.stream(params, { signal: opts.signal });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'delta', text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    yield {
      type: 'done',
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
      },
      stopReason: final.stop_reason,
      model: final.model,
    };
  }

  complete(req: LlmRequest, opts: LlmCallOptions = {}): Promise<LlmCompletion> {
    return collectStream(this.stream(req, opts), req.model);
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    err instanceof Anthropic.APIUserAbortError
  );
}
