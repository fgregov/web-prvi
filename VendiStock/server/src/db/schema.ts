/**
 * Migracije baze podataka. Svaka migracija izvršava se jednom, u transakciji, prema rednom broju.
 * Postojeće migracije se ne mijenjaju – promjene sheme dodaju se kao nove migracije.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core',
    sql: `
-- Korisnici VendiStocka (odvojeno od Televend vjerodajnica)
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- SHA-256 tokena; sam token je samo u httpOnly kolačiću
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX ix_sessions_user ON sessions(user_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT
);
CREATE INDEX ix_audit_created ON audit_log(created_at);
CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE secrets (
  name TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  key_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE doc_sequences (
  prefix TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_no INTEGER NOT NULL,
  PRIMARY KEY (prefix, year)
);

-- Šifrarnici
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  oib TEXT,
  address TEXT,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_price REAL NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  unit TEXT NOT NULL DEFAULT 'kom',
  pack_size REAL NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  min_stock REAL NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  target_stock REAL NOT NULL DEFAULT 0 CHECK (target_stock >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX ix_products_name ON products(name);

-- Automati (iz Televenda ili ručno uneseni)
CREATE TABLE machines (
  id INTEGER PRIMARY KEY,
  ext_key TEXT UNIQUE,               -- ključ izvora (Televend ID ili normalizirani naziv)
  source_id TEXT,
  name TEXT NOT NULL,
  location_text TEXT,
  serial_no TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK (source IN ('televend','manual','upload')),
  raw TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

-- Artikli kako ih vidi Televend (nazivi se mogu razlikovati po automatima)
CREATE TABLE tv_products (
  id INTEGER PRIMARY KEY,
  ext_key TEXT NOT NULL UNIQUE,
  source_id TEXT,
  name TEXT NOT NULL,
  machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  last_price REAL,
  raw TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  source TEXT NOT NULL
);

-- Ručno povezivanje Televend artikala s lokalnim artiklima (više naziva → jedan artikl)
CREATE TABLE product_televend_links (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tv_product_id INTEGER NOT NULL UNIQUE REFERENCES tv_products(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX ix_ptl_product ON product_televend_links(product_id);

-- Lokacije zaliha
CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('central','vehicle','machine','other')),
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  machine_id INTEGER UNIQUE REFERENCES machines(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

-- Skladišna knjiga: zaglavlje dokumenta
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  doc_no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('opening','receipt','issue','transfer','adjustment','sale','reversal')),
  doc_date TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  document_ref TEXT,
  destination_type TEXT CHECK (destination_type IN ('vehicle','machine','other')),
  note TEXT,
  source_ref TEXT UNIQUE,            -- npr. sale:123, refill:45 – sprječava dvostruko knjiženje
  reverses_movement_id INTEGER UNIQUE REFERENCES stock_movements(id),
  corrects_movement_id INTEGER REFERENCES stock_movements(id),
  inventory_count_id INTEGER,
  purchase_order_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX ix_movements_date ON stock_movements(doc_date);
CREATE INDEX ix_movements_type ON stock_movements(type);

-- Skladišna knjiga: stavke (pojedinačna kretanja po lokaciji)
CREATE TABLE stock_ledger (
  id INTEGER PRIMARY KEY,
  movement_id INTEGER NOT NULL REFERENCES stock_movements(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  qty_delta REAL NOT NULL CHECK (qty_delta <> 0),
  unit_cost REAL,
  balance_after REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX ix_ledger_product_loc ON stock_ledger(product_id, location_id, id);
CREATE INDEX ix_ledger_movement ON stock_ledger(movement_id);

-- Trenutna stanja (materijalizirano iz knjige, ažurira se u istoj transakciji)
CREATE TABLE stock_balances (
  product_id INTEGER NOT NULL REFERENCES products(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  qty REAL NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, location_id)
);

CREATE TABLE stock_reservations (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL CHECK (qty > 0),
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  released_at TEXT
);

CREATE TABLE inventory_counts (
  id INTEGER PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  status TEXT NOT NULL CHECK (status IN ('draft','posted','cancelled')),
  count_date TEXT NOT NULL,
  note TEXT,
  movement_id INTEGER REFERENCES stock_movements(id),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  posted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  posted_at TEXT
);

CREATE TABLE inventory_count_lines (
  id INTEGER PRIMARY KEY,
  count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  book_qty REAL,
  counted_qty REAL,
  difference REAL,
  UNIQUE (count_id, product_id)
);

-- Televend: sinkronizacije, uvozi, transakcije
CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('test','sync','discovery','manual_session')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual','auto','startup')),
  status TEXT NOT NULL CHECK (status IN ('running','success','partial','failed','interrupted','skipped')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 1,
  records_fetched INTEGER NOT NULL DEFAULT 0,
  records_inserted INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_duplicate INTEGER NOT NULL DEFAULT 0,
  records_rejected INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  log TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX ix_sync_runs_started ON sync_runs(started_at);

CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY,
  sync_run_id INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL,
  dataset TEXT NOT NULL CHECK (dataset IN ('machines','products','sales','machine_stock','refills')),
  source TEXT NOT NULL CHECK (source IN ('televend_portal','manual_upload')),
  file_name TEXT,
  file_sha256 TEXT,
  period_from TEXT,
  period_to TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_rejected INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('committed','rejected','failed')),
  error_message TEXT,
  rejected_rows TEXT,
  fetched_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE sales_transactions (
  id INTEGER PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  source_txn_id TEXT,
  machine_id INTEGER REFERENCES machines(id),
  tv_product_id INTEGER REFERENCES tv_products(id),
  machine_name_raw TEXT,
  product_name_raw TEXT,
  quantity REAL NOT NULL,
  unit_price REAL,
  amount REAL,
  payment_method TEXT,
  sold_at_utc TEXT NOT NULL,
  sold_date_local TEXT NOT NULL,
  sold_month_local TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','cancelled')),
  source TEXT NOT NULL CHECK (source IN ('televend_portal','manual_upload')),
  import_batch_id INTEGER REFERENCES import_batches(id),
  fetched_at TEXT NOT NULL,
  source_ref TEXT,
  raw TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  stock_movement_id INTEGER REFERENCES stock_movements(id),
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX ix_sales_date ON sales_transactions(sold_date_local);
CREATE INDEX ix_sales_machine ON sales_transactions(machine_id, sold_date_local);
CREATE INDEX ix_sales_product ON sales_transactions(tv_product_id, sold_date_local);

CREATE TABLE sales_transaction_revisions (
  id INTEGER PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES sales_transactions(id),
  revision INTEGER NOT NULL,
  import_batch_id INTEGER REFERENCES import_batches(id),
  before TEXT NOT NULL,
  after TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE tv_machine_stock (
  id INTEGER PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  tv_product_id INTEGER NOT NULL REFERENCES tv_products(id),
  quantity REAL NOT NULL,
  capacity REAL,
  measured_at_utc TEXT,
  fetched_at TEXT NOT NULL,
  import_batch_id INTEGER REFERENCES import_batches(id),
  source TEXT NOT NULL
);
CREATE INDEX ix_tvstock_machine ON tv_machine_stock(machine_id, tv_product_id, fetched_at);

CREATE TABLE tv_refills (
  id INTEGER PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  source_refill_id TEXT,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  tv_product_id INTEGER NOT NULL REFERENCES tv_products(id),
  quantity REAL NOT NULL,
  refilled_at_utc TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  import_batch_id INTEGER REFERENCES import_batches(id),
  source TEXT NOT NULL,
  raw TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reconciled','booked','ignored')),
  movement_id INTEGER REFERENCES stock_movements(id),
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  note TEXT
);

CREATE TABLE televend_discovery_reports (
  id INTEGER PRIMARY KEY,
  sync_run_id INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  report TEXT NOT NULL
);

-- Nabava
CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  po_no TEXT NOT NULL UNIQUE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  order_date TEXT NOT NULL,
  expected_date TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE purchase_order_lines (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty_ordered REAL NOT NULL CHECK (qty_ordered > 0),
  qty_received REAL NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_price REAL,
  UNIQUE (po_id, product_id)
);

-- Upozorenja o niskim zalihama
CREATE TABLE stock_alert_state (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  is_low INTEGER NOT NULL DEFAULT 0,
  low_since TEXT,
  last_available REAL,
  last_min REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE email_log (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('low_stock','daily_reminder','test','procurement_list')),
  to_addresses TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT,
  body_html TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  sent_at TEXT
);

CREATE TABLE stock_alert_events (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('entered_low','recovered')),
  available_qty REAL NOT NULL,
  min_qty REAL NOT NULL,
  notify_status TEXT NOT NULL CHECK (notify_status IN ('pending','sent','failed','skipped','not_required')),
  email_id INTEGER REFERENCES email_log(id),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX ix_alert_events_pending ON stock_alert_events(notify_status, created_at);

-- Normativi (priprema za buduću verziju – v1.0.0 ne razdužuje sastojke automatski)
CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tv_product_id INTEGER UNIQUE REFERENCES tv_products(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  verified INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE recipe_ingredients (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL CHECK (qty > 0),
  unit TEXT NOT NULL,
  UNIQUE (recipe_id, product_id)
);

INSERT INTO locations (type, name, note) VALUES ('central', 'Centralno skladište', 'Glavno skladište Vending Expressa');
`,
  },
];
