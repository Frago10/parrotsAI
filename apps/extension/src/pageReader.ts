// Lector de página: se inyecta en cada pestaña (y en sus iframes) y devuelve lo que el usuario ve.
// Debe ser autocontenido: no importa nada, se empaqueta como IIFE y se ejecuta con chrome.scripting.
// El valor devuelto es el de `read()` (el build añade `__cpPageReader.read();` al final del script).

export interface ReaderField {
  label: string;
  type: string;
  value?: string;
  options?: string[];
}

export interface ReaderResult {
  url: string;
  frameUrl: string;
  isTop: boolean;
  title: string;
  lang?: string;
  selection?: string;
  headings: string[];
  viewportText: string;
  fullText: string;
  inputs: ReaderField[];
  tables: string[];
  code: string[];
  images: string[];
  scrollPct: number;
  viewport: { w: number; h: number };
  truncated: boolean;
}

const MAX_VIEW = 9000;
const MAX_FULL = 36000;
const MAX_NODES = 12000;
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'OBJECT',
  'HEAD',
  'TITLE',
  'META',
  'LINK',
  'CANVAS',
  'SELECT',
  'OPTION',
  'TEXTAREA',
]);

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export function read(): ReaderResult {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let truncated = false;

  const hiddenCache = new WeakMap<Element, boolean>();
  const isHidden = (el: Element): boolean => {
    const cached = hiddenCache.get(el);
    if (cached !== undefined) return cached;
    let hidden: boolean;
    const h = el as HTMLElement;
    if (typeof h.checkVisibility === 'function') {
      hidden = !h.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    } else {
      const cs = getComputedStyle(el);
      hidden = cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
    }
    hiddenCache.set(el, hidden);
    return hidden;
  };

  const rectInView = (r: DOMRect): boolean =>
    r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;

  const blockCache = new WeakMap<Element, Element>();
  const blockOf = (el: Element): Element => {
    const cached = blockCache.get(el);
    if (cached) return cached;
    let cur: Element | null = el;
    let found: Element = document.body;
    while (cur && cur !== document.body) {
      const display = getComputedStyle(cur).display;
      if (!display.startsWith('inline') && display !== 'contents') {
        found = cur;
        break;
      }
      cur = cur.parentElement;
    }
    blockCache.set(el, found);
    return found;
  };

  // Raíces: el documento y los shadow roots abiertos (web components).
  const roots: Array<Document | ShadowRoot> = [document];
  const scanForShadow = (root: Document | ShadowRoot) => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.shadowRoot) {
        roots.push(el.shadowRoot);
        scanForShadow(el.shadowRoot);
      }
    }
  };
  scanForShadow(document);

  // ---- Texto: agrupado por bloque, en orden del DOM ----
  const groups = new Map<Element, { parts: string[]; inView: boolean }>();
  let nodes = 0;
  const range = document.createRange();
  for (const root of roots) {
    const start: Node =
      root instanceof Document ? (document.body ?? document.documentElement) : root;
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (++nodes > MAX_NODES) {
        truncated = true;
        break;
      }
      const text = clean(n.nodeValue ?? '');
      if (!text) continue;
      const parent = n.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName) || isHidden(parent)) continue;
      range.selectNodeContents(n);
      const inView = rectInView(range.getBoundingClientRect());
      const block = blockOf(parent);
      const g = groups.get(block);
      if (g) {
        g.parts.push(text);
        g.inView ||= inView;
      } else {
        groups.set(block, { parts: [text], inView });
      }
    }
  }
  const lineOf = (g: { parts: string[] }) => g.parts.join(' ');
  const dedupe = (lines: string[]): string[] => lines.filter((l, i) => l && l !== lines[i - 1]);
  const allLines = dedupe(Array.from(groups.values()).map(lineOf));
  const viewLines = dedupe(
    Array.from(groups.values())
      .filter((g) => g.inView)
      .map(lineOf),
  );
  const viewportText = cut(viewLines.join('\n'), MAX_VIEW);
  const fullText = cut(allLines.join('\n'), MAX_FULL);

  // ---- Campos de formulario visibles ----
  const labelFor = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      if (clean(t)) return cut(clean(t), 200);
    }
    const id = el.getAttribute('id');
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l?.textContent && clean(l.textContent)) return cut(clean(l.textContent), 200);
    }
    const wrapping = el.closest('label');
    if (wrapping?.textContent && clean(wrapping.textContent))
      return cut(clean(wrapping.textContent), 200);
    return clean(
      el.getAttribute('placeholder') ?? el.getAttribute('name') ?? el.getAttribute('title') ?? '',
    );
  };
  const inputs: ReaderField[] = [];
  const fieldSel =
    'input, textarea, select, [role="radio"], [role="checkbox"], [role="textbox"], [role="combobox"], [contenteditable="true"]';
  for (const el of Array.from(document.querySelectorAll(fieldSel))) {
    if (inputs.length >= 60) break;
    if (isHidden(el) || !rectInView(el.getBoundingClientRect())) continue;
    const tag = el.tagName;
    const type =
      tag === 'INPUT'
        ? (el as HTMLInputElement).type
        : tag === 'TEXTAREA'
          ? 'textarea'
          : tag === 'SELECT'
            ? 'select'
            : (el.getAttribute('role') ?? 'editable');
    if (type === 'hidden' || type === 'password' || type === 'submit' || type === 'button')
      continue;
    const field: ReaderField = { label: labelFor(el), type };
    if (tag === 'SELECT') {
      const sel = el as HTMLSelectElement;
      field.options = Array.from(sel.options)
        .slice(0, 30)
        .map((o) => clean(o.text));
      field.value = clean(sel.selectedOptions[0]?.text ?? '');
    } else if (type === 'checkbox' || type === 'radio') {
      const checked =
        (el as HTMLInputElement).checked ?? el.getAttribute('aria-checked') === 'true';
      field.value = checked ? 'seleccionado' : 'sin seleccionar';
    } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const v = (el as HTMLInputElement).value;
      if (v) field.value = cut(v, 300);
    } else if (el.textContent) {
      field.value = cut(clean(el.textContent), 300);
    }
    inputs.push(field);
  }

  // ---- Tablas, código, imágenes y títulos ----
  const tables: string[] = [];
  for (const t of Array.from(document.querySelectorAll('table'))) {
    if (tables.length >= 4) break;
    if (isHidden(t) || !rectInView(t.getBoundingClientRect())) continue;
    const rows = Array.from(t.querySelectorAll('tr'))
      .slice(0, 25)
      .map((tr) =>
        Array.from(tr.querySelectorAll('th, td'))
          .map((c) => cut(clean(c.textContent ?? ''), 120))
          .join(' | '),
      )
      .filter(Boolean);
    if (rows.length) tables.push(cut(rows.join('\n'), 2800));
  }
  const code: string[] = [];
  for (const el of Array.from(
    document.querySelectorAll('pre, .cm-content, .CodeMirror-code, .view-lines'),
  )) {
    if (code.length >= 6) break;
    if (isHidden(el) || !rectInView(el.getBoundingClientRect())) continue;
    const txt = ((el as HTMLElement).innerText ?? el.textContent ?? '')
      .replace(/\u00a0/g, ' ')
      .trimEnd();
    if (txt.trim().length >= 8) code.push(cut(txt, 2800));
  }
  const images: string[] = [];
  for (const img of Array.from(document.images)) {
    if (images.length >= 15) break;
    const alt = clean(img.alt || img.getAttribute('aria-label') || '');
    if (alt.length < 3 || isHidden(img) || !rectInView(img.getBoundingClientRect())) continue;
    images.push(cut(alt, 200));
  }
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter((h) => !isHidden(h))
    .slice(0, 30)
    .map((h) => cut(clean(h.textContent ?? ''), 150))
    .filter(Boolean);

  const selection = window.getSelection()?.toString().trim();
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  return {
    url: location.href,
    frameUrl: location.href,
    isTop: window === window.top,
    title: document.title,
    lang: document.documentElement.lang || undefined,
    selection: selection ? cut(selection, 5000) : undefined,
    headings,
    viewportText,
    fullText,
    inputs,
    tables,
    code,
    images,
    scrollPct: Math.min(100, Math.max(0, (window.scrollY / maxScroll) * 100)),
    viewport: { w: vw, h: vh },
    truncated,
  };
}
