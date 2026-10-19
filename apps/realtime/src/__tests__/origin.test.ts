import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../config';

describe('isAllowedOrigin', () => {
  it('acepta la web local, la extensión y clientes sin Origin', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isAllowedOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true);
  });
  it('rechaza páginas externas y orígenes inválidos', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('null')).toBe(false);
    expect(isAllowedOrigin('no es una url')).toBe(false);
  });
  it('respeta ALLOWED_ORIGINS exactos y con comodín', () => {
    expect(isAllowedOrigin('https://app.midominio.com', ['https://app.midominio.com'])).toBe(true);
    expect(isAllowedOrigin('https://x.midominio.com', ['*.midominio.com'])).toBe(true);
    expect(isAllowedOrigin('https://midominio.com.evil.io', ['*.midominio.com'])).toBe(false);
  });
});
