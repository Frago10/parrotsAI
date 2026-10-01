import { formatDuration } from '@callpilot/shared';

export { formatDuration };

export function formatDate(d: Date | string, locale: string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatCredits(
  credits: number | string,
  usedFreeTrial: boolean,
  freeLabel: string,
): string {
  if (usedFreeTrial) return freeLabel;
  const n = Number(credits);
  return n === 0 ? '0' : n.toFixed(1);
}
