// Reglas de créditos y formato de duración. 1 crédito = 60 minutos, prorrateado por minuto.
export const FREE_TRIAL_SECONDS = 10 * 60;
export const SECONDS_PER_CREDIT = 60 * 60;

/** Créditos consumidos por una duración en segundos, con 1 decimal (28 min -> 0.5). */
export function creditsForSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const minutes = Math.ceil(seconds / 60);
  return Math.round((minutes / 60) * 10) / 10;
}

/** "28 mins 12 secs" | "1 hr 2 mins 5 secs" | "—" */
export function formatDuration(seconds: number | null | undefined, dash = '—'): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return dash;
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts: string[] = [];
  if (hrs) parts.push(`${hrs} ${hrs === 1 ? 'hr' : 'hrs'}`);
  if (mins) parts.push(`${mins} ${mins === 1 ? 'min' : 'mins'}`);
  parts.push(`${secs} ${secs === 1 ? 'sec' : 'secs'}`);
  return parts.join(' ');
}

/** mm:ss para etiquetas de respuestas ("Answer · 09:14"). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
