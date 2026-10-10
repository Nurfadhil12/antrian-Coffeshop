import type { HealthView } from '@/lib/types';

/**
 * Panel diagnostik yang tampil waktu API gagal.
 *
 * Tujuan: halaman tidak menampilkan "terjadi kesalahan" tanpa petunjuk. Isi
 * /api/health ditampilkan apa adanya (host database, status skema, status migrasi,
 * dan NAMA env var yang sampai ke proses API — nilainya tidak pernah ditampilkan)
 * supaya penyebabnya bisa dibaca langsung dari browser, termasuk oleh yang tidak
 * membuka log container.
 */
export function ApiDiagnostics({
  error,
  health,
  context,
}: {
  error: string;
  health: HealthView | null;
  context: string;
}) {
  // Komponen ini dirender di server, jadi bisa tahu platformnya dan hanya
  // menampilkan perintah yang benar-benar bisa dijalankan pemakainya.
  const isVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_URL);

  const envRow = (() => {
    const env = health?.env;
    if (!env) return null;
    const present = env.presentNames ?? [];
    if (present.length > 0) return present.join(', ');
    return `tidak ada satu pun (dicoba: ${(env.missingNames ?? []).join(', ')})`;
  })();

  return (
    <div className="diag">
      <h3>Gagal memuat {context}</h3>
      <dl>
        <dt>pesan</dt>
        <dd>{error}</dd>

        {health ? (
          <>
            <dt>health</dt>
            <dd>
              status={health.status} · db={health.db} · schema={health.schema}
            </dd>
            {health.schemaDetail?.missingMarkers?.length ? (
              <>
                <dt>kolom hilang</dt>
                <dd>{health.schemaDetail.missingMarkers.join(', ')}</dd>
              </>
            ) : null}
            {health.schemaDetail?.foreignTables?.length ? (
              <>
                <dt>tabel aplikasi lain</dt>
                <dd>{health.schemaDetail.foreignTables.join(', ')}</dd>
              </>
            ) : null}
            {health.schemaDetail?.migrations ? (
              <>
                <dt>migrasi terpasang</dt>
                <dd>
                  {health.schemaDetail.migrations.hasTable
                    ? `${health.schemaDetail.migrations.appliedCount} selesai${
                        health.schemaDetail.migrations.lastName
                          ? ` · terakhir ${health.schemaDetail.migrations.lastName}`
                          : ''
                      }`
                    : 'belum ada (_prisma_migrations tidak ada)'}
                </dd>
              </>
            ) : null}
            <dt>database</dt>
            <dd>
              {health.dbSource} → {health.dbHost} ({health.latencyMs} ms)
            </dd>
            {envRow ? (
              <>
                <dt>env database</dt>
                <dd>{envRow}</dd>
              </>
            ) : null}
            {health.env?.vercel ? (
              <>
                <dt>deployment</dt>
                <dd>
                  {health.env.vercelEnv ?? 'vercel'}
                  {health.env.deployment ? ` · ${health.env.deployment}` : ''}
                </dd>
              </>
            ) : null}
            <dt>migrasi</dt>
            <dd>
              {health.migrate
                ? `${health.migrate.status} (percobaan ${health.migrate.attempts})`
                : '— belum ada laporan'}
            </dd>
            {health.migrate?.error ? (
              <>
                <dt>error migrasi</dt>
                <dd>{health.migrate.error}</dd>
              </>
            ) : null}
          </>
        ) : (
          <>
            <dt>health</dt>
            <dd>
              tidak bisa dihubungi — API kemungkinan tidak jalan, atau {isVercel ? 'service api gagal dibangun' : 'Nginx tidak meneruskan /api'}
            </dd>
          </>
        )}
      </dl>

      {health?.hint || error ? (
        <p className="hint">
          Langkah berikutnya: {health?.hint ?? (isVercel ? 'buka Vercel → project → Logs, pilih service “api”' : 'periksa container api: docker compose logs --tail 80 api')}
        </p>
      ) : null}

      {isVercel ? (
        <p className="hint">
          Cek cepat dari terminal:
          <br />
          <code>curl -s https://&lt;domain-anda&gt;/api/health</code>
          <br />
          Log runtime: Vercel → project → Logs → pilih service <code>api</code>
        </p>
      ) : (
        <p className="hint">
          Cek cepat dari terminal:
          <br />
          <code>docker compose ps</code>
          <br />
          <code>curl -s http://127.0.0.1:8080/api/health</code>
          <br />
          <code>docker compose logs --tail 50 api</code>
        </p>
      )}
    </div>
  );
}
