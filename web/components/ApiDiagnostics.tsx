import type { HealthView } from '@/lib/types';

/**
 * Panel diagnostik yang tampil waktu API gagal.
 *
 * Tujuan: halaman tidak menampilkan "terjadi kesalahan" tanpa petunjuk. Isi
 * /api/health ditampilkan apa adanya (host database, status skema, status migrasi)
 * supaya penyebabnya bisa dibaca langsung dari browser — termasuk oleh yang tidak
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
            <dt>database</dt>
            <dd>
              {health.dbSource} → {health.dbHost} ({health.latencyMs} ms)
            </dd>
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
            <dd>tidak bisa dihubungi — API kemungkinan tidak jalan atau Nginx tidak meneruskan /api</dd>
          </>
        )}
      </dl>

      {health?.hint || error ? (
        <p className="hint">
          Langkah berikutnya: {health?.hint ?? 'periksa container api: docker compose logs --tail 80 api'}
        </p>
      ) : null}

      <p className="hint">
        Cek cepat dari terminal:
        <br />
        <code>docker compose ps</code>
        <br />
        <code>curl -s http://127.0.0.1:8080/api/health</code>
        <br />
        <code>docker compose logs --tail 50 api</code>
      </p>
    </div>
  );
}
