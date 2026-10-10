// web/lib/types.ts — bentuk data dari API (mirror dari DTO NestJS).
// Sengaja ditulis manual supaya frontend tidak bergantung pada tipe internal API.

export type MenuCategory = 'KOPI' | 'NON_KOPI' | 'MAKANAN' | 'SNACK' | 'LAINNYA';
export type OrderType = 'DINE_IN' | 'TAKE_AWAY';
export type QueueStatus = 'WAITING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'VOID';
export type PaymentMethod = 'CASH' | 'QRIS' | 'TRANSFER' | 'E_WALLET';
export type LedgerType = 'INCOME' | 'EXPENSE';

export interface MenuItemView {
  id: number;
  name: string;
  category: MenuCategory;
  price: number;
  active: boolean;
  createdAt: string;
}

export interface BaristaView {
  id: number;
  name: string;
  phone: string | null;
  active: boolean;
  createdAt: string;
  _count?: { queues: number };
}

export interface OrderItemView {
  id: number;
  menuItemId: number | null;
  nameSnapshot: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  note: string | null;
}

export interface QueueView {
  id: number;
  number: number;
  code: string;
  queueDate: string;
  customerName: string;
  customerPhone: string | null;
  orderType: OrderType;
  tableNumber: string | null;
  status: QueueStatus;
  note: string | null;
  subtotal: number;
  discount: number;
  total: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  paidAt: string | null;
  baristaId: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  barista: { id: number; name: string } | null;
  orderItems: OrderItemView[];
}

export interface QueueSummary {
  total: number;
  waiting: number;
  inProgress: number;
  done: number;
  cancelled: number;
  unpaid: number;
  paidCount: number;
  revenue: number;
  unpaidAmount: number;
  lastNumber: number;
  serving: { id: number; code: string; customerName: string } | null;
  next: { id: number; code: string; customerName: string } | null;
  avgServiceMinutes: number | null;
}

export interface QueueListResponse {
  date: string;
  items: QueueView[];
  summary: QueueSummary;
}

export interface LedgerEntryView {
  id: number;
  entryDate: string;
  type: LedgerType;
  category: string;
  amount: number;
  method: PaymentMethod | null;
  description: string | null;
  queueId: number | null;
  createdAt: string;
  queue: { id: number; code: string; customerName: string; status: QueueStatus } | null;
}

export interface GroupRow {
  key: string;
  label: string;
  type: LedgerType;
  total: number;
  count: number;
}

export interface LedgerListResponse {
  from: string;
  to: string;
  total: number;
  totals: {
    income: number;
    expense: number;
    net: number;
    incomeCount: number;
    expenseCount: number;
  };
  byCategory: GroupRow[];
  byMethod: GroupRow[];
  items: LedgerEntryView[];
}

export interface DailyReport {
  date: string;
  sales: {
    notes: number;
    paidNotes: number;
    unpaidNotes: number;
    voidedNotes: number;
    cancelledNotes: number;
    gross: number;
    discount: number;
    revenue: number;
    unpaidAmount: number;
    avgNoteValue: number;
    avgServiceMinutes: number | null;
    lastCode: string | null;
  };
  ledger: {
    count: number;
    income: number;
    expense: number;
    net: number;
    autoIncomeCount: number;
    manualIncomeCount: number;
    byCategory: Array<{ category: string; type: LedgerType; total: number; count: number }>;
    byMethod: Array<{ method: string; label: string; total: number; count: number }>;
  };
  reconciliation: {
    salesRevenue: number;
    ledgerIncome: number;
    difference: number;
    match: boolean;
  };
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  byMenuCategory: Array<{ category: MenuCategory; qty: number; revenue: number }>;
  byPaymentMethod: Array<{ method: string; label: string; notes: number; revenue: number }>;
  byBarista: Array<{ baristaId: number; name: string; notes: number; revenue: number }>;
}

export interface RangeReport {
  from: string;
  to: string;
  days: number;
  rows: Array<{
    date: string;
    income: number;
    expense: number;
    net: number;
    paidNotes: number;
    unpaidNotes: number;
    allNotes: number;
  }>;
  totals: {
    income: number;
    expense: number;
    net: number;
    paidNotes: number;
    unpaidNotes: number;
    allNotes: number;
    avgDailyIncome: number;
    avgDailyExpense: number;
  };
  expenseByCategory: Array<{ category: string; total: number; count: number }>;
}

export interface HealthView {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  /** partial = tabel ada tapi kolomnya bukan milik aplikasi ini (gejala P2022). */
  schema: 'ok' | 'partial' | 'missing' | 'unknown';
  /** Rincian pemeriksaan skema: kolom hilang, tabel asing, migrasi terpasang. */
  schemaDetail?: {
    status: 'ok' | 'partial' | 'missing' | 'unknown';
    missingMarkers: string[];
    presentMarkers: string[];
    foreignTables: string[];
    migrations: { hasTable: boolean; appliedCount: number; lastName: string | null };
    error: string | null;
  } | null;
  migrate: { status: string; attempts: number; error: string | null; updatedAt: string } | null;
  latencyMs: number;
  dbSource: string;
  dbHost: string;
  /** Nama database (tanpa kredensial). Host saja tidak membedakan dua database
   *  dalam satu project Neon. */
  dbName?: string;
  /** Diagnostik environment — hanya NAMA env var, tidak pernah nilainya. */
  env?: {
    databaseUrlCandidates: Record<string, boolean>;
    presentNames: string[];
    missingNames: string[];
    vercel: boolean;
    vercelEnv: string | null;
    deployment: string | null;
  } | null;
  hint: string | null;
  error: string | null;
  service: string;
  time: string;
}
