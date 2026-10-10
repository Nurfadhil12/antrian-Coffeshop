import { ApiDiagnostics } from '@/components/ApiDiagnostics';
import { BaristaManager } from '@/components/BaristaManager';
import { MenuManager } from '@/components/MenuManager';
import { loadWithHealth } from '@/lib/api';
import type { BaristaView, MenuItemView } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function MenuPage() {
  const [menuRes, baristaRes] = await Promise.all([
    loadWithHealth<{ total: number; items: MenuItemView[] }>('/menu'),
    loadWithHealth<{ total: number; items: BaristaView[] }>('/baristas'),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Menu &amp; Barista</h1>
          <p>Master data yang dipakai saat membuat pesanan. Harga di sini yang menentukan total nota.</p>
        </div>
      </div>

      {menuRes.data ? (
        <MenuManager menu={menuRes.data.items} />
      ) : (
        <ApiDiagnostics
          error={menuRes.error ?? 'Menu tidak bisa dimuat.'}
          health={menuRes.health}
          context="daftar menu"
        />
      )}

      {baristaRes.data ? (
        <BaristaManager baristas={baristaRes.data.items} />
      ) : (
        <ApiDiagnostics
          error={baristaRes.error ?? 'Barista tidak bisa dimuat.'}
          health={baristaRes.health}
          context="daftar barista"
        />
      )}
    </>
  );
}
