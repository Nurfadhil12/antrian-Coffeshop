import type { Metadata } from 'next';
import { NavLink } from '@/components/NavLink';
import './globals.css';

export const metadata: Metadata = {
  title: 'Antrian & Pembukuan Coffee Shop',
  description: 'Papan antrian pesanan dan buku kas harian coffee shop',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <div className="brand">
              ☕ Antrian <span>&amp; Pembukuan</span>
            </div>
            <NavLink />
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
