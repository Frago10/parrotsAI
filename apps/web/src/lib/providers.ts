// Proveedores LLM con clave configurada (solo en el servidor).
export function availableLlmProviders(): string[] {
  const out: string[] = ['fake'];
  if (process.env.ANTHROPIC_API_KEY && process.env.LLM_PROVIDER !== 'fake') out.push('anthropic');
  if (process.env.OPENAI_API_KEY) out.push('openai');
  if (process.env.GOOGLE_API_KEY) out.push('google');
  return out;
}
