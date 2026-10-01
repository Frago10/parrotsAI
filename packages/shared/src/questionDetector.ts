// Detector heurístico de preguntas para español e inglés.
// Es la primera capa del pipeline (sin LLM): barata, determinista y testeable.
// Objetivo: recall alto (no perder preguntas reales) con precisión razonable.
import type { QuestionType } from './protocol';

export interface HeuristicResult {
  isQuestion: boolean;
  needsAnswer: boolean;
  type: QuestionType;
  /** Frase elegida como pregunta (texto original, recortado). */
  question: string;
  score: number;
  reasons: string[];
}

/** Quita acentos, pasa a minúsculas y colapsa espacios. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// "si"/"no" solo se tratan como muletilla cuando van seguidos de coma ("no, ¿cómo lo harías?"):
// sin coma suelen ser parte de la frase ("No tenemos presupuesto", "No es el momento").
const FILLERS =
  /^(?:(?:y|e|o|pero|entonces|bueno|ok|okay|vale|pues|ahora|a ver|mira|oye|bien|perfecto|genial|claro|eh|em|este|espera|and|so|but|well|then|now|also|alright|right|okay so|yeah|yes|great|cool|like|um|uh|hmm|wait)[,\s]+|(?:si|no)\s*,\s*)+/;

/** Quita muletillas iniciales ("bueno, y entonces ¿cómo...?"). */
export function stripFillers(norm: string): string {
  let s = norm.replace(/^[¿¡"'\s]+/, '');
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(FILLERS, '').replace(/^[¿¡"'\s]+/, '');
  }
  return s;
}

const INTERROGATIVE_START =
  /^(?:que|cual|cuales|como|cuando|cuanto|cuanta|cuantos|cuantas|donde|adonde|por que|porque|para que|quien|quienes|de que|en que|con que|a que|desde cuando|hasta cuando|what|which|how|when|where|why|who|whom|whose|what's|how's|where's|who's|when's|why's|whats|hows)\b/;

// Cláusulas subordinadas en inglés: "when we finish...", "what we did was..." no son preguntas
// (una pregunta directa lleva auxiliar tras el interrogativo: "when do we...", "what did you...").
const WH_SUBORDINATE_EN =
  /^(?:when|where|how|what|which|who|whom|why)\s+(?:i|we|you|they|he|she|it|i'm|we're|you're|they're|i'll|we'll|i've|we've)\b/;

// Interrogativos españoles que también son conjunciones ("cuando terminemos", "como te decía",
// "que tengas buen día"). Si el original no lleva tilde ni signos de interrogación, la señal es débil.
const WH_CONJUNCTION_ES = /^(?:cuando|como|donde|porque|que)\b/;
// Nota: `\b` no funciona junto a letras acentuadas en JS, por eso se usan lookarounds explícitos.
const WH_ACCENTED_ES =
  /(?<![a-záéíóúñ])(?:cómo|cuándo|dónde|adónde|qué|cuál|cuáles|cuánto|cuánta|cuántos|cuántas|quién|quiénes|por qué)(?![a-záéíóúñ])/i;

// Interrogativo en medio de la frase seguido de clítico (es) o auxiliar + sujeto (en):
// "y eso de la caché cómo lo manejan", "and the cache, how do you handle it".
const WH_INSIDE_QUESTION =
  /\b(?:como|cual|cuando|cuanto|cuantos|donde|por que|que)\s+(?:lo|la|los|las|le|les|se|te|me|nos)\s+\w+|\b(?:how|what|which|when|where|why|who)\s+(?:do|does|did|would|could|can|should|will|are|is|was|were|have|has)\s+(?:you|we|they|it|i|that|this|he|she|your|the)\b/;

// Verbo de conocimiento/relato justo antes del interrogativo: "no sé cómo lo hicieron",
// "I don't know how they did it", "depende de cuándo..." → no es una pregunta directa.
const KNOWLEDGE_BEFORE_WH =
  /\b(?:se|sabes|sabe|sabemos|saben|sabia|sabiamos|supe|entiendo|entiendes|imagino|veo|ves|vemos|depende de|segun|explico|explique|explicamos|cuento|cuenta|conto|contaron|dije|dijo|dijeron|pregunto|pregunte|preguntaron|preguntan|know|knows|knew|understand|see|saw|imagine|guess|wonder|wondering|sure|unsure|idea|clear|depends on|told|tell|asked|explain|explained|showed|show|figure out|figured out)\s+(?:como|cual|cuando|cuanto|cuantos|donde|por que|que|quien|how|what|which|when|where|why|who)\b/;

// Discurso referido: "ella me preguntó por qué..." / "she asked me why..." no es una pregunta al usuario.
// Se evalúa sobre el original en minúsculas (con tildes) para distinguir "me preguntó" de "me pregunto".
const REPORTED_SPEECH =
  /\b(?:me|nos|le|les|te)\s+pregunt(?:ó|é|aron|aba|aban|an|as)(?![a-záéíóúñ])|\b(?:she|he|they|someone|somebody|everyone|the client|the customer|my boss|my manager)\s+asked\b/;

// Ofrecimiento de explicar ("let me explain how...", "I'll walk you through...") no es una petición.
const OFFER_TO_EXPLAIN =
  /\b(?:let me|i'll|i will|i'm going to|i am going to|i can|i could|we'll|we will|we can|te|les|os|voy a|vamos a|puedo|podemos|dejame|dejame que)\s+(?:explain|explica|explico|explicar|explicarte|explicarles|walk you through|show you|describe|describir|tell you|contar|contarte|contarles|elaborate|share|compartir)\b/;

// Enunciado de ejercicio: "given an array, return...", "dado un arreglo, devuelve...".
const CODING_TASK =
  /^given (?:a|an|two|the|n|this|these|that)\b[^.]*\b(?:return|find|write|print|count|compute|determine|implement|output|check)\b|^dad[oa]s? (?:un|una|dos|el|la|este|esta|estos|estas)\b[^.]*\b(?:devuelve|devuelva|encuentra|escribe|imprime|cuenta|calcula|determina|implementa|retorna|comprueba)\b/;

const MODAL_START =
  /^(?:podrias|podria|puedes|puede|pueden|me puedes|me podrias|nos puedes|nos podrias|sabes|sabrias|tienes|tiene|tienen|has|ha|han|conoces|conoce|te gustaria|le gustaria|estarias|serias|crees|cree|consideras|considera|hay|es|son|esta|estan|existe|te parece|le parece|te interesa|les interesa|manejas|manejan|usas|usan|trabajas|trabajan|could you|can you|can everyone|can everybody|can you guys|can you all|would you|will you|do you|did you|does|have you|has|are you|is there|are there|is it|is that|is this|were you|should|shall|might|may i|would it|could we|can we|should we|do we|have we)\b/;

const REQUEST_ANYWHERE =
  /\b(?:cuentame|cuentanos|hablame|hablanos|explicame|explicanos|explica|describeme|describe|dime|dinos|menciona|mencioname|comparte|platicame|platica|detalla|desarrolla|amplia|ejemplifica|dame un ejemplo|dame una idea|me gustaria saber|me gustaria entender|me gustaria que|quisiera saber|quisiera entender|quiero saber|quiero entender|necesito saber|necesito entender|tell me|tell us|walk me through|walk us through|talk me through|run me through|take me through|explain|elaborate|give me an example|give us an example|give me an idea|describe|i'd like to know|i'd like to understand|i want to know|i want to understand|i need to know|i need to understand|help me understand|i'm curious|im curious|share with me|share with us|what about|how about|i'd love to hear|i would love to hear|love to hear|i'd like to hear|interested in hearing|interested to hear|curious how|curious about|curious to know|wondering how|wondering if|wondering what|i wonder|me pregunto|me encantaria saber|me encantaria escuchar|me encantaria conocer|me encantaria que|me interesa saber|me interesa conocer|me gustaria escuchar|me gustaria conocer|your take|your thoughts|your opinion|your view|tu opinion|su opinion|que opinas|que piensas|que te parece|como ves|como lo ves)\b/;

const IMPERATIVE_START =
  /^(?:escribe|escriba|escribeme|implementa|implemente|implementame|crea|creame|programa|codifica|resuelve|resuelveme|optimiza|refactoriza|diseña|disena|disename|calcula|convierte|transforma|construye|arma|haz|hazme|muestrame|demuestra|invierte|ordena|encuentra|devuelve|imprime|valida|genera|elimina|recorre|combina|filtra|agrupa|write|implement|create|code|solve|optimize|refactor|build|design|compute|calculate|convert|transform|show me|demonstrate|prove|find|return|print|reverse|sort|parse|validate)\b/;

const TAG_QUESTION =
  /\b(?:verdad|no|cierto|right|correct|isn't it|don't you|aren't you|wouldn't you|okay|ok)\s*\?\s*$/;

const INTERROGATIVE_ANYWHERE =
  /\b(?:como|cual|cuales|cuando|cuanto|cuantos|donde|por que|para que|quien|what|which|how|when|where|why|who)\b/;

const OBJECTION =
  /\b(?:es muy caro|esta caro|esta muy caro|demasiado caro|muy costoso|no tenemos presupuesto|no hay presupuesto|fuera de presupuesto|lo tengo que pensar|tengo que pensarlo|dejame pensarlo|lo voy a pensar|lo tenemos que pensar|lo tengo que consultar|tengo que consultarlo|dejame consultarlo|ya usamos|ya tenemos|ya trabajamos con|estamos contentos con|no es el momento|no es prioridad|no es una prioridad|no es buen momento|mas adelante|el proximo trimestre|el ano que viene|mandame la informacion|enviame la informacion|mandame una propuesta|enviame una propuesta|no me convence|no le veo valor|no veo el valor|no estoy seguro de que|la competencia|otro proveedor|otra opcion|mas barato|me parece caro|un poco caro|bastante caro|sale caro|pagar mas por|mal momento|too expensive|pricey|pay more for|timing is bad|timing isn't great|timing is not great|timing is not good|timing isn't good|isn't a priority|isn't really a priority|not really a priority|not sure (?:my|our|the) team|not sure (?:we|they) (?:would|will)|not sure we need|very expensive|way too expensive|out of our budget|over budget|no budget|we don't have budget|we don't have the budget|not in the budget|i need to think about it|need to think about it|let me think about it|we need to think|i have to check with|need to check with|let me check with|run it by|we already use|we already have|we're already using|we are already using|we're happy with|we are happy with|not a priority|not the right time|not the right moment|bad timing|maybe next quarter|maybe next year|send me the information|send me some information|send me a proposal|send me the proposal|email me the details|i'm not convinced|i am not convinced|not sure it's worth|don't see the value|cheaper|your competitor|other vendor|another vendor|other options)\b/;

const SMALLTALK =
  /^(?:hola|hola hola|buenos dias|buenas tardes|buenas noches|buenas|buen dia|que tal|como estas|como esta|como estan|como va|como va todo|como te va|como les va|todo bien|mucho gusto|encantado|encantada|un gusto|gracias|muchas gracias|mil gracias|perfecto|genial|excelente|de acuerdo|listo|vale|ok|okay|hasta luego|nos vemos|chao|adios|que tengas buen dia|igualmente|hi|hello|hey|hey there|good morning|good afternoon|good evening|how are you|how are you doing|how's it going|how is it going|how have you been|nice to meet you|great to meet you|pleasure to meet you|thank you|thanks|thanks a lot|thank you so much|sounds good|awesome|great|perfect|cool|bye|goodbye|see you|take care|have a good day|have a nice day|you too|likewise)[\s!.,?]*$/;

const SMALLTALK_PHRASES =
  /\b(?:hola|buenos dias|buenas tardes|buenas noches|buenas|buen dia|que tal|como estas|como esta usted|como esta|como estan|como va todo|como va|como te va|como les va|todo bien|mucho gusto|encantado|encantada|un gusto|un placer|muchas gracias|mil gracias|gracias|por tu tiempo|por su tiempo|por el tiempo|perfecto|genial|excelente|de acuerdo|listo|vale|ok|okay|hasta luego|hasta pronto|nos vemos|chao|chau|adios|que tengas buen dia|que tengas un buen dia|igualmente|hi|hello|hey|hey there|good morning|good afternoon|good evening|how are you doing|how are you|how's it going|how is it going|how have you been|how's everything|nice to meet you|great to meet you|pleasure to meet you|good to see you|nice to see you|thank you so much|thank you very much|thanks so much|thanks a lot|thank you|thanks|for your time|sounds good|awesome|great|perfect|cool|bye|goodbye|see you|take care|have a good day|have a nice day|have a good one|have a great day|you too|likewise|for taking the time|taking the time|for joining|for connecting|for being here|por tomarte el tiempo|por tomarse el tiempo|por conectarte|por conectarse|por estar aqui|today|hoy|again|de nuevo|everyone|everybody|a todos|all)\b/g;

const AUDIO_CHECK =
  /\b(?:me escuchas|me escuchan|se escucha|se me escucha|me oyes|me oyen|se oye|me ven|se ve|se ve mi pantalla|ven mi pantalla|pueden ver mi pantalla|puedes ver mi pantalla|se escucha bien|hay eco|se corta|se congelo|can you hear me|do you hear me|can you guys hear me|can everyone hear me|can you see my screen|do you see my screen|is my audio ok|is my audio okay|am i audible|you're on mute|you are on mute|estas en mute|estas en silencio|tienes el micro apagado|dame un segundo|dame un momento|un momento|un segundo|give me a second|give me a moment|one second|one moment|hold on|let me share my screen|voy a compartir pantalla|comparto pantalla|empezamos|comenzamos|arrancamos|shall we start|shall we get started|shall we begin|can we get started|can we start|should we get started|podemos empezar|podemos comenzar|empezamos ya|let's start|lets start|should we begin|ready to start|listo para empezar|listos para empezar)\b/;

const CLARIFICATION =
  /\b(?:te refieres|se refiere|quieres decir|quiere decir|a que te refieres|que quieres decir|do you mean|what do you mean|did you mean|puedes repetir|podrias repetir|me lo repites|repite|otra vez|can you repeat|could you repeat|say that again|say again|come again|no entendi|no te entendi|no entendi bien|no te escuche|didn't catch|did not catch|didn't get that|i missed that|perdon\??$|como\??$|sorry\??$|pardon|could you clarify|can you clarify|clarify|aclarar|aclarame|no me quedo claro|no me queda claro|(?:que|lo que) (?:dijiste|dijo|comentaste|mencionaste)|what (?:did you|you just) (?:say|said|mean)|what you said|that number|esa cifra|la cifra que)\b/;

// Señales fuertes de ejercicio de programación: por sí solas clasifican como "coding".
const CODING_STRONG =
  /\b(?:codigo|code|implementa|implementar|implementes|implement|escribe una funcion|escribe un programa|escribe un script|escribe una consulta|escribe una query|escribe el codigo|write a function|write a program|write a script|write a query|write the code|write code|funcion que|function that|algoritmo|algorithm|complejidad|complexity|big o|notacion o|leetcode|hackerrank|codility|pseudocodigo|pseudocode|bucle|loop|iterar|iterate|regex|expresion regular|two sum|fizzbuzz|palindromo|palindrome|fibonacci|subarray|substring|optimiza este|optimize this|optimizar este|refactoriza|refactor|bug en|debug|depura|unit test|prueba unitaria|pytest|jest|compila|compile|recursiv|recursion|recursive)\b/;

// Señales débiles (vocabulario de datos/estructuras que también aparece en preguntas conceptuales:
// "what are the tradeoffs between SQL and NoSQL" es técnica, no coding). Solo cuentan como coding
// si la frase es un imperativo ("sort this array") o un "cómo harías / how would you".
const CODING_WEAK =
  /\b(?:sql|consulta sql|query|queries|join|group by|array|arreglo|arrays|lista enlazada|linked list|arbol binario|binary tree|arbol|grafo|graph|ordenar|ordena|sort|sorting|invertir|invierte|reverse|string|cadena|hash|hashmap|diccionario|dictionary|stack|pila|cola|queue|programa|program|pandas|dataframe|numpy|python script|duplicados|duplicates|matriz|matrix)\b/;
const CODING_HOW_WOULD =
  /\b(?:how would you|how do you|como (?:harias|resolverias|implementarias|encontrarias|detectarias|invertirias|ordenarias|calcularias|lo harias|lo resolverias))\b/;

const BEHAVIORAL =
  /\b(?:cuentame de una vez|cuentame sobre una vez|cuentame de alguna vez|cuentame sobre alguna|cuentame una situacion|cuentame de un momento|cuentame una experiencia|describe una situacion|describeme una situacion|situacion en la que|un momento en el que|una vez que|alguna vez que|alguna vez has|has tenido que|tell me about a time|tell me about a situation|tell me about an experience|describe a time|describe a situation|a situation where|a time when|a time where|give me an example of a time|give me an example of when|ejemplo de una vez|ejemplo de alguna vez|experiencia|experience|background|trayectoria|fortaleza|fortalezas|debilidad|debilidades|strength|strengths|weakness|weaknesses|por que quieres|por que te interesa|por que te gustaria|por que deberiamos|por que esta empresa|por que nosotros|why do you want|why are you interested|why would you like|why should we|why this company|why us|donde te ves|where do you see yourself|hablame de ti|hablame sobre ti|cuentame de ti|cuentame sobre ti|tell me about yourself|walk me through your resume|walk me through your cv|walk me through your background|cuentame tu trayectoria|conflicto|conflict|desacuerdo|disagree|disagreement|fracaso|failure|failed|fallaste|te equivocaste|error que cometiste|mistake|logro|logros|achievement|achievements|orgulloso|orgullosa|proud|motiva|motivacion|motivat|liderazgo|leadership|lead a team|liderar|lideraste|equipo|team|teammate|companero|feedback|retroalimentacion|critica|criticism|dificil|difficult|hard decision|decision dificil|challenge|challenging|desafio|desafiante|reto|salario|sueldo|salary|compensation|expectativa salarial|disponibilidad|availability|notice period|cuando podrias empezar|when can you start|por que dejaste|why did you leave|why are you leaving|por que te vas|cultura|culture|valores|values|prioriza|prioritize|priorities|bajo presion|under pressure|deadline|deadlines|fecha limite|plazo|plazos|plazos ajustados|tight deadline|presion|pressure|carga de trabajo|workload|organizas|organize|stress|estres|manejas el estres|aprendiste|learned|aprendizaje|lesson|supera|overcame|overcome|work style|estilo de trabajo|manage your time|manejas tu tiempo|preguntas para mi|preguntas para nosotros|alguna pregunta para|any question for|questions for me|questions for us|any questions)\b/;

const TECHNICAL =
  /\b(?:como funciona|como funcionan|how does|how do|how would you|como harias|como lo harias|como implementarias|como diseñarias|como disenarias|como resolverias|como manejas|como manejarias|como abordarias|como escalarias|diferencia entre|difference between|differences between|que es|que son|what is|what are|what's the difference|explica|explain|explicame|arquitectura|architecture|diseñarias|disenarias|design|diseño|escalar|escalabilidad|scale|scalability|base de datos|bases de datos|database|databases|api|apis|rest|graphql|microservicio|microservicios|microservice|microservices|cache|caching|latencia|latency|throughput|modelo|modelos|model|models|pipeline|pipelines|etl|elt|sql|nosql|python|javascript|typescript|java|react|node|docker|kubernetes|cloud|aws|azure|gcp|machine learning|deep learning|llm|ia|ai|inteligencia artificial|dato|datos|data|metrica|metricas|metric|metrics|kpi|kpis|dashboard|dashboards|proceso|procesos|process|herramienta|herramientas|tool|tools|stack|integra|integras|integracion|integration|integrate|seguridad|security|testing|pruebas|test|deploy|deployment|despliegue|despliegues|integran|integramos|crm|erp|sso|salesforce|hubspot|ci\/cd|git|version|monitoreo|monitoring|observabilidad|logs|rendimiento|performance|optimiz|optimiz|indice|index|particion|partition|transaccion|transaction|consistencia|consistency|concurrencia|concurrency|hilos|threads|async|asincrono|memoria|memory|algoritmo|complejidad|tecnologia|tecnologias|technology|technologies|framework|frameworks|libreria|library|producto|product|precio|price|pricing|plan|planes|funcionalidad|feature|features|soporte|support|contrato|contract|implementacion|implementation|onboarding|roi|retorno|ahorro|savings|beneficio|benefit|ventaja|advantage|garantia|guarantee|licencia|license|usuarios|users|clientes|customers|casos de uso|use case|use cases|resultado|resultados|results|plazo|timeline|entrega|delivery)\b/;

const SENTENCE_SPLIT = /(?<=[.?!…])\s+|(?=¿)/;

interface SentenceEval {
  original: string;
  norm: string;
  score: number;
  reasons: string[];
}

function evaluateSentence(original: string): SentenceEval {
  const normFull = normalizeText(original);
  const norm = stripFillers(normFull);
  const reasons: string[] = [];
  let score = 0;
  const words = norm
    .replace(/[¿?¡!.,;:]/g, '')
    .split(' ')
    .filter(Boolean).length;
  const hasMark = /\?\s*$/.test(norm) || norm.includes('¿') || original.includes('?');
  const reported = REPORTED_SPEECH.test(original.toLowerCase());

  if (hasMark) {
    score += 0.6;
    reasons.push('question_mark');
  }
  if (INTERROGATIVE_START.test(norm)) {
    if (!hasMark && WH_SUBORDINATE_EN.test(norm)) {
      // "when we finish...", "what we did was..." → señal débil, como un interrogativo interno.
      score += 0.2;
      reasons.push('wh_subordinate');
    } else if (!hasMark && WH_CONJUNCTION_ES.test(norm) && !WH_ACCENTED_ES.test(original)) {
      // "cuando terminemos...", "como te decía..." sin tilde ni signos → señal débil.
      score += 0.2;
      reasons.push('wh_unaccented');
    } else {
      score += 0.5;
      reasons.push('interrogative_start');
    }
  } else if (MODAL_START.test(norm)) {
    score += 0.4;
    reasons.push('modal_start');
  }
  if (REQUEST_ANYWHERE.test(norm) && !reported && !OFFER_TO_EXPLAIN.test(norm)) {
    score += 0.45;
    reasons.push('request');
  }
  if (IMPERATIVE_START.test(norm) && words >= 3) {
    score += 0.5;
    reasons.push('imperative');
  }
  if (CODING_TASK.test(norm)) {
    score += 0.5;
    reasons.push('coding_task');
  }
  if (TAG_QUESTION.test(norm)) {
    score += 0.3;
    reasons.push('tag_question');
  }
  if (OBJECTION.test(norm)) {
    score += 0.7;
    reasons.push('objection');
  }
  if (!reasons.includes('interrogative_start') && !reported) {
    if (
      INTERROGATIVE_ANYWHERE.test(norm) &&
      words >= 4 &&
      !reasons.includes('wh_subordinate') &&
      !reasons.includes('wh_unaccented')
    ) {
      score += 0.2;
      reasons.push('interrogative_inside');
    }
    // "cómo lo manejan ustedes" / "how do you handle it" en medio de la frase (o al inicio sin tilde,
    // "como lo harias"), salvo tras un verbo de conocimiento ("no sé cómo lo hicieron").
    if (WH_INSIDE_QUESTION.test(norm) && !KNOWLEDGE_BEFORE_WH.test(norm)) {
      score += 0.25;
      reasons.push('wh_inside_question');
    }
  }
  // Frases muy largas sin ninguna señal suelen ser afirmaciones; frases cortas con '?' suelen ser preguntas.
  if (words <= 2 && reasons.length === 0) score = 0;
  return { original: original.trim(), norm, score, reasons };
}

/** Frase que es solo una coletilla ("¿verdad?", "¿no?", "right?"): se evalúa junto con la frase anterior. */
const TAG_ONLY =
  /^[¿¡"'\s]*(?:verdad|no|cierto|right|correct|ok|okay|isn't it|don't you)\s*[?!.]*$/;

export function classifyQuestionType(norm: string): QuestionType {
  const words = norm
    .replace(/[¿?¡!.,;:]/g, '')
    .split(' ')
    .filter(Boolean).length;
  if (AUDIO_CHECK.test(norm) && words <= 15) return 'smalltalk';
  if (SMALLTALK.test(norm.replace(/[¿¡]/g, '').trim())) return 'smalltalk';
  // Las aclaraciones cortas van antes del residuo de smalltalk: "sorry, come again?" contiene
  // "again", que es vocabulario de saludo, pero es una petición de repetir.
  if (CLARIFICATION.test(norm) && words <= 15) return 'clarification';
  if (words <= 10) {
    const residue = stripFillers(norm.replace(SMALLTALK_PHRASES, ' '))
      .replace(/[¿?¡!.,;:]/g, ' ')
      .split(' ')
      .filter(Boolean);
    if (residue.length <= 2 && norm !== stripFillers(norm.replace(SMALLTALK_PHRASES, ' ')).trim())
      return 'smalltalk';
  }
  if (OBJECTION.test(norm)) return 'objection';
  if (words <= 2 && /^(?:como|perdon|que|sorry|what|pardon|eh|huh)\s*\??$/.test(norm))
    return 'clarification';
  if (CODING_STRONG.test(norm) || CODING_TASK.test(norm)) return 'coding';
  if (CODING_WEAK.test(norm) && (IMPERATIVE_START.test(norm) || CODING_HOW_WOULD.test(norm)))
    return 'coding';
  if (BEHAVIORAL.test(norm)) return 'behavioral';
  if (TECHNICAL.test(norm)) return 'technical';
  return 'other';
}

export const QUESTION_THRESHOLD = 0.4;

/**
 * Evalúa un segmento final de transcripción. Si hay varias frases, elige la más
 * "pregunta" (en empate, la última, que es donde suele estar la pregunta real).
 */
export function detectQuestionHeuristic(text: string): HeuristicResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      isQuestion: false,
      needsAnswer: false,
      type: 'other',
      question: '',
      score: 0,
      reasons: [],
    };
  }
  const sentences: string[] = [];
  for (const part of trimmed.split(SENTENCE_SPLIT)) {
    const s = part.trim();
    if (!s) continue;
    // "El despliegue es los viernes, ¿verdad?" se parte en dos; la coletilla sola no dice de qué va la pregunta.
    if (sentences.length && TAG_ONLY.test(normalizeText(s)))
      sentences[sentences.length - 1] += ` ${s}`;
    else sentences.push(s);
  }
  const evals = (sentences.length ? sentences : [trimmed]).map(evaluateSentence);
  let best = evals[evals.length - 1]!;
  for (const e of evals) {
    if (e.score >= best.score) best = e;
  }
  const wholeNorm = stripFillers(normalizeText(trimmed));
  const rawType = classifyQuestionType(best.score >= QUESTION_THRESHOLD ? best.norm : wholeNorm);
  const type: QuestionType =
    best.score >= QUESTION_THRESHOLD ? rawType : rawType === 'smalltalk' ? 'smalltalk' : 'other';
  // Si la frase elegida es smalltalk pero otra frase del segmento es una pregunta real, usa esa.
  if (type === 'smalltalk' && evals.length > 1) {
    const alt = [...evals]
      .reverse()
      .find((e) => e.score >= QUESTION_THRESHOLD && classifyQuestionType(e.norm) !== 'smalltalk');
    if (alt) {
      const altType = classifyQuestionType(alt.norm);
      return {
        isQuestion: true,
        needsAnswer: true,
        type: altType,
        question: alt.original,
        score: alt.score,
        reasons: alt.reasons,
      };
    }
  }
  const isQuestion = best.score >= QUESTION_THRESHOLD;
  const needsAnswer = isQuestion && type !== 'smalltalk';
  return {
    isQuestion,
    needsAnswer,
    type,
    question: isQuestion ? best.original : '',
    score: Math.round(best.score * 100) / 100,
    reasons: best.reasons,
  };
}
