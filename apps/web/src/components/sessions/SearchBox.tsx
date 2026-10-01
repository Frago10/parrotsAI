'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Búsqueda con debounce de 300 ms que actualiza la URL (?q=). */
export function SearchBox({ initial, placeholder }: { initial: string; placeholder: string }) {
  const [value, setValue] = useState(initial);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('q', value.trim());
      else next.delete('q');
      next.delete('page');
      const qs = next.toString();
      if (qs !== params.toString()) router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
    }, 300);
    return () => clearTimeout(handle);
  }, [value, params, pathname, router]);

  return (
    <input
      className="input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
    />
  );
}
