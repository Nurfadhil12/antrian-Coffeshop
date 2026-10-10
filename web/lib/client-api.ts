// Pemanggil API untuk Client Component (browser -> Nginx/rewrite -> API NestJS).
// NEXT_PUBLIC_API_URL ditanam saat build; default "/api" (same-origin).

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? '/api').replace(/\/$/, '');

type Method = 'POST' | 'PATCH' | 'DELETE';

export async function apiSend<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = (data as { message?: unknown } | null)?.message;
    if (Array.isArray(message)) throw new Error(message.join(', '));
    if (typeof message === 'string') throw new Error(message);
    throw new Error(`Gagal (HTTP ${res.status}).`);
  }

  return data as T;
}
