'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

function applyTheme(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export function Sidebar({
  user,
  locale,
}: {
  user: { name: string; email: string; plan: string; credits: number };
  locale: string;
}) {
  const t = useTranslations('nav');
  const tp = useTranslations('plan');
  const pathname = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>('system');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = (localStorage.getItem('theme') as Theme | null) ?? 'system';
      setTheme(saved);
    } catch {
      /* sin localStorage */
    }
  }, []);

  function changeTheme(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* ignorar */
    }
    applyTheme(next);
  }

  function changeLocale(next: string) {
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const items = [
    { href: '/sessions', label: t('sessions'), icon: '📞' },
    { href: '/live', label: t('live'), icon: '🎧' },
    { href: '/resumes', label: t('resumes'), icon: '📄' },
    { href: '/documents', label: t('documents'), icon: '📁' },
    { href: '/support', label: t('support'), icon: '💬' },
  ];

  const isLive = pathname?.includes('/live');
  if (isLive) return null; // En la sesión en vivo el espacio es para la llamada.

  return (
    <>
      <button
        className="btn fixed left-3 top-3 z-40 md:hidden"
        onClick={() => setOpen((o) => !o)}
        aria-label="menu"
      >
        ☰
      </button>
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform border-r border-border bg-panel p-4 transition md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6 flex items-center gap-2 px-2 pt-10 md:pt-0">
          <span className="text-xl">🦜</span>
          <span className="text-lg font-semibold">CallPilot</span>
        </div>
        <nav className="space-y-1">
          {items.map((it) => {
            const active = pathname?.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  active ? 'bg-accent-soft font-medium' : 'hover:bg-bg'
                }`}
              >
                <span>{it.icon}</span>
                {it.label}
              </Link>
            );
          })}
          <div className="pl-9 text-xs text-muted">
            <Link href="/support#tutorials" className="block py-1 hover:underline">
              {t('tutorials')}
            </Link>
            <Link href="/support#chat" className="block py-1 hover:underline">
              {t('supportChat')}
            </Link>
          </div>
        </nav>

        <div className="card mt-6 p-3 text-sm">
          <div className="font-medium">{user.plan === 'FREE' ? tp('free') : user.plan}</div>
          <div className="mt-1 text-xs text-muted">{tp('freeHint')}</div>
          <div className="mt-1 text-xs">{tp('credits', { credits: user.credits.toFixed(1) })}</div>
          <button className="btn btn-primary mt-2 w-full" disabled title="Fase 15 (pospuesta)">
            {tp('upgrade')}
          </button>
        </div>

        <div className="mt-6 space-y-3 text-sm">
          <div>
            <div className="label">{t('theme')}</div>
            <div className="flex gap-1">
              {(['light', 'dark', 'system'] as Theme[]).map((th) => (
                <button
                  key={th}
                  className={`btn flex-1 ${theme === th ? 'border-accent' : ''}`}
                  onClick={() => changeTheme(th)}
                >
                  {t(th)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label">{t('language')}</div>
            <select className="input" value={locale} onChange={(e) => changeLocale(e.target.value)}>
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </div>
          <a className="btn w-full" href="callpilot://open" title="Fase 12 (pospuesta)">
            {t('openDesktop')}
          </a>
        </div>

        <div className="mt-6 flex items-center gap-2 border-t border-border pt-4 text-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft font-semibold">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
          </div>
        </div>
        <button className="btn mt-3 w-full" disabled title="Sin autenticación en el MVP personal">
          {t('logout')}
        </button>
      </aside>
    </>
  );
}
