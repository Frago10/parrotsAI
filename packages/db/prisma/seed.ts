// Seed con 11 sesiones de ejemplo en estados mixtos para poblar la UI.
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

import { createPrismaClient } from '../src/client';
import { ensureDefaultUser } from '../src/defaultUser';

const prisma = createPrismaClient();

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function main() {
  const user = await ensureDefaultUser(prisma);

  const resume = await prisma.resume.upsert({
    where: { id: 'seed-resume-1' },
    update: {},
    create: {
      id: 'seed-resume-1',
      userId: user.id,
      title: 'CV Data Analyst / Engineer',
      isDefault: true,
      parsedText: `Jean Paul — Data Analyst / Data Engineer.
Experiencia: 4 años construyendo pipelines ETL en Python y SQL, dashboards en Power BI y Looker, modelos de atribución para marketing digital.
Logros: reduje el tiempo de carga del data warehouse un 40% migrando a particiones por fecha; automaticé reportes semanales ahorrando 10 horas/semana al equipo.
Stack: Python (pandas, Airflow), SQL (Postgres, BigQuery), dbt, Power BI, Git, Docker.
Intereses: trading algorítmico, negocios digitales, aplicaciones con IA.`,
      profile: {
        headline: 'Data Analyst / Engineer con foco en pipelines y BI',
        years: 4,
        stack: ['Python', 'SQL', 'Airflow', 'dbt', 'Power BI', 'BigQuery'],
        achievements: ['-40% tiempo de carga del DWH', '10 h/semana ahorradas con reportes automáticos'],
      },
    },
  });

  const doc = await prisma.document.upsert({
    where: { id: 'seed-doc-1' },
    update: {},
    create: {
      id: 'seed-doc-1',
      userId: user.id,
      title: 'Playbook de objeciones.md',
      mimeType: 'text/markdown',
      sizeBytes: 2400,
      status: 'READY',
      text: `# Playbook de objeciones
- "Es muy caro": comparar con el costo actual del problema; ofrecer piloto de 30 días.
- "Ya usamos X": preguntar qué les falta de X; posicionar como complemento.
- "Lo tengo que pensar": preguntar qué información falta para decidir; fijar fecha de seguimiento.`,
    },
  });

  const sessions = [
    { id: 'seed-s01', company: 'Mercado Libre', title: 'Data Engineer Sr', mode: 'INTERVIEW', state: 'ENDED', dur: 28 * 60 + 12, created: 60 * 24 * 9, credits: 0.5 },
    { id: 'seed-s02', company: 'Rappi', title: 'Analytics Engineer', mode: 'INTERVIEW', state: 'ENDED', dur: 59 * 60, created: 60 * 24 * 8, credits: 1.0 },
    { id: 'seed-s03', company: 'Globant', title: 'Data Analyst', mode: 'INTERVIEW', state: 'ENDED', dur: 9 * 60 + 40, created: 60 * 24 * 7, credits: 0, free: true },
    { id: 'seed-s04', company: 'Cliente: Tienda Nova', title: 'Demo dashboard de ventas', mode: 'REGULAR', state: 'ENDED', dur: 41 * 60 + 5, created: 60 * 24 * 6, credits: 0.7 },
    { id: 'seed-s05', company: 'Cliente: Agencia Pulso', title: 'Propuesta de automatización de reportes', mode: 'REGULAR', state: 'ENDED', dur: 77 * 60 + 30, created: 60 * 24 * 5, credits: 1.3 },
    { id: 'seed-s06', company: 'Nubank', title: 'Data Engineer', mode: 'INTERVIEW', state: 'ENDED', dur: 35 * 60, created: 60 * 24 * 4, credits: 0.6 },
    { id: 'seed-s07', company: 'Equipo interno', title: 'Sync semanal de datos', mode: 'REGULAR', state: 'ENDED', dur: 22 * 60 + 18, created: 60 * 24 * 3, credits: 0.4 },
    { id: 'seed-s08', company: 'Cliente: Fintech Lumo', title: 'Kickoff proyecto ETL', mode: 'REGULAR', state: 'READY', dur: 0, created: 60 * 24 * 2, credits: 0 },
    { id: 'seed-s09', company: 'Platzi', title: 'Senior Data Analyst', mode: 'INTERVIEW', state: 'READY', dur: 0, created: 60 * 24, credits: 0 },
    { id: 'seed-s10', company: 'Práctica', title: 'Mock entrevista técnica SQL', mode: 'MOCK', state: 'READY', dur: 0, created: 120, credits: 0 },
    { id: 'seed-s11', company: 'Cliente: Tienda Nova', title: 'Seguimiento de propuesta', mode: 'REGULAR', state: 'LIVE', dur: 14 * 60, created: 20, credits: 0 },
  ] as const;

  for (const s of sessions) {
    const createdAt = minutesAgo(s.created);
    const startedAt = s.state === 'READY' ? null : new Date(createdAt.getTime() + 5 * 60_000);
    const endedAt = s.state === 'ENDED' && startedAt ? new Date(startedAt.getTime() + s.dur * 1000) : null;
    await prisma.callSession.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        userId: user.id,
        company: s.company,
        title: s.title,
        description: s.mode === 'INTERVIEW' ? 'Entrevista técnica y de comportamiento.' : 'Reunión con cliente / equipo.',
        mode: s.mode,
        language: 'es',
        model: 'claude-haiku-4-5',
        instructions:
          s.mode === 'INTERVIEW'
            ? 'Puesto: ingeniería de datos. Prioriza ejemplos con métricas. Responde en primera persona, tono seguro y concreto.'
            : 'Reunión comercial. Objetivo: cerrar un piloto de 30 días. Usa el playbook de objeciones.',
        resumeId: s.mode === 'INTERVIEW' ? resume.id : null,
        autoAnswer: true,
        saveTranscript: s.id !== 'seed-s07',
        state: s.state,
        source: s.mode === 'MOCK' ? 'MOCK' : 'TAB_SHARE',
        startedAt,
        endedAt,
        durationSeconds: s.dur,
        creditsUsed: s.credits,
        usedFreeTrial: 'free' in s && s.free === true,
        createdAt,
        documents: s.mode === 'REGULAR' ? { create: [{ documentId: doc.id }] } : undefined,
      },
    });
  }

  // Transcripción, respuestas y notas para una sesión terminada (para probar la vista post-llamada).
  const existing = await prisma.transcriptSegment.count({ where: { sessionId: 'seed-s04' } });
  if (existing === 0) {
    const lines: Array<['ME' | 'THEM', string]> = [
      ['THEM', 'Hola, ¿me escuchas bien?'],
      ['ME', 'Sí, perfecto. ¿Empezamos?'],
      ['THEM', 'Dale. Cuéntame cómo funcionaría el dashboard de ventas que nos propones.'],
      ['ME', 'Claro. Conectamos la base de ventas, modelamos las métricas y publicamos un tablero con actualización diaria.'],
      ['THEM', 'La verdad es que está muy caro para nosotros en este momento.'],
      ['ME', 'Entiendo. Comparemos el costo con las horas que hoy invierten en reportes manuales.'],
      ['THEM', '¿Cuánto tiempo tardarían en implementarlo?'],
      ['ME', 'Entre tres y cuatro semanas para la primera versión.'],
      ['THEM', 'Perfecto, mándame la propuesta y lo revisamos con el equipo.'],
    ];
    let t = 0;
    for (const [speaker, text] of lines) {
      const dur = 2500 + text.length * 60;
      await prisma.transcriptSegment.create({
        data: { sessionId: 'seed-s04', speaker, text, startMs: t, endMs: t + dur, confidence: 0.93 },
      });
      t += dur + 800;
    }
    await prisma.aiMessage.createMany({
      data: [
        {
          sessionId: 'seed-s04',
          kind: 'AUTO_ANSWER',
          detectedQuestion: 'Cuéntame cómo funcionaría el dashboard de ventas que nos propones.',
          questionType: 'technical',
          content:
            '💬 **Pregunta:** ¿Cómo funcionaría el dashboard de ventas?\n⭐ **Respuesta:** Conectamos sus ventas a un tablero que se actualiza solo cada día.\n• Fuente: su sistema de ventas actual, sin cambiar procesos.\n• Modelo: métricas clave (ventas, margen, ticket promedio) por tienda y producto.\n• Entrega: tablero web con alertas cuando algo se sale de lo normal.\nSi quieren, lo vemos con sus datos reales en la próxima reunión.',
          model: 'claude-haiku-4-5',
          latencyMs: 2100,
          firstTokenMs: 640,
          tokensIn: 3100,
          tokensOut: 160,
          sessionMs: 9000,
        },
        {
          sessionId: 'seed-s04',
          kind: 'AUTO_ANSWER',
          detectedQuestion: 'La verdad es que está muy caro para nosotros en este momento.',
          questionType: 'objection',
          content:
            '💬 **Pregunta:** Objeción de precio.\n⭐ **Respuesta:** Entiendo; comparemos la inversión con lo que hoy les cuesta hacer esto a mano.\n• ¿Cuántas horas al mes dedican a reportes manuales?\n• Un piloto de 30 días con criterios de éxito claros reduce el riesgo.\n• Podemos empezar por una sola tienda.\n¿Qué resultado tendrían que ver en 30 días para que valga la pena?',
          model: 'claude-haiku-4-5',
          latencyMs: 1900,
          firstTokenMs: 580,
          tokensIn: 3300,
          tokensOut: 150,
          sessionMs: 21000,
        },
      ],
    });
    await prisma.callNotes.upsert({
      where: { sessionId: 'seed-s04' },
      update: {},
      create: {
        sessionId: 'seed-s04',
        callDetails: 'Esta llamada fue con Tienda Nova, sobre la demo del dashboard de ventas.',
        summary:
          'Se presentó la propuesta de dashboard de ventas con actualización diaria. El cliente planteó una objeción de precio y preguntó por los tiempos de implementación (3 a 4 semanas). Acordaron enviar la propuesta formal para revisarla con su equipo.',
        questions: ['¿Cómo funcionaría el dashboard de ventas?', '¿Cuánto tiempo tardarían en implementarlo?'],
        nextSteps: ['Enviar propuesta formal', 'Agendar revisión con el equipo del cliente'],
        actionItems: [{ owner: 'ME', task: 'Enviar propuesta con opción de piloto de 30 días', due: null }],
        decisions: ['El cliente revisará la propuesta internamente'],
        risks: ['Objeción de precio: "está muy caro en este momento"'],
        model: 'claude-haiku-4-5',
      },
    });
  }

  await prisma.creditLedger.upsert({
    where: { id: 'seed-ledger-grant' },
    update: {},
    create: { id: 'seed-ledger-grant', userId: user.id, delta: 10, reason: 'GRANT' },
  });

  console.log(`Seed listo: usuario ${user.email}, ${sessions.length} sesiones.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
