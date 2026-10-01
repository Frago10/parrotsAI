// Genera respuestas en streaming con el modelo de la sesión. Una respuesta activa a la vez:
// una nueva pregunta aborta la anterior.
import {
  buildAnswerSystemPrompt,
  buildAnswerUserPrompt,
  buildChatSystemPrompt,
} from '@callpilot/shared';
import type { AiMessageKind, QuestionType, SessionContext } from '@callpilot/shared';
import { isAbortError, type LlmProvider, type LlmUsage } from '@callpilot/ai';

export interface AnswerJob {
  messageId: string;
  kind: AiMessageKind;
  question: string | null;
  qtype: QuestionType | null;
  recentTranscript: string;
  previousAnswers: string[];
  userInstruction?: string | null;
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

  private systemPrompt(chat: boolean): string {
    const ctx = this.getContext();
    const key = `${chat ? 'chat' : 'answer'}:${JSON.stringify(ctx)}`;
    if (this.systemPromptCache?.key !== key) {
      this.systemPromptCache = {
        key,
        value: chat ? buildChatSystemPrompt(ctx) : buildAnswerSystemPrompt(ctx),
      };
    }
    return this.systemPromptCache.value;
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
    this.cb.onStart(job);
    try {
      const stream = this.llm.stream(
        {
          model: this.model,
          system: this.systemPrompt(isChat),
          messages: [
            {
              role: 'user',
              content: isChat
                ? `## Recent transcript\n${job.recentTranscript || '(none)'}\n\n## USER message\n${job.userInstruction ?? ''}`
                : buildAnswerUserPrompt({
                    question: job.question,
                    qtype: job.qtype,
                    recentTranscript: job.recentTranscript,
                    previousAnswers: job.previousAnswers,
                    userInstruction: job.userInstruction ?? null,
                  }),
            },
          ],
          maxTokens: job.qtype === 'coding' ? 1200 : 600,
          temperature: 0.4,
          purpose: isChat ? 'chat' : 'answer',
          effort: 'low',
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
