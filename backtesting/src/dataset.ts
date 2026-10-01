// Carga y validación del dataset etiquetado del nivel 1.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { QuestionTypeSchema } from '@callpilot/shared';
import type { QuestionType } from '@callpilot/shared';
import { QUESTIONS_DATASET } from './paths';

export const DatasetLangSchema = z.enum(['es', 'en']);
export type DatasetLang = z.infer<typeof DatasetLangSchema>;

export const DatasetItemSchema = z.object({
  id: z.string().min(1),
  lang: DatasetLangSchema,
  text: z.string().min(1),
  isQuestion: z.boolean(),
  needsAnswer: z.boolean(),
  type: QuestionTypeSchema,
});
export type DatasetItem = z.infer<typeof DatasetItemSchema>;

export const DatasetSchema = z.array(DatasetItemSchema);

export const QUESTION_TYPES: QuestionType[] = [
  'behavioral',
  'technical',
  'coding',
  'objection',
  'clarification',
  'smalltalk',
  'other',
];

/** Lee y valida el dataset; lanza si el JSON no cumple el esquema o hay ids repetidos. */
export function loadDataset(file: string = QUESTIONS_DATASET): DatasetItem[] {
  const items = DatasetSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) throw new Error(`id duplicado en el dataset: ${it.id}`);
    seen.add(it.id);
    // Una frase que necesita respuesta es, por definición, una pregunta.
    if (it.needsAnswer && !it.isQuestion)
      throw new Error(`${it.id}: needsAnswer=true exige isQuestion=true`);
  }
  return items;
}
