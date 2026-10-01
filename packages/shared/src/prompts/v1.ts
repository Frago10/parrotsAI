// Prompts versionados (v1). Cambiarlos cambia el comportamiento medido en backtesting,
// así que cualquier ajuste debe ir acompañado de una nueva corrida.
import { languageNameForPrompt } from '../languages';
import type { QuestionType } from '../protocol';

export const PROMPT_VERSION = 'v1';

export type SessionMode = 'INTERVIEW' | 'REGULAR' | 'MOCK';

export interface SessionContext {
  mode: SessionMode;
  language: string;
  company: string | null;
  title: string | null;
  description: string | null;
  instructions: string | null;
  /** Texto del CV (solo INTERVIEW) o perfil resumido. */
  resumeText: string | null;
  /** Fragmentos de documentos (RAG) ya seleccionados. */
  documentSnippets: string[];
}

export interface AnswerLabels {
  question: string;
  answer: string;
}

export function answerLabels(language: string): AnswerLabels {
  return language.startsWith('es') || language === 'multi'
    ? { question: 'Pregunta', answer: 'Respuesta' }
    : { question: 'Question', answer: 'Answer' };
}

function section(title: string, body: string | null | undefined): string {
  if (!body || !body.trim()) return '';
  return `\n\n## ${title}\n${body.trim()}`;
}

/**
 * System prompt estable para toda la sesión. Debe ser determinista para aprovechar
 * prompt caching: nada de fechas ni ids aquí.
 */
export function buildAnswerSystemPrompt(ctx: SessionContext): string {
  const lang = languageNameForPrompt(ctx.language);
  const labels = answerLabels(ctx.language);
  const role =
    ctx.mode === 'INTERVIEW'
      ? `You are the real-time interview copilot of the USER (the candidate). The USER is in a live job interview${
          ctx.company ? ` with ${ctx.company}` : ''
        }${ctx.title ? ` for the role "${ctx.title}"` : ''}. When the interviewer asks something, you draft what the USER should say, in first person, grounded in the USER's CV and instructions. Never invent experience that is not in the CV; if something is missing, suggest an honest way to answer.`
      : `You are the real-time meeting copilot of the USER. The USER is in a live call${
          ctx.company ? ` with ${ctx.company}` : ''
        }${ctx.title ? ` about "${ctx.title}"` : ''} (sales, client, support or team meeting). When the other party asks something or raises an objection, you draft what the USER should say, in first person, grounded in the USER's instructions and documents.`;

  return `${role}

The USER reads your answer out loud while the other person waits, so it must be readable in under 20 seconds: the key idea first, then 3 to 5 short actionable bullets, then an optional one-line closer. Plain, natural spoken language. No preambles, no meta commentary, no "as an AI".

Always answer in ${lang}. Use exactly this markdown structure and nothing else:

💬 **${labels.question}:** <the detected question, rephrased briefly>
⭐ **${labels.answer}:** <the central idea in one sentence>
• <bullet 1>
• <bullet 2>
• <bullet 3>
<optional one-line closer>

For coding questions use instead: one-line approach, a fenced code block with the language tag, bullets with edge cases, and a final line "Time/Space: O(...) / O(...)".
For objections (price, timing, competitor, "I need to think"): acknowledge, reframe with value, ask one question that moves the deal forward.
If the question is unclear, give the most likely interpretation and one clarifying question the USER can ask.
Do not repeat an answer you already gave in this session; build on it instead.${section(
    'Session instructions from the USER',
    ctx.instructions,
  )}${section('Session description', ctx.description)}${
    ctx.mode === 'INTERVIEW' ? section("USER's CV", ctx.resumeText) : section("USER's profile", ctx.resumeText)
  }${
    ctx.documentSnippets.length
      ? section('Relevant excerpts from the USER documents', ctx.documentSnippets.map((s, i) => `[${i + 1}] ${s}`).join('\n\n'))
      : ''
  }`;
}

export interface AnswerTurnInput {
  question: string | null;
  qtype: QuestionType | null;
  /** Últimos minutos de transcripción, ya formateados como "THEM: ..." / "ME: ...". */
  recentTranscript: string;
  previousAnswers: string[];
  /** Instrucción manual del usuario (botón Answer con texto, o chat). */
  userInstruction?: string | null;
}

export function buildAnswerUserPrompt(input: AnswerTurnInput): string {
  const parts: string[] = [];
  parts.push(`## Recent transcript (THEM = other party, ME = the USER)\n${input.recentTranscript.trim() || '(no transcript yet)'}`);
  if (input.previousAnswers.length) {
    parts.push(
      `## Answers already given (do not repeat)\n${input.previousAnswers
        .slice(-3)
        .map((a) => a.split('\n').slice(0, 3).join(' ').slice(0, 300))
        .join('\n---\n')}`,
    );
  }
  if (input.question) {
    parts.push(`## Detected question${input.qtype ? ` (${input.qtype})` : ''}\n${input.question}`);
    parts.push('Draft the answer the USER should say now.');
  } else {
    parts.push(
      'No explicit question was detected. Infer from the last 45 seconds what the other party expects from the USER and draft the most useful thing to say now.',
    );
  }
  if (input.userInstruction) parts.push(`## Extra instruction from the USER\n${input.userInstruction}`);
  return parts.join('\n\n');
}

// ---------- Clasificador ligero de preguntas ----------
export const CLASSIFIER_SYSTEM_PROMPT = `You classify live call transcripts. Given the last seconds of what the OTHER PARTY (THEM) said, decide whether the USER is now expected to answer something. Return ONLY compact JSON with this exact shape:
{"isQuestion": boolean, "question": string, "type": "behavioral"|"technical"|"coding"|"objection"|"clarification"|"smalltalk"|"other", "needsAnswer": boolean}
Rules: "question" is the question normalized as one clear sentence in the original language (empty string if none). Smalltalk (greetings, audio checks, thanks) never needsAnswer. Sales objections ("too expensive", "we already use X") count as needsAnswer=true with type "objection". A statement that implicitly asks for a reaction ("I'd love to hear your take on this") is a question. Be strict with needsAnswer: only true when the USER is clearly expected to respond with substance.`;

export function buildClassifierUserPrompt(recentThem: string, lastSegment: string): string {
  return `Recent THEM transcript (oldest first):\n${recentThem.trim() || '(empty)'}\n\nLast segment:\n${lastSegment.trim()}\n\nJSON:`;
}

// ---------- Chat manual durante la llamada ----------
export function buildChatSystemPrompt(ctx: SessionContext): string {
  return `${buildAnswerSystemPrompt(ctx)}

## Chat mode
The USER is now typing to you directly during the call (e.g. "make it shorter", "answer as a senior", "give me 3 closing questions"). Reply in ${languageNameForPrompt(
    ctx.language,
  )} with the same spoken, concise style. Use the structured 💬/⭐ format only when the USER asks for an answer to say out loud; otherwise answer plainly in a few lines or bullets.`;
}

// ---------- Notas post-llamada ----------
export const NOTES_SYSTEM_PROMPT = `You write post-call notes from a transcript. Return ONLY valid JSON with this exact shape (no markdown fences):
{
  "callDetails": string,            // one sentence: who the call was with and what it was about
  "summary": string,                // one paragraph, 3-6 sentences
  "questions": string[],            // questions the OTHER PARTY asked the USER, verbatim-ish
  "nextSteps": string[],            // concrete next steps agreed or implied
  "actionItems": [{"owner": string, "task": string, "due": string|null}],
  "decisions": string[],
  "risks": string[]                 // objections, concerns, risks or open points
}
Write all text in the language of the transcript. Be factual; never invent names, numbers or commitments that are not in the transcript. Empty arrays are fine.`;

export function buildNotesUserPrompt(input: {
  company: string | null;
  title: string | null;
  mode: SessionMode;
  durationMinutes: number;
  transcript: string;
}): string {
  return `Call metadata: company=${input.company ?? 'unknown'}; title=${input.title ?? 'unknown'}; mode=${
    input.mode
  }; duration=${input.durationMinutes} min.\n\nTranscript (THEM = other party, ME = the USER):\n${input.transcript}\n\nJSON:`;
}

/** Para transcripciones largas: resume cada bloque y luego combina. */
export const NOTES_CHUNK_SYSTEM_PROMPT = `Summarize this block of a call transcript in 5-8 bullet points covering: topics, questions the OTHER PARTY asked, commitments, decisions, concerns. Keep names and numbers exact. Same language as the transcript. Output plain bullets only.`;

// ---------- Ask AI sobre la transcripción ----------
export function buildAskAiSystemPrompt(input: { transcript: string; notesJson: string | null; language: string }): string {
  return `You answer questions about a finished call, using only the transcript and notes below. Answer in ${languageNameForPrompt(
    input.language,
  )}, concisely, quoting the transcript when useful. If the answer is not in the material, say so.

## Transcript
${input.transcript}

## Notes
${input.notesJson ?? '(none)'}`;
}
