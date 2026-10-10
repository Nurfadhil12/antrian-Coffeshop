/** @type {import('next').NextConfig} */
const nextConfig = {
  // Wajib untuk web/Dockerfile (stage runner memakai .next/standalone)
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,

  // Repo ini berada di dalam home directory; tanpa ini Turbopack memakai
  // /Users/<user> sebagai workspace root dan memperingatkan soal lockfile.
  turbopack: { root: __dirname },

  // Di produksi semua /api/* ditangani Nginx sebelum sampai ke container ini,
  // jadi rewrite ini hanya terpakai saat pengembangan lokal (`npm run dev`)
  // untuk meneruskan /api ke API NestJS di host.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3220';
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

module.exports = nextConfig;
