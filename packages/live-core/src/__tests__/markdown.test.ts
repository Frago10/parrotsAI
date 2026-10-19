import { describe, expect, it } from 'vitest';
import { escapeHtml, markdownToHtml } from '../markdown';

describe('markdownToHtml', () => {
  it('renderiza la estructura de una respuesta de pantalla', () => {
    const html = markdownToHtml(
      '👁 **Veo:** un quiz\n⭐ **Respuesta:** B\n• Porque `LEFT JOIN` conserva filas\n1. uno\n2. dos',
    );
    expect(html).toContain('<strong>Veo:</strong>');
    expect(html).toContain('<ul><li>Porque <code>LEFT JOIN</code> conserva filas</li></ul>');
    expect(html).toContain('<ol><li>uno</li><li>dos</li></ol>');
  });
  it('escapa HTML del modelo o de la página (sin inyección)', () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)> **<script>alert(1)</script>**');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
  });
  it('mantiene los bloques de código literales', () => {
    const html = markdownToHtml('```python\nprint("<hola>")\n```');
    expect(html).toBe('<pre><code>print(&quot;&lt;hola&gt;&quot;)</code></pre>');
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });
});
