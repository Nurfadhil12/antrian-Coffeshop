#!/usr/bin/env bash
# api/scripts/smoke-api.sh — uji end-to-end API antrian & pembukuan.
#
# Semua request dibuat lewat BASE (default: API di host). Untuk menguji lewat
# Nginx/TLS, arahkan ke proxy — itu cara memastikan routing /api benar:
#
#   ./scripts/smoke-api.sh                                              # http://127.0.0.1:3220/api
#   BASE=http://127.0.0.1:8080/api ./scripts/smoke-api.sh               # lewat nginx (http)
#   BASE=https://localhost/api CURL_EXTRA=-k ./scripts/smoke-api.sh     # lewat nginx (TLS self-signed)
#
# Yang dibuktikan (bukan sekadar "endpoint mengembalikan 200"):
#   - CRUD menu & barista, termasuk 409 untuk nama duplikat dan 400 untuk input salah
#   - alur antrian: buat → panggil → selesai
#   - INVARIANT UTAMA: nota yang dibayar SELALU menambah tepat satu baris pendapatan
#     di buku kas, dan pembatalan baris itu mengembalikan nota ke status VOID
#   - nota berbayar tidak bisa dihapus/diubah
#   - laporan harian cocok dengan buku kas (reconciliation.match == true)
#
# Skrip ini MENULIS data uji ke database tujuan. Jalankan pada stack lokal/staging,
# bukan produksi.

set -uo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${BASE:-http://127.0.0.1:3220/api}"
CURL_EXTRA="${CURL_EXTRA:-}"
SHOP_TIMEZONE="${SHOP_TIMEZONE:-Asia/Jakarta}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
STATUS=""

TODAY="$(node -e "console.log(new Intl.DateTimeFormat('en-CA',{timeZone:process.env.SHOP_TIMEZONE||'Asia/Jakarta'}).format(new Date()))")"
STAMP="$(date +%s)"

green() { printf '\033[32m%s\033[0m' "$1"; }
red() { printf '\033[31m%s\033[0m' "$1"; }

# ── helper ──────────────────────────────────────────────────────────
# call METHOD PATH [BODYFILE] -> mengisi $STATUS dan $TMP/out.json
call() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    STATUS="$(curl $CURL_EXTRA -s -o "$TMP/out.json" -w '%{http_code}' \
      -X "$method" -H 'Content-Type: application/json' --data-binary "@$body" "$BASE$path")"
  else
    STATUS="$(curl $CURL_EXTRA -s -o "$TMP/out.json" -w '%{http_code}' -X "$method" "$BASE$path")"
  fi
}

# expect EXPECTED LABEL
expect() {
  if [ "$STATUS" = "$1" ]; then
    pass=$((pass + 1))
    printf '  %s %s\n' "$(green PASS)" "$2 (HTTP $STATUS)"
  else
    fail=$((fail + 1))
    printf '  %s %s — harap HTTP %s, dapat %s\n' "$(red FAIL)" "$2" "$1" "$STATUS"
    printf '        respons: %s\n' "$(head -c 300 "$TMP/out.json" | tr '\n' ' ')"
  fi
}

# expect_body VALUE EXPECTED LABEL
expect_body() {
  if [ "$1" = "$2" ]; then
    pass=$((pass + 1))
    printf '  %s %s\n' "$(green PASS)" "$3 ($1)"
  else
    fail=$((fail + 1))
    printf '  %s %s — harap %s, dapat "%s"\n' "$(red FAIL)" "$3" "$2" "$1"
  fi
}

# get PATH -> nilai dari respons terakhir (kosong + exit 1 kalau tidak ada)
get() { node "$API_DIR/scripts/json-get.js" "$TMP/out.json" "$1" 2>/dev/null; }

# getf FILE PATH
getf() { node "$API_DIR/scripts/json-get.js" "$1" "$2" 2>/dev/null; }

# assert_truthy VALUE LABEL
assert_truthy() {
  if [ -n "$1" ] && [ "$1" != "false" ] && [ "$1" != "null" ]; then
    pass=$((pass + 1)); printf '  %s %s (%s)\n' "$(green PASS)" "$2" "$1"
  else
    fail=$((fail + 1)); printf '  %s %s — nilai kosong/false\n' "$(red FAIL)" "$2"
  fi
}

section() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

echo "BASE = $BASE"
echo "TODAY = $TODAY (zona $SHOP_TIMEZONE)"
echo "Data uji ditulis ke database tujuan — jangan jalankan di produksi."

# ── 1. Kesehatan ────────────────────────────────────────────────────
section "1. Kesehatan API & database"
call GET /ping;        expect 200 "GET /ping"
expect_body "$(get pong)" "true" "ping.pong = true"
call GET /health;      expect 200 "GET /health"
expect_body "$(get db)" "up" "health.db = up"
expect_body "$(get schema)" "ok" "health.schema = ok (tabel sudah dimigrasi)"

# ── 2. Menu ─────────────────────────────────────────────────────────
section "2. Menu"
call GET /menu; expect 200 "GET /menu"
menu_total="$(get total)"
if [ "${menu_total:-0}" -ge 9 ]; then
  pass=$((pass + 1)); printf '  %s menu terisi (%s item)\n' "$(green PASS)" "$menu_total"
else
  fail=$((fail + 1)); printf '  %s menu hanya berisi %s item (harap >= 9) — jalankan: make seed\n' "$(red FAIL)" "${menu_total:-0}"
fi

cat > "$TMP/menu.json" <<JSON
{ "name": "Uji Latte $STAMP", "category": "KOPI", "price": 30000 }
JSON
call POST /menu "$TMP/menu.json"; expect 201 "POST /menu (item baru)"
TEST_MENU_ID="$(get id)"
assert_truthy "$TEST_MENU_ID" "menu.id terbaca"

call POST /menu "$TMP/menu.json"; expect 409 "POST /menu nama duplikat → 409"

cat > "$TMP/bad-menu.json" <<'JSON'
{ "name": "X", "category": "KOPI", "price": -5 }
JSON
call POST /menu "$TMP/bad-menu.json"; expect 400 "POST /menu harga negatif & nama 1 huruf → 400"

cat > "$TMP/menu-patch.json" <<'JSON'
{ "price": 31000 }
JSON
call PATCH "/menu/$TEST_MENU_ID" "$TMP/menu-patch.json"; expect 200 "PATCH /menu/:id"
expect_body "$(get price)" "31000" "harga menu terupdate"

call GET "/menu?category=KOPI&active=true"; expect 200 "GET /menu?category=KOPI&active=true"

# ── 3. Barista ──────────────────────────────────────────────────────
section "3. Barista"
call GET /baristas; expect 200 "GET /baristas"
BARISTA_ID="$(get items.0.id)"
assert_truthy "$BARISTA_ID" "barista pertama terbaca"

cat > "$TMP/barista.json" <<JSON
{ "name": "Uji Barista $STAMP", "phone": "0800-0000-0000" }
JSON
call POST /baristas "$TMP/barista.json"; expect 201 "POST /baristas"
TEST_BARISTA_ID="$(get id)"

cat > "$TMP/barista2.json" <<JSON
{ "name": "Uji Barista Cadangan $STAMP", "phone": "0800-0000-0001" }
JSON
call POST /baristas "$TMP/barista2.json"; expect 201 "POST /baristas (kedua, tidak dipakai antrian)"
UNUSED_BARISTA_ID="$(get id)"

call POST /baristas "$TMP/barista.json"; expect 409 "POST /baristas nama duplikat → 409"

# ── 4. Antrian: buat ────────────────────────────────────────────────
section "4. Antrian — buat nota"
cat > "$TMP/queue.json" <<JSON
{
  "customerName": "Pelanggan Uji $STAMP",
  "orderType": "TAKE_AWAY",
  "customerPhone": "0811-0000-1111",
  "baristaId": $TEST_BARISTA_ID,
  "queueDate": "$TODAY",
  "items": [
    { "menuItemId": $TEST_MENU_ID, "qty": 2 },
    { "name": "Extra Shot", "unitPrice": 5000, "qty": 1, "note": "tanpa gula" }
  ]
}
JSON
call POST /queues "$TMP/queue.json"; expect 201 "POST /queues (2 baris: dari menu + item lepas)"
QUEUE_ID="$(get id)"
QUEUE_CODE="$(get code)"
QUEUE_TOTAL="$(get total)"
assert_truthy "$QUEUE_ID" "queue.id terbaca"
expect_body "$QUEUE_TOTAL" "67000" "total = 2x31000 + 1x5000 = 67000"

cat > "$TMP/queue-empty.json" <<'JSON'
{ "customerName": "Tanpa Item", "items": [] }
JSON
call POST /queues "$TMP/queue-empty.json"; expect 400 "POST /queues tanpa item → 400"

cat > "$TMP/queue-badmenu.json" <<'JSON'
{ "customerName": "Menu Salah", "items": [ { "menuItemId": 999999, "qty": 1 } ] }
JSON
call POST /queues "$TMP/queue-badmenu.json"; expect 404 "POST /queues menu tidak ada → 404"

call GET "/queues?date=$TODAY"; expect 200 "GET /queues?date=$TODAY"
call GET "/queues/$QUEUE_ID"; expect 200 "GET /queues/:id"

# ── 5. Alur pemanggilan ─────────────────────────────────────────────
section "5. Alur: panggil → selesai → bayar"
# Barista uji dipakai di sini (bukan barista contoh) supaya uji ini tidak
# bergantung pada isi tabel barista hasil seed.
call POST "/queues/$QUEUE_ID/start"; expect 201 "POST /queues/:id/start (barista dari nota dipakai)"
expect_body "$(get status)" "IN_PROGRESS" "status = IN_PROGRESS"
expect_body "$(get baristaId)" "$TEST_BARISTA_ID" "barista terisi otomatis dari nota"

# Barista yang sedang mengerjakan satu nota tidak boleh dipanggil untuk nota lain.
cat > "$TMP/queue2.json" <<JSON
{
  "customerName": "Pelanggan Kedua $STAMP",
  "queueDate": "$TODAY",
  "baristaId": $TEST_BARISTA_ID,
  "items": [ { "menuItemId": $TEST_MENU_ID, "qty": 1 } ]
}
JSON
call POST /queues "$TMP/queue2.json"; expect 201 "POST /queues (nota kedua, barista sama)"
QUEUE2_ID="$(get id)"
call POST "/queues/$QUEUE2_ID/start"; expect 409 "panggil barista yang sedang sibuk → 409"
call DELETE "/queues/$QUEUE2_ID"; expect 200 "hapus nota kedua (belum dibayar)"

call POST "/queues/$QUEUE_ID/finish"; expect 201 "POST /queues/:id/finish"
expect_body "$(get status)" "DONE" "status = DONE"

cat > "$TMP/pay.json" <<'JSON'
{ "paymentMethod": "QRIS" }
JSON
call POST "/queues/$QUEUE_ID/pay" "$TMP/pay.json"; expect 201 "POST /queues/:id/pay"
expect_body "$(get paymentStatus)" "PAID" "status bayar = PAID"
expect_body "$(get paymentMethod)" "QRIS" "metode = QRIS"

call POST "/queues/$QUEUE_ID/pay" "$TMP/pay.json"; expect 409 "bayar dua kali → 409"

# ── 6. Invariant pembukuan ──────────────────────────────────────────
section "6. Invariant: nota berbayar ⇢ satu baris pendapatan"
call GET "/ledger?from=$TODAY&to=$TODAY"; expect 200 "GET /ledger (hari ini)"
LEDGER_TOTAL="$(get total)"
assert_truthy "$LEDGER_TOTAL" "baris pembukuan terbaca ($LEDGER_TOTAL baris)"

LEDGER_ID="$(node -e '
  const fs = require("node:fs");
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const queueId = Number(process.argv[2]);
  const hit = (data.items || []).find((row) => row.queueId === queueId && row.type === "INCOME");
  if (hit) process.stdout.write(String(hit.id));
' "$TMP/out.json" "$QUEUE_ID")"
assert_truthy "$LEDGER_ID" "baris pendapatan otomatis untuk nota $QUEUE_CODE ditemukan"

if [ -n "$LEDGER_ID" ]; then
  AMOUNT="$(node -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const row = (data.items || []).find((r) => r.id === Number(process.argv[2]));
    process.stdout.write(String(row ? row.amount : ""));
  ' "$TMP/out.json" "$LEDGER_ID")"
  expect_body "$AMOUNT" "$QUEUE_TOTAL" "jumlah di buku kas = total nota ($QUEUE_TOTAL)"
fi

call DELETE "/queues/$QUEUE_ID"; expect 409 "hapus nota berbayar → 409"

cat > "$TMP/expense.json" <<JSON
{ "type": "EXPENSE", "category": "Uji Otomatis", "amount": 12000, "method": "CASH", "description": "smoke test $STAMP", "entryDate": "$TODAY" }
JSON
call POST /ledger "$TMP/expense.json"; expect 201 "POST /ledger (pengeluaran manual)"
MANUAL_ID="$(get id)"

cat > "$TMP/expense-patch.json" <<'JSON'
{ "amount": 13000 }
JSON
call PATCH "/ledger/$MANUAL_ID" "$TMP/expense-patch.json"; expect 200 "PATCH /ledger/:id (baris manual)"
expect_body "$(get amount)" "13000" "nominal pengeluaran terupdate"

if [ -n "$LEDGER_ID" ]; then
  call PATCH "/ledger/$LEDGER_ID" "$TMP/expense-patch.json"; expect 409 "PATCH baris dari nota kasir → 409"
fi

call GET "/ledger?type=EXPENSE&q=smoke%20test"; expect 200 "GET /ledger terfilter (type + q)"

call DELETE "/ledger/$MANUAL_ID"; expect 200 "DELETE /ledger/:id (baris manual)"

# ── 7. Void pembayaran ──────────────────────────────────────────────
section "7. Void: membatalkan pendapatan mengembalikan nota ke VOID"
if [ -n "$LEDGER_ID" ]; then
  call DELETE "/ledger/$LEDGER_ID"; expect 200 "DELETE /ledger/:id (baris dari nota)"
  expect_body "$(get queueVoided)" "true" "nota ikut ditandai VOID"

  call GET "/queues/$QUEUE_ID"; expect 200 "GET /queues/:id setelah void"
  expect_body "$(get paymentStatus)" "VOID" "status bayar nota = VOID"
  expect_body "$(get total)" "$QUEUE_TOTAL" "total nota tidak berubah ($QUEUE_TOTAL)"

  # Nota VOID boleh dibayar ulang — dan wajib menghasilkan tepat satu baris lagi.
  cat > "$TMP/pay2.json" <<'JSON'
{ "paymentMethod": "CASH" }
JSON
  call POST "/queues/$QUEUE_ID/pay" "$TMP/pay2.json"; expect 201 "bayar ulang nota VOID"
  expect_body "$(get paymentStatus)" "PAID" "status kembali PAID"
fi

# ── 8. Laporan ──────────────────────────────────────────────────────
section "8. Laporan harian & rekap"
call GET "/reports/daily?date=$TODAY"; expect 200 "GET /reports/daily"
expect_body "$(get reconciliation.match)" "true" "reconciliation.match = true (penjualan == buku kas)"
expect_body "$(get reconciliation.difference)" "0" "selisih penjualan vs buku kas = 0"
assert_truthy "$(get sales.paidNotes)" "ada nota berbayar hari ini ($(get sales.paidNotes))"

call GET "/reports/range?from=$TODAY&to=$TODAY"; expect 200 "GET /reports/range"
expect_body "$(get days)" "1" "rentang 1 hari"

call GET "/reports/range?from=$TODAY&to=2020-01-01"; expect 400 "rentang terbalik → 400"

# ── 9. Bersih-bersih ────────────────────────────────────────────────
section "9. Bersih-bersih data uji"
call DELETE "/menu/$TEST_MENU_ID"; expect 200 "DELETE /menu/:id (sudah pernah dipesan)"
expect_body "$(get deleted)" "false" "menu tidak dihapus, hanya dinonaktifkan"
expect_body "$(get deactivated)" "true" "menu.deactivated = true"

call DELETE "/baristas/$TEST_BARISTA_ID"; expect 200 "DELETE /baristas/:id (punya riwayat antrian)"
expect_body "$(get deleted)" "false" "barista tidak dihapus, hanya dinonaktifkan"
expect_body "$(get deactivated)" "true" "barista.deactivated = true"

call DELETE "/baristas/$UNUSED_BARISTA_ID"; expect 200 "DELETE /baristas/:id (tanpa riwayat antrian)"
expect_body "$(get deleted)" "true" "barista tanpa riwayat benar-benar terhapus"

# ── Ringkasan ───────────────────────────────────────────────────────
printf '\n\033[1m== Ringkasan\033[0m\n'
printf '  PASS: %s\n  FAIL: %s\n' "$pass" "$fail"
if [ "$fail" -gt 0 ]; then
  echo "  Ada kegagalan — periksa log API: docker compose logs --tail 80 api"
  exit 1
fi
echo "  Semua uji lulus terhadap $BASE"
