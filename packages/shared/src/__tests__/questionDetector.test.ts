import { describe, expect, it } from 'vitest';
import { detectQuestionHeuristic, stripFillers, normalizeText } from '../questionDetector';

// 40 frases (es/en) con la etiqueta esperada: [texto, isQuestion, needsAnswer, tipo]
const CASES: Array<[string, boolean, boolean, string]> = [
  ['¿Cuéntame sobre tu experiencia liderando equipos?', true, true, 'behavioral'],
  ['Cuéntame de una vez en la que tuviste un conflicto con un compañero', true, true, 'behavioral'],
  ['¿Por qué quieres trabajar con nosotros?', true, true, 'behavioral'],
  ['¿Cómo funciona un índice en una base de datos?', true, true, 'technical'],
  ['¿Cuál es la diferencia entre una vista y una tabla materializada?', true, true, 'technical'],
  ['Escribe una función que invierta una cadena', true, true, 'coding'],
  ['¿Cómo resolverías el problema de two sum con complejidad lineal?', true, true, 'coding'],
  ['La verdad es que está muy caro para nosotros', true, true, 'objection'],
  ['Ya usamos otra herramienta para eso', true, true, 'objection'],
  ['Lo tengo que pensar y lo consulto con mi jefe', true, true, 'objection'],
  ['¿Te refieres a la versión anterior?', true, true, 'clarification'],
  ['Perdón, ¿puedes repetir la última parte?', true, true, 'clarification'],
  ['Hola, buenos días', false, false, 'smalltalk'],
  ['¿Cómo estás?', true, false, 'smalltalk'],
  ['¿Me escuchas bien?', true, false, 'smalltalk'],
  ['Muchas gracias por tu tiempo', false, false, 'smalltalk'],
  ['Bueno, entonces empezamos cuando quieras', false, false, 'smalltalk'],
  ['Hoy vamos a hablar del roadmap del siguiente trimestre', false, false, 'other'],
  ['El presupuesto se aprobó la semana pasada', false, false, 'other'],
  ['Me gustaría saber cómo manejas los plazos ajustados', true, true, 'behavioral'],
  ['Tell me about yourself', true, true, 'behavioral'],
  ['Tell me about a time you failed and what you learned', true, true, 'behavioral'],
  ['Why should we hire you?', true, true, 'behavioral'],
  ['How does garbage collection work in Java?', true, true, 'technical'],
  ["What's the difference between a process and a thread?", true, true, 'technical'],
  ['Write a function that checks if a string is a palindrome', true, true, 'coding'],
  ['How would you find duplicates in an array in O(n)?', true, true, 'coding'],
  ["Honestly it's too expensive for a team our size", true, true, 'objection'],
  ['We already use a competitor for that', true, true, 'objection'],
  ['Let me think about it and get back to you', true, true, 'objection'],
  ['Do you mean the enterprise plan?', true, true, 'clarification'],
  ['Sorry, could you repeat that?', true, true, 'clarification'],
  ['Hi, nice to meet you', false, false, 'smalltalk'],
  ['How are you doing today?', true, false, 'smalltalk'],
  ['Can you hear me okay?', true, false, 'smalltalk'],
  ['Thanks so much, have a good day', false, false, 'smalltalk'],
  ['So today we are going to review the Q3 numbers', false, false, 'other'],
  ['We shipped the new dashboard last week', false, false, 'other'],
  ['Walk me through how you would design a URL shortener', true, true, 'technical'],
  ["I'd love to hear how you prioritize when everything is urgent", true, true, 'behavioral'],
];

describe('detector heurístico de preguntas', () => {
  it.each(CASES)('%s', (text, isQuestion, needsAnswer, type) => {
    const r = detectQuestionHeuristic(text);
    expect(r.isQuestion, `isQuestion ${JSON.stringify(r)}`).toBe(isQuestion);
    expect(r.needsAnswer, `needsAnswer ${JSON.stringify(r)}`).toBe(needsAnswer);
    expect(r.type, `type ${JSON.stringify(r)}`).toBe(type);
  });

  it('elige la pregunta real cuando el segmento mezcla smalltalk y pregunta', () => {
    const r = detectQuestionHeuristic('Perfecto, gracias. ¿Y cómo manejas el estrés en entregas con plazos cortos?');
    expect(r.needsAnswer).toBe(true);
    expect(r.question).toContain('cómo manejas');
  });

  it('normaliza acentos y muletillas', () => {
    expect(normalizeText('¿Qué  Tal?')).toBe('¿que tal?');
    expect(stripFillers('bueno, y entonces ¿como lo harias?')).toBe('como lo harias?');
  });
});
