// Service worker: abre el panel, registra atajos y menú contextual, y recuerda la última pestaña web.
// Toda la lógica pesada (lectura, captura, WebSocket) vive en el panel lateral.
import { isExtensionUrl, isRestrictedUrl } from './settings';

export type PanelCommand =
  | { cmd: 'read-screen'; at: number }
  | { cmd: 'ask-selection'; selection: string; at: number }
  | { cmd: 'listen-tab'; streamId: string; tabId: number; at: number };

const MENU_READ = 'cp-read-screen';
const MENU_SELECTION = 'cp-ask-selection';
const MENU_LISTEN = 'cp-listen-tab';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_READ,
      title: 'CallPilot: leer esta pantalla',
      contexts: ['page', 'frame'],
    });
    chrome.contextMenus.create({
      id: MENU_SELECTION,
      title: 'CallPilot: preguntar sobre "%s"',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: MENU_LISTEN,
      title: 'CallPilot: escuchar el audio de esta pestaña',
      contexts: ['page', 'video', 'audio'],
    });
  });
});

// ---- Última pestaña web activa (el panel puede abrirse como ventana o pestaña propia) ----
async function rememberTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || isExtensionUrl(tab.url) || isRestrictedUrl(tab.url)) return;
    await chrome.storage.session.set({
      lastWebTab: { tabId: tab.id, windowId: tab.windowId, url: tab.url },
    });
  } catch {
    /* la pestaña ya no existe */
  }
}
chrome.tabs.onActivated.addListener(({ tabId }) => void rememberTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.active) void rememberTab(tabId);
});
void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => {
  if (t?.id != null) void rememberTab(t.id);
});

// ---- Entrega de comandos al panel ----
async function sendToPanel(tab: chrome.tabs.Tab | undefined, command: PanelCommand): Promise<void> {
  // El panel puede estar cerrado: se deja el comando en storage y se abre; el panel lo recoge al cargar.
  await chrome.storage.session.set({ pendingCommand: command });
  if (tab?.id != null) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch {
      /* ya abierto o sin gesto de usuario */
    }
  }
  chrome.runtime.sendMessage({ kind: 'command', command }).catch(() => undefined);
}

async function handleListen(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (tab?.id == null) return;
  // El stream id solo se puede pedir justo después de una invocación del usuario (atajo o menú).
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await sendToPanel(tab, { cmd: 'listen-tab', streamId, tabId: tab.id, at: Date.now() });
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  const t = tab ?? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (command === 'read-screen') await sendToPanel(t, { cmd: 'read-screen', at: Date.now() });
  if (command === 'listen-tab')
    await handleListen(t).catch((err) => console.warn('listen-tab', err));
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_READ) await sendToPanel(tab, { cmd: 'read-screen', at: Date.now() });
  if (info.menuItemId === MENU_SELECTION)
    await sendToPanel(tab, {
      cmd: 'ask-selection',
      selection: info.selectionText ?? '',
      at: Date.now(),
    });
  if (info.menuItemId === MENU_LISTEN)
    await handleListen(tab).catch((err) => console.warn('listen-tab', err));
});
