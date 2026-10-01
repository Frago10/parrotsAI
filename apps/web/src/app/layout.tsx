import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import './globals.css';
import { Sidebar } from '@/components/shell/Sidebar';
import { currentUser } from '@/lib/db';

export const metadata: Metadata = {
  title: 'CallPilot',
  description: 'Copiloto de IA en tiempo real para llamadas',
};

// Aplica el tema antes de pintar para evitar parpadeo.
const themeScript = `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const user = await currentUser();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <NextIntlClientProvider>
          <div className="flex min-h-screen">
            <Sidebar
              user={{
                name: user.name ?? 'Usuario',
                email: user.email,
                plan: user.plan,
                credits: Number(user.creditsBalance),
              }}
              locale={locale}
            />
            <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
