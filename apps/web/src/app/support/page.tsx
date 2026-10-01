import { getLocale } from 'next-intl/server';

export default async function SupportPage() {
  const locale = await getLocale();
  const es = locale !== 'en';
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{es ? 'Soporte' : 'Support'}</h1>
        <p className="text-sm text-muted">
          {es
            ? 'Tutoriales y ayuda para sacar partido a CallPilot.'
            : 'Tutorials and help to get the most out of CallPilot.'}
        </p>
      </div>
      <section id="tutorials" className="card space-y-3 p-5">
        <h2 className="font-semibold">
          {es
            ? 'Cómo compartir el audio de la llamada (Chrome)'
            : 'How to share the call audio (Chrome)'}
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            {es
              ? 'Abre Google Meet, Teams o Zoom en una pestaña de Chrome de escritorio.'
              : 'Open Google Meet, Teams or Zoom in a desktop Chrome tab.'}
          </li>
          <li>
            {es
              ? 'En CallPilot, inicia la sesión y pulsa "Compartir pestaña y empezar".'
              : 'In CallPilot, start the session and click "Share tab and start".'}
          </li>
          <li>
            {es
              ? 'En el diálogo de Chrome elige la pestaña "Pestaña de Chrome" (no "Ventana" ni "Pantalla completa"), selecciona la de la llamada y marca "Compartir audio de la pestaña".'
              : 'In the Chrome dialog pick "Chrome Tab" (not "Window" or "Entire Screen"), select the call tab and tick "Share tab audio".'}
          </li>
          <li>
            {es
              ? 'Usa auriculares para evitar que tu micrófono capte el altavoz y se duplique la transcripción.'
              : 'Use headphones so your microphone does not pick up the speaker and duplicate the transcript.'}
          </li>
          <li>
            {es
              ? 'Si el VU-meter de "Ellos" no se mueve, pulsa "Cambiar pestaña" y repite el paso 3.'
              : 'If the "Them" VU-meter does not move, click "Change Tab" and repeat step 3.'}
          </li>
        </ol>
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">{es ? 'Atajos de teclado' : 'Keyboard shortcuts'}</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Ctrl/Cmd + Enter: Answer</li>
          <li>Ctrl/Cmd + Shift + S: Screenshot</li>
          <li>Ctrl/Cmd + K: {es ? 'foco al chat' : 'focus the chat'}</li>
          <li>Esc: {es ? 'limpiar el panel' : 'clear the panel'}</li>
        </ul>
      </section>
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">
          {es ? 'Modo de prueba sin audio' : 'Test mode without audio'}
        </h2>
        <p className="text-sm">
          {es
            ? 'Si no tienes claves de API o quieres probar el flujo, inicia la sesión con "Empezar sin audio" y usa el panel Debug para inyectar frases como si las dijera la otra persona. Todo lo que ocurre queda registrado en data/sessions/<id>.jsonl para el backtesting.'
            : 'If you have no API keys or want to test the flow, start the session with "Start without audio" and use the Debug panel to inject phrases as if the other person said them. Everything is logged to data/sessions/<id>.jsonl for backtesting.'}
        </p>
      </section>
      <section id="chat" className="card space-y-2 p-5">
        <h2 className="font-semibold">{es ? 'Chat de soporte' : 'Support chat'}</h2>
        <p className="text-sm text-muted">
          {es
            ? 'Uso personal: el soporte eres tú. Reporta errores desde la vista de cada sesión.'
            : 'Personal use: you are the support. Report bugs from each session view.'}
        </p>
      </section>
      <section className="card space-y-2 p-5">
        <h2 className="font-semibold">
          {es ? 'Uso aceptable y privacidad' : 'Acceptable use and privacy'}
        </h2>
        <p className="text-sm">
          {es
            ? 'CallPilot es una app visible: no oculta ventanas ni procesos. Úsala en conversaciones donde la asistencia de IA está permitida o informada, y con el consentimiento de los participantes. El audio nunca se guarda por defecto; solo texto.'
            : 'CallPilot is a visible app: it does not hide windows or processes. Use it in conversations where AI assistance is allowed or disclosed, with the participants’ consent. Audio is never stored by default; only text.'}
        </p>
      </section>
    </div>
  );
}
