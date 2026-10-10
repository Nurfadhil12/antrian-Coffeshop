#!/usr/bin/env node
/**
 * api/scripts/json-get.js — ambil satu nilai dari berkas JSON.
 *
 *   node scripts/json-get.js /tmp/out.json "items.0.code"
 *   node scripts/json-get.js /tmp/out.json "summary.revenue"
 *
 * Keluar dengan kode 1 (dan mencetak kosong) kalau path-nya tidak ada — sehingga
 * skrip pemanggil bisa membedakan "nilainya 0" dari "fieldnya tidak ada".
 *
 * Catatan: selalu BACA ULANG berkas tiap pemanggilan (tidak meng-cache). Skrip ini
 * dipanggil sebagai proses terpisah, jadi berkas yang berubah antar assertion
 * selalu terbaca versi terbarunya.
 */
const fs = require('node:fs');

const [, , file, path] = process.argv;

if (!file || !path) {
  console.error('Pakai: node scripts/json-get.js <file.json> <path>');
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`Tidak bisa membaca/mengurai ${file}: ${error.message}`);
  process.exit(1);
}

let current = parsed;
for (const key of path.split('.')) {
  if (current === null || current === undefined) break;
  current = current[key];
}

if (current === undefined || current === null) {
  process.exit(1);
}

process.stdout.write(typeof current === 'object' ? JSON.stringify(current) : String(current));
