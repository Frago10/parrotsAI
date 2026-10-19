// Panel lateral de CallPilot: lector de pantalla inteligente + audio de pestaña/micrófono + respuestas.
import {
  AudioCapture,
  LiveStore,
  NoAudioTrackError,
  isTabAudioSupported,
  markdownToHtml,
  type LiveState,
  type UiAnswer,
} from '@callpilot/live-core';
import { LANGUAGES, formatClock, type ScreenAnalyze } from '@callpilot/shared';
import {
  createSession,
  getConfig,
  listSessions,
  type ServerConfig,
  type SessionSummary,
} from '../api';
import type { PanelCommand } from '../background';
import {
  DEFAULT_SETTINGS,
  hostOf,
  isBlockedUrl,
  isRestrictedUrl,
  loadSettings,
  saveSettings,
  wsUrlFrom,
  type Settings,
} from '../settings';
import { ReadError, captureTab, getTargetTab, jaccard, readTab, signature } from './reader';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const store = new LiveStore();
let settings: Settings = DEFAULT_SETTINGS;
let serverConfig: ServerConfig | null = null;
let serverOk = false;
let sessions: SessionSummary[] = [];
let capture: AudioCapture | null = null;
let listeningTab = false;
let listeningMic = false;
let reading = false;
let lastAnalyzed: ReturnType<typeof signature> | null = null;
let lastCommandAt = 0;
const handledNotices = new Set<number>();
const cards = new Map<string, HTMLElement>();

// ---------- Avisos ----------
function notify(message: string, kind: 'info' | 'err' = 'info', ttlMs = 8000): void {
  const el = document.createElement('div');
  el.className = `notice ${kind === 'err' ? 'err' : ''}`;
  const text = document.createElement('span');
  text.textContent = message;
  const close = document.createElement('button');
  close.textContent = '✕';
  close.addEventListener('click', () => el.remove());
  el.append(text, close);
  $('notices').append(el);
  if (ttlMs > 0) setTimeout(() => el.remove(), ttlMs);
}

// ---------- Servidor y sesión ----------
async function refreshServer(): Promise<void> {
  try {
    serverConfig = await getConfig(settings.serverUrl);
    sessions = await listSessions(settings.serverUrl);
    serverOk = true;
  } catch {
    serverOk = false;
  }
  fillModelSelect();
  fillSessionSelect();
  renderStatus(store.state);
}

function wait(predicate: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (predicate()) return resolve(true);
    const unsub = store.subscribe(() => {
      if (predicate()) {
        clearTimeout(timer);
        unsub();
        resolve(true);
      }
    });
    const timer = setTimeout(() => {
      unsub();
      resolve(predicate());
    }, ms);
  });
}

async function setSession(s: SessionSummary): Promise<void> {
  settings = await saveSettings({
    sessionId: s.id,
    sessionLabel: s.company || s.title || 'Sesión',
  });
  if (!sessions.some((x) => x.id === s.id)) sessions = [s, ...sessions];
  fillSessionSelect();
  store.connect(wsUrlFrom(settings.serverUrl), s.id);
}

/** Garantiza una sesión conectada y en vivo (crea una sesión rápida si no hay). */
async function ensureSession(): Promise<void> {
  if (!serverOk) await refreshServer();
  if (!serverOk) {
    throw new Error(
      `No hay conexión con el servidor (${settings.serverUrl}). ¿Está corriendo "pnpm dev"?`,
    );
  }
  if (!settings.sessionId) {
    const tab = await getTargetTab();
    const host = hostOf(tab?.url);
    const created = await createSession(settings.serverUrl, {
      company: host || 'Navegación',
      title: tab?.title?.slice(0, 120) || 'Lector de pantalla',
      language: settings.language,
      model: settings.model,
      instructions: settings.instructions,
      autoAnswer: settings.autoAnswer,
    });
    await setSession(created);
  } else if (!store.connected) {
    store.connect(wsUrlFrom(settings.serverUrl), settings.sessionId);
  }
  const live = await wait(
    () => store.connected && (store.state.state === 'LIVE' || store.state.state === 'PAUSED'),
    8000,
  );
  if (!live)
    throw new Error('No se pudo unir a la sesión. Revisa el servidor y vuelve a intentar.');
}

async function clearSession(): Promise<void> {
  store.disconnect();
  stopAudio();
  settings = await saveSettings({ sessionId: null, sessionLabel: null });
  store.dispatch({ type: 'reset' });
  await refreshServer();
}

// ---------- Lector de pantalla ----------
interface AnalyzeOptions {
  prompt?: string;
  trigger: ScreenAnalyze['trigger'];
  selection?: string;
}

async function analyze(opts: AnalyzeOptions): Promise<void> {
  if (reading) return;
  reading = true;
  renderReading();
  try {
    const tab = await getTargetTab();
    if (!tab) throw new ReadError('no-tab', 'No hay una pestaña web para leer.');
    await ensureSession();
    const [page, image] = await Promise.all([
      readTab(tab, settings),
      settings.includeImage ? captureTab(tab).catch(() => null) : Promise.resolve(null),
    ]);
    if (opts.selection && !page.selection) page.selection = opts.selection;
    if (settings.includeImage && !image && opts.trigger !== 'auto') {
      notify(
        'No se pudo capturar la pantalla (la pestaña no está visible); se usa solo el texto de la página.',
        'info',
        5000,
      );
    }
    lastAnalyzed = signature(page);
    store.send({
      type: 'screen.analyze',
      prompt: opts.prompt?.trim() || undefined,
      imageBase64: image?.base64,
      imageMediaType: image?.mediaType ?? 'image/jpeg',
      page,
      trigger: opts.trigger,
    });
  } catch (err) {
    // La auto-lectura es silenciosa: solo avisa el usuario cuando él lo pidió.
    if (opts.trigger !== 'auto') notify(err instanceof Error ? err.message : String(err), 'err');
  } finally {
    reading = false;
    renderReading();
  }
}

// ---------- Auto-lectura ----------
let watchTimer: ReturnType<typeof setInterval> | null = null;
let stable: ReturnType<typeof signature> | null = null;
let recentAuto: number[] = [];

function startWatch(): void {
  stopWatch();
  if (!settings.autoWatch) return;
  watchTimer = setInterval(() => void watchTick(), Math.max(5, settings.autoIntervalSec) * 1000);
}
function stopWatch(): void {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  stable = null;
}

async function watchTick(): Promise<void> {
  if (!settings.autoWatch || reading || store.state.state === 'ENDED') return;
  const tab = await getTargetTab();
  if (!tab?.url || isRestrictedUrl(tab.url) || isBlockedUrl(tab.url, settings.blockedDomains))
    return;
  let sig: ReturnType<typeof signature>;
  try {
    const page = await readTab(tab, { ...settings, fullPage: false });
    if (page.viewportText.length < 30) return;
    sig = signature(page);
  } catch {
    return;
  }
  const changed =
    !lastAnalyzed || lastAnalyzed.url !== sig.url || jaccard(lastAnalyzed.words, sig.words) < 0.8;
  if (!changed) {
    stable = null;
    return;
  }
  // Espera a que la pantalla se estabilice: dos lecturas seguidas casi iguales.
  if (!stable || stable.url !== sig.url || jaccard(stable.words, sig.words) < 0.95) {
    stable = sig;
    return;
  }
  const now = Date.now();
  recentAuto = recentAuto.filter((t) => now - t < 60_000);
  if (recentAuto.length >= 4) return; // tope de costo: 4 lecturas automáticas por minuto
  recentAuto.push(now);
  stable = null;
  await analyze({ trigger: 'auto' });
}

// ---------- Audio ----------
function getCapture(): AudioCapture {
  capture ??= new AudioCapture({
    workletUrl: '/worklets/pcm-processor.js',
    onChunk: (channel, pcm) => store.sendAudio(channel, pcm),
    onLevel: (channel, level) => {
      const bar = $(channel === 'them' ? 'vuThem' : 'vuMe');
      bar.style.width = `${Math.min(100, Math.round(level * 400))}%`;
    },
    onTabEnded: () => {
      listeningTab = false;
      renderButtons();
      notify('La pestaña dejó de compartirse. Vuelve a pulsar "Pestaña" para seguir escuchando.');
    },
  });
  return capture;
}

function stopAudio(): void {
  capture?.stop();
  capture = null;
  listeningTab = false;
  listeningMic = false;
  $('vuThem').style.width = '0';
  $('vuMe').style.width = '0';
  renderButtons();
}

function askConsent(): Promise<boolean> {
  if (settings.audioConsent) return Promise.resolve(true);
  return new Promise((resolve) => {
    const modal = $('consent');
    const check = $<HTMLInputElement>('consentCheck');
    const ok = $<HTMLButtonElement>('consentOk');
    check.checked = false;
    ok.disabled = true;
    modal.hidden = false;
    const done = async (accepted: boolean) => {
      modal.hidden = true;
      check.onchange = null;
      ok.onclick = null;
      $('consentCancel').onclick = null;
      if (accepted) settings = await saveSettings({ audioConsent: true });
      resolve(accepted);
    };
    check.onchange = () => (ok.disabled = !check.checked);
    ok.onclick = () => void done(true);
    $('consentCancel').onclick = () => void done(false);
  });
}

async function toggleTabAudio(): Promise<void> {
  if (listeningTab) {
    capture?.stopChannel('them');
    listeningTab = false;
    renderButtons();
    return;
  }
  if (!isTabAudioSupported())
    return notify(
      'Este navegador no soporta captura de audio de pestaña. Usa Chrome de escritorio.',
      'err',
    );
  if (!(await askConsent())) return;
  try {
    await ensureSession();
    await getCapture().startTab();
    listeningTab = true;
  } catch (err) {
    notify(
      err instanceof NoAudioTrackError
        ? 'La pestaña compartida no incluye audio. Elige "Pestaña de Chrome" y marca "Compartir audio de la pestaña".'
        : err instanceof Error
          ? err.message
          : String(err),
      'err',
    );
  }
  renderButtons();
}

/** Audio de una pestaña con el stream id de tabCapture (atajo Alt+Shift+A o menú contextual). */
async function listenTabFromStream(streamId: string): Promise<void> {
  if (!(await askConsent())) return;
  try {
    await ensureSession();
    await getCapture().startTabFromStreamId(streamId);
    listeningTab = true;
  } catch (err) {
    notify(
      `No se pudo escuchar la pestaña: ${err instanceof Error ? err.message : String(err)}`,
      'err',
    );
  }
  renderButtons();
}

async function toggleMic(): Promise<void> {
  if (listeningMic) {
    capture?.stopChannel('me');
    listeningMic = false;
    renderButtons();
    return;
  }
  if (!(await askConsent())) return;
  try {
    await ensureSession();
    await getCapture().startMic();
    listeningMic = true;
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'PermissionDismissedError') {
      // El panel lateral no puede mostrar el aviso de permiso: se pide una vez en una pestaña normal.
      notify(
        'Falta el permiso de micrófono. Se abrió una pestaña para concederlo una sola vez.',
        'info',
        10_000,
      );
      void chrome.tabs.create({ url: chrome.runtime.getURL('permissions.html') });
    } else {
      notify(`Micrófono: ${err instanceof Error ? err.message : String(err)}`, 'err');
    }
  }
  renderButtons();
}

// ---------- Comandos (atajos y menú contextual) ----------
function handleCommand(c: PanelCommand | undefined): void {
  if (!c || c.at <= lastCommandAt || Date.now() - c.at > 15_000) return;
  lastCommandAt = c.at;
  void chrome.storage.session.remove('pendingCommand');
  if (c.cmd === 'read-screen') void analyze({ trigger: 'shortcut' });
  if (c.cmd === 'ask-selection') {
    void analyze({
      prompt: 'Explica o responde sobre el texto que seleccioné.',
      selection: c.selection,
      trigger: 'selection',
    });
  }
  if (c.cmd === 'listen-tab') void listenTabFromStream(c.streamId);
}

// ---------- Render ----------
function renderStatus(state: LiveState): void {
  const dot = $('dot');
  const live = state.connection === 'open' && (state.state === 'LIVE' || state.state === 'PAUSED');
  dot.className = `dot ${live ? 'on' : serverOk && state.connection !== 'closed' && settings.sessionId ? 'wait' : serverOk ? 'wait' : 'off'}`;
  dot.title = !serverOk
    ? `Sin conexión con ${settings.serverUrl}`
    : live
      ? `Conectado · STT ${state.sttProvider} · LLM ${state.llmProvider} (${state.model})`
      : 'Sin sesión conectada: se crea al usar el lector';
  const info = serverConfig
    ? `STT: ${serverConfig.stt} · LLM: ${serverConfig.llmProvider}`
    : 'Sin conexión';
  $('serverInfo').textContent = `${settings.serverUrl} · ${info}`;
}

function renderReading(): void {
  const btn = $<HTMLButtonElement>('btnRead');
  btn.disabled = reading;
  btn.textContent = reading ? '👁 Leyendo…' : '👁 Leer pantalla';
}

function renderButtons(): void {
  $('btnTab').classList.toggle('active', listeningTab);
  $('btnMic').classList.toggle('active', listeningMic);
  $('btnTab').textContent = listeningTab ? '🎧 Escuchando' : '🎧 Pestaña';
  $('btnMic').textContent = listeningMic ? '🎙 Activo' : '🎙 Mic';
}

function labelFor(a: UiAnswer): string {
  if (a.kind === 'SCREENSHOT') return `👁 ${a.question ?? 'Pantalla'}`;
  if (a.kind === 'CHAT_USER') return 'Tú';
  if (a.kind === 'CHAT_AI') return 'Chat';
  return a.kind === 'MANUAL_ANSWER' ? 'Answer (manual)' : 'Answer';
}

function makeCard(a: UiAnswer): HTMLElement {
  const el = document.createElement('article');
  el.dataset.id = a.id;
  el.innerHTML = `
    <header>
      <span class="label"></span>
      <span class="meta"></span>
      <span class="tools">
        <button data-act="copy" title="Copiar">⧉</button>
        <button data-act="pin" title="Fijar">📌</button>
        <button data-act="up" title="Útil">👍</button>
        <button data-act="down" title="No útil">👎</button>
      </span>
    </header>
    <div class="body"></div>`;
  return el;
}

function updateCard(el: HTMLElement, a: UiAnswer): void {
  el.className = `card kind-${a.kind}${a.pinned ? ' pinned' : ''}${a.streaming ? ' streaming' : ''}`;
  el.querySelector('.label')!.textContent = labelFor(a);
  const meta = [
    formatClock(a.sessionMs),
    a.latencyMs != null ? `${a.firstTokenMs ?? '—'}/${a.latencyMs} ms` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  el.querySelector('.meta')!.textContent = meta;
  const body = el.querySelector<HTMLElement>('.body')!;
  const rendered = a.error
    ? `E:${a.error}`
    : a.kind === 'CHAT_USER'
      ? `U:${a.content}`
      : `M:${a.content}`;
  if (body.dataset.rendered !== rendered) {
    body.dataset.rendered = rendered;
    if (a.error) {
      const err = document.createElement('div');
      err.className = 'err';
      err.textContent = a.error;
      body.replaceChildren(err);
    } else if (a.kind === 'CHAT_USER') body.textContent = a.content;
    else body.innerHTML = markdownToHtml(a.content);
  }
  const pin = el.querySelector('[data-act="pin"]')!;
  pin.classList.toggle('on', a.pinned);
  el.querySelector('[data-act="up"]')!.classList.toggle('on', a.feedback === 'up');
  el.querySelector('[data-act="down"]')!.classList.toggle('on', a.feedback === 'down');
  (el.querySelector('.tools') as HTMLElement).hidden = a.kind === 'CHAT_USER';
}

function renderAnswers(state: LiveState): void {
  const host = $('answers');
  const ids = new Set(state.answers.map((a) => a.id));
  for (const [id, el] of cards) {
    if (!ids.has(id)) {
      el.remove();
      cards.delete(id);
    }
  }
  const ordered: HTMLElement[] = [];
  for (const a of state.answers) {
    let el = cards.get(a.id);
    if (!el) {
      el = makeCard(a);
      cards.set(a.id, el);
    }
    updateCard(el, a);
    ordered.push(el);
  }
  host.querySelector('.empty')?.remove();
  if (!ordered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Pulsa "👁 Leer pantalla" para que CallPilot lea lo que ves y te responda.';
    host.append(empty);
  } else {
    host.append(...ordered);
  }
}

function renderTranscript(state: LiveState): void {
  const box = $('transcript');
  box.replaceChildren();
  for (const s of state.segments.slice(-60)) {
    const row = document.createElement('div');
    row.className = `seg ${s.speaker === 'ME' ? 'me' : ''}`;
    row.textContent = `${s.speaker === 'ME' ? 'Tú' : 'Ellos'}: ${s.text}`;
    box.append(row);
  }
  for (const [speaker, text] of Object.entries(state.partials)) {
    if (!text) continue;
    const row = document.createElement('div');
    row.className = 'seg partial';
    row.textContent = `${speaker === 'ME' ? 'Tú' : 'Ellos'}: ${text}`;
    box.append(row);
  }
  box.scrollTop = box.scrollHeight;
}

function renderDebug(state: LiveState): void {
  const m = state.metrics;
  $('debug').textContent = [
    `ws ${state.connection}${state.reconnectAttempt ? ` (#${state.reconnectAttempt})` : ''}`,
    `estado ${state.state}`,
    state.model && `modelo ${state.model}`,
    m && `1er token ${m.lastFirstTokenMs ?? '—'} ms`,
    m && `STT ${m.sttFinalLatencyMs ?? '—'} ms`,
    m && `frames them/me ${m.audioFramesThem}/${m.audioFramesMe}`,
  ]
    .filter(Boolean)
    .join(' · ');
  $('clock').textContent =
    state.state === 'LIVE' || state.state === 'PAUSED'
      ? formatClock(state.elapsedMs + (state.state === 'LIVE' ? Date.now() - state.elapsedAt : 0))
      : '';
}

function onState(state: LiveState): void {
  renderStatus(state);
  renderAnswers(state);
  renderTranscript(state);
  renderDebug(state);
  // Avisos del servidor (una sola vez cada uno).
  for (const n of state.notices) {
    if (handledNotices.has(n.id)) continue;
    handledNotices.add(n.id);
    notify(n.message, n.fatal ? 'err' : 'info', 10_000);
    if (n.fatal && (n.code === 'not_found' || n.code === 'ended')) void clearSession();
  }
  if (state.state === 'ENDED' && settings.sessionId) {
    notify('Sesión terminada. Las notas están en la web (Call Sessions).', 'info', 10_000);
    void clearSession();
  }
}

// ---------- Ajustes y selects ----------
function fillSessionSelect(): void {
  const sel = $<HTMLSelectElement>('sessionSelect');
  sel.replaceChildren();
  const none = new Option('➕ Sesión nueva (automática)', '');
  sel.append(none);
  for (const s of sessions)
    sel.append(new Option(`${s.company || '—'} · ${s.title || 'sin título'}`.slice(0, 60), s.id));
  sel.value =
    settings.sessionId && sessions.some((s) => s.id === settings.sessionId)
      ? settings.sessionId
      : '';
  if (settings.sessionId && !sessions.some((s) => s.id === settings.sessionId)) {
    sel.append(new Option(settings.sessionLabel ?? 'Sesión actual', settings.sessionId));
    sel.value = settings.sessionId;
  }
}

function fillModelSelect(): void {
  const sel = $<HTMLSelectElement>('setModel');
  sel.replaceChildren();
  const models = serverConfig?.models ?? [];
  for (const m of models)
    sel.append(new Option(`${m.label}${m.available ? '' : ' (sin clave: usa simulador)'}`, m.id));
  if (!models.length) sel.append(new Option(settings.model, settings.model));
  sel.value = models.some((m) => m.id === settings.model)
    ? settings.model
    : (serverConfig?.defaultModel ?? settings.model);
}

function fillSettingsForm(): void {
  $<HTMLInputElement>('setServer').value = settings.serverUrl;
  const lang = $<HTMLSelectElement>('setLanguage');
  lang.replaceChildren(...LANGUAGES.map((l) => new Option(`${l.nativeName} (${l.name})`, l.code)));
  lang.value = settings.language;
  $<HTMLTextAreaElement>('setInstructions').value = settings.instructions;
  $<HTMLInputElement>('setBlocked').value = settings.blockedDomains;
  $<HTMLInputElement>('setInterval').value = String(settings.autoIntervalSec);
  $<HTMLInputElement>('optImage').checked = settings.includeImage;
  $<HTMLInputElement>('optFull').checked = settings.fullPage;
  $<HTMLInputElement>('optAuto').checked = settings.autoWatch;
  $<HTMLInputElement>('optAnswer').checked = settings.autoAnswer;
  fillModelSelect();
}

async function saveSettingsForm(): Promise<void> {
  const prevServer = settings.serverUrl;
  settings = await saveSettings({
    serverUrl:
      $<HTMLInputElement>('setServer').value.trim().replace(/\/+$/, '') ||
      DEFAULT_SETTINGS.serverUrl,
    language: $<HTMLSelectElement>('setLanguage').value,
    model: $<HTMLSelectElement>('setModel').value,
    instructions: $<HTMLTextAreaElement>('setInstructions').value,
    blockedDomains: $<HTMLInputElement>('setBlocked').value,
    autoIntervalSec: Math.min(
      120,
      Math.max(5, Number($<HTMLInputElement>('setInterval').value) || 10),
    ),
  });
  if (store.connected) store.send({ type: 'language.set', language: settings.language });
  startWatch();
  if (settings.serverUrl !== prevServer) {
    store.disconnect();
    await refreshServer();
  }
  notify(
    'Ajustes guardados. Modelo e instrucciones se aplican a la próxima sesión nueva.',
    'info',
    5000,
  );
  $('settings').hidden = true;
}

// ---------- Eventos de la interfaz ----------
function bindUi(): void {
  $('btnRead').addEventListener('click', () => void analyze({ trigger: 'manual' }));
  $('btnAnswer').addEventListener('click', async () => {
    try {
      await ensureSession();
      store.send({ type: 'answer.request' });
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err');
    }
  });
  $('btnTab').addEventListener('click', () => void toggleTabAudio());
  $('btnMic').addEventListener('click', () => void toggleMic());
  $('btnSettings').addEventListener('click', () => {
    fillSettingsForm();
    $('settings').hidden = false;
  });
  $('btnCloseSettings').addEventListener('click', () => ($('settings').hidden = true));
  $('btnSave').addEventListener('click', () => void saveSettingsForm());
  $('btnNewSession').addEventListener('click', async () => {
    await clearSession();
    $('settings').hidden = true;
    notify('Listo: la próxima lectura crea una sesión nueva.', 'info', 4000);
  });
  $('btnEndSession').addEventListener('click', () => {
    if (store.connected) store.send({ type: 'session.end' });
    else void clearSession();
    $('settings').hidden = true;
  });
  $<HTMLSelectElement>('sessionSelect').addEventListener('change', async (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return void clearSession();
    const chosen = sessions.find((s) => s.id === id);
    if (chosen) await setSession(chosen);
  });

  const toggles: Array<[string, keyof Settings]> = [
    ['optImage', 'includeImage'],
    ['optFull', 'fullPage'],
    ['optAuto', 'autoWatch'],
    ['optAnswer', 'autoAnswer'],
  ];
  for (const [id, key] of toggles) {
    $<HTMLInputElement>(id).addEventListener('change', async (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      settings = await saveSettings({ [key]: checked } as Partial<Settings>);
      if (key === 'autoWatch') {
        startWatch();
        lastAnalyzed = null;
      }
      if (key === 'autoAnswer' && store.connected)
        store.send({ type: 'autoAnswer.set', enabled: checked });
    });
  }

  const prompt = $<HTMLTextAreaElement>('prompt');
  const ask = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    prompt.value = '';
    if ($<HTMLInputElement>('askScreen').checked) return analyze({ prompt: q, trigger: 'manual' });
    try {
      await ensureSession();
      store.send({ type: 'chat.send', text: q });
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err');
    }
  };
  $('btnAsk').addEventListener('click', () => void ask(prompt.value));
  prompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void ask(prompt.value);
    }
  });
  for (const chip of Array.from(document.querySelectorAll<HTMLElement>('.chip'))) {
    chip.addEventListener(
      'click',
      () => void analyze({ prompt: chip.dataset.prompt, trigger: 'manual' }),
    );
  }

  // Acciones de las tarjetas (copiar, fijar, feedback).
  $('answers').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const card = btn?.closest<HTMLElement>('article');
    if (!btn || !card?.dataset.id) return;
    const id = card.dataset.id;
    const a = store.state.answers.find((x) => x.id === id);
    if (btn.dataset.act === 'copy' && a) void navigator.clipboard.writeText(a.content);
    if (btn.dataset.act === 'pin') store.pin(id);
    if (btn.dataset.act === 'up') store.feedback(id, 'up');
    if (btn.dataset.act === 'down') store.feedback(id, 'down');
  });

  // Debug: inyectar frases como si las dijera la otra persona.
  const inject = (channel: 'me' | 'them') => async () => {
    const input = $<HTMLInputElement>('injectText');
    const text = input.value.trim();
    if (!text) return;
    try {
      await ensureSession();
      store.send({ type: 'debug.transcript', channel, text, isFinal: true });
      input.value = '';
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err');
    }
  };
  $('injectThem').addEventListener('click', inject('them'));
  $('injectMe').addEventListener('click', inject('me'));

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      $('btnAnswer').click();
    }
  });
}

// ---------- Arranque ----------
async function boot(): Promise<void> {
  settings = await loadSettings();
  bindUi();
  fillSettingsForm();
  store.subscribe(onState);
  onState(store.state);
  renderButtons();
  renderReading();
  await refreshServer();
  if (!serverOk) {
    notify(
      `No hay conexión con el servidor (${settings.serverUrl}). Arráncalo con "pnpm dev" o cambia la URL en ⚙.`,
      'err',
      0,
    );
    const retry = setInterval(async () => {
      await refreshServer();
      if (serverOk) {
        clearInterval(retry);
        notify('Servidor conectado.', 'info', 3000);
      }
    }, 5000);
  }
  if (settings.sessionId && serverOk)
    store.connect(wsUrlFrom(settings.serverUrl), settings.sessionId);
  // El reloj del encabezado se refresca aunque no lleguen mensajes.
  setInterval(() => renderDebug(store.state), 1000);

  chrome.runtime.onMessage.addListener((msg: { kind?: string; command?: PanelCommand }) => {
    if (msg.kind === 'command') handleCommand(msg.command);
  });
  const pending = (await chrome.storage.session.get('pendingCommand')) as {
    pendingCommand?: PanelCommand;
  };
  handleCommand(pending.pendingCommand);
  startWatch();
}

void boot();
