'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Antrian' },
  { href: '/menu', label: 'Menu & Barista' },
  { href: '/pembukuan', label: 'Pembukuan' },
  { href: '/laporan', label: 'Laporan' },
];

export function NavLink() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {LINKS.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} className={active ? 'active' : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
