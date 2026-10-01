// Configuración de next-intl sin rutas por idioma: el locale viene de la cookie "locale" (es por defecto).
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

export const LOCALES = ['es', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('locale')?.value;
  const locale: Locale = cookieLocale === 'en' ? 'en' : 'es';
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: 'America/Bogota',
  };
});
