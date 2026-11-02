CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CONSTRAINT homes_name_nonempty CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL CONSTRAINT members_home_fk REFERENCES homes(id),
  name TEXT NOT NULL CONSTRAINT members_name_nonempty CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX members_home_order ON members(home_id, created_at, id);
CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL CONSTRAINT bills_home_fk REFERENCES homes(id),
  title TEXT NOT NULL CONSTRAINT bills_title_nonempty CHECK (length(trim(title)) > 0),
  total_cents INTEGER NOT NULL CONSTRAINT bills_positive CHECK (total_cents > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX bills_home_idx ON bills(home_id);
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL CONSTRAINT shares_bill_fk REFERENCES bills(id),
  member_id TEXT NOT NULL CONSTRAINT shares_member_fk REFERENCES members(id),
  amount_cents INTEGER NOT NULL CONSTRAINT shares_nonnegative CHECK (amount_cents >= 0),
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT shares_unique_member UNIQUE (bill_id, member_id),
  CONSTRAINT shares_payment_consistency CHECK ((paid_at IS NULL AND idempotency_key IS NULL) OR (paid_at IS NOT NULL AND idempotency_key IS NOT NULL))
);
CREATE INDEX shares_bill_idx ON shares(bill_id);
CREATE INDEX shares_member_unpaid_idx ON shares(member_id, paid_at);
