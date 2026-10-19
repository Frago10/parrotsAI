// Genera respuestas en streaming con el modelo de la sesión. Una respuesta activa a la vez:
// una nueva pregunta aborta la anterior.
import {
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  buildChatSystemPrompt,
  buildScreenSystemPrompt,
  buildScreenUserPrompt,
} from '@callpilot/shared';
import type { AiMessageKind, PageContext, QuestionType, SessionContext } from '@callpilot/shared';
import { isAbortError, type LlmContentPart, type LlmProvider, type LlmUsage } from '@callpilot/ai';

/** Datos del lector de pantalla para un trabajo de tipo SCREENSHOT. */
export interface ScreenInput {
  page: PageContext | null;
  prompt: string | null;
  imageBase64: string | null;
  imageMediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface AnswerJob {
  messageId: string;
  kind: AiMessageKind;
  question: string | null;
  qtype: QuestionType | null;
  recentTranscript: string;
  previousAnswers: string[];
  userInstruction?: string | null;
  /** Presente cuando kind = SCREENSHOT. */
  screen?: ScreenInput;
}

export interface AnswerCallbacks {
  onStart: (job: AnswerJob) => void;
  onFirstToken: (job: AnswerJob, latencyMs: number) => void;
  onDelta: (job: AnswerJob, delta: string) => void;
  onDone: (
    job: AnswerJob,
    result: {
      content: string;
      latencyMs: number;
      firstTokenMs: number | null;
      usage: LlmUsage;
      aborted: boolean;
      model: string;
    },
  ) => void;
  onError: (job: AnswerJob, err: Error) => void;
}

export class Answerer {
  private current: { job: AnswerJob; controller: AbortController } | null = null;
  private systemPromptCache: { key: string; value: string } | null = null;

  constructor(
    private readonly llm: LlmProvider,
    private readonly model: string,
    private readonly getContext: () => SessionContext,
    private readonly cb: AnswerCallbacks,
  ) {}

  get busy(): boolean {
    return this.current != null;
  }

  cancel(): void {
    this.current?.controller.abort();
  }

  private systemPrompt(mode: 'answer' | 'chat' | 'screen'): string {
    const ctx = this.getContext();
    const key = `${mode}:${JSON.stringify(ctx)}`;
    if (this.systemPromptCache?.key !== key) {
      const value =
        mode === 'chat'
          ? buildChatSystemPrompt(ctx)
          : mode === 'screen'
            ? buildScreenSystemPrompt(ctx)
            : buildAnswerSystemPrompt(ctx);
      this.systemPromptCache = { key, value };
    }
    return this.systemPromptCache.value;
  }

  /** Mensaje de usuario del trabajo: texto o texto + imagen (lector de pantalla). */
  private userContent(job: AnswerJob): string | LlmContentPart[] {
    if (job.screen) {
      const text = buildScreenUserPrompt({
        page: job.screen.page,
        prompt: job.screen.prompt,
        hasImage: Boolean(job.screen.imageBase64),
        recentTranscript: job.recentTranscript,
        previousAnswers: job.previousAnswers,
      });
      if (!job.screen.imageBase64) return text;
      return [
        { type: 'image', mediaType: job.screen.imageMediaType, data: job.screen.imageBase64 },
        { type: 'text', text },
      ];
    }
    if (job.kind === 'CHAT_AI') {
      return `## Recent transcript\n${job.recentTranscript || '(none)'}\n\n## USER message\n${job.userInstruction ?? ''}`;
    }
    return buildAnswerUserPrompt({
      question: job.question,
      qtype: job.qtype,
      recentTranscript: job.recentTranscript,
      previousAnswers: job.previousAnswers,
      userInstruction: job.userInstruction ?? null,
    });
  }

  async run(job: AnswerJob): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.current = { job, controller };
    const started = Date.now();
    let firstTokenMs: number | null = null;
    let content = '';
    let usage: LlmUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    let model = this.model;
    const isChat = job.kind === 'CHAT_AI';
    const isScreen = job.screen != null;
    this.cb.onStart(job);
    try {
      const stream = this.llm.stream(
        {
          model: this.model,
          system: this.systemPrompt(isScreen ? 'screen' : isChat ? 'chat' : 'answer'),
          messages: [{ role: 'user', content: this.userContent(job) }],
          maxTokens: isScreen ? 1500 : job.qtype === 'coding' ? 1200 : 600,
          temperature: 0.4,
          purpose: isScreen ? 'screen' : isChat ? 'chat' : 'answer',
          effort: isScreen ? 'medium' : 'low',
        },
        { signal: controller.signal },
      );
      for await (const ev of stream) {
        if (ev.type === 'delta') {
          if (firstTokenMs == null) {
            firstTokenMs = Date.now() - started;
            this.cb.onFirstToken(job, firstTokenMs);
          }
          content += ev.text;
          this.cb.onDelta(job, ev.text);
        } else {
          usage = ev.usage;
          model = ev.model;
          if (ev.stopReason === 'refusal')
            content += '\n\n_(El modelo declinó responder esta pregunta.)_';
        }
      }
      this.cb.onDone(job, {
        content,
        latencyMs: Date.now() - started,
        firstTokenMs,
        usage,
        aborted: false,
        model,
      });
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        this.cb.onDone(job, {
          content,
          latencyMs: Date.now() - started,
          firstTokenMs,
          usage,
          aborted: true,
          model,
        });
      } else {
        this.cb.onError(job, err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (this.current?.job === job) this.current = null;
    }
  }
}
