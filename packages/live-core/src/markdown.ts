// Markdown mínimo a HTML seguro (negritas, código, viñetas, listas numeradas y bloques de código).
// Todo el texto se escapa antes de generar etiquetas: no hay forma de inyectar HTML desde el modelo.

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToHtml(text: string): string {
  const out: string[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        code.push(lines[i]!);
        i++;
      }
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*[•\-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[•\-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[•\-*]\s+/, ''));
        i++;
      }
      out.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      out.push(`<ol>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ol>`);
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  return out.join('');
}
