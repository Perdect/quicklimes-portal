-- ═══════════════════════════════════════════════════════════════
-- QuickLimes — MySQL schema (reference).
-- You do NOT need to run this by hand: api/setup.php creates these
-- tables automatically on first run. It's kept here for reference /
-- manual import via phpMyAdmin if you ever want it.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS plants (
  id              VARCHAR(64)  NOT NULL PRIMARY KEY,   -- plant / account id (uuid)
  owner_phone     VARCHAR(20)  NOT NULL DEFAULT '',    -- login phone
  password_hash   VARCHAR(255) NOT NULL DEFAULT '',    -- bcrypt (only on the primary plant)
  plant_name      VARCHAR(190) NOT NULL DEFAULT '',
  gst_number      VARCHAR(20)  DEFAULT NULL,
  city            VARCHAR(120) DEFAULT NULL,
  address         VARCHAR(255) DEFAULT NULL,
  parent_plant_id VARCHAR(64)  DEFAULT NULL,           -- NULL = primary; else the account's primary id
  plan_limit      INT          NOT NULL DEFAULT 2,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_owner (owner_phone),
  KEY idx_parent (parent_plant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_data (
  plant_id   VARCHAR(64) NOT NULL,   -- the account (primary) plant id
  data_id    VARCHAR(96) NOT NULL,   -- row key: a company id, or 'loans_<primaryId>'
  data       LONGTEXT    NOT NULL,   -- the JSON blob (sales, purchases, parties, …)
  updated_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (plant_id, data_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════════════════════════
-- Bank Reconciliation (Phase 2) — bank transactions scale out of the
-- per-company JSON blob into indexed tables scoped by (plant_id,
-- company_id). Used by api/recon.php; created by ql_ensure_tables().
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS bank_accounts (
  id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  plant_id    VARCHAR(64)  NOT NULL,
  company_id  VARCHAR(96)  NOT NULL,
  bank        VARCHAR(80)  DEFAULT NULL,
  acct_no     VARCHAR(40)  DEFAULT NULL,
  ifsc        VARCHAR(20)  DEFAULT NULL,
  label       VARCHAR(120) DEFAULT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ba_scope (plant_id, company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bank_txns (
  id          VARCHAR(64)   NOT NULL PRIMARY KEY,
  plant_id    VARCHAR(64)   NOT NULL,
  company_id  VARCHAR(96)   NOT NULL,
  account_id  VARCHAR(64)   DEFAULT NULL,     -- which bank account (nullable)
  txn_date    DATE          DEFAULT NULL,
  raw         TEXT,                            -- verbatim narration
  clean       VARCHAR(255)  DEFAULT NULL,      -- parsed party text
  utr         VARCHAR(64)   DEFAULT NULL,
  cheque      VARCHAR(20)   DEFAULT NULL,
  mode        VARCHAR(12)   DEFAULT NULL,      -- RTGS/NEFT/IMPS/UPI/…
  bank        VARCHAR(80)   DEFAULT NULL,
  debit       DECIMAL(16,2) NOT NULL DEFAULT 0,
  credit      DECIMAL(16,2) NOT NULL DEFAULT 0,
  balance     DECIMAL(16,2) DEFAULT NULL,
  dedupe_key  VARCHAR(140)  DEFAULT NULL,
  status      VARCHAR(20)   DEFAULT NULL,      -- denormalized from m.status for filtering
  confidence  INT           DEFAULT NULL,      -- denormalized from m.confidence
  m           LONGTEXT,                        -- full match object JSON (kind/idx/allocs/…)
  updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_bt_scope  (plant_id, company_id, txn_date),
  KEY idx_bt_status (plant_id, company_id, status),
  KEY idx_bt_dedupe (plant_id, company_id, dedupe_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS party_aliases (
  plant_id    VARCHAR(64)  NOT NULL,
  company_id  VARCHAR(96)  NOT NULL,
  alias_key   VARCHAR(190) NOT NULL,           -- normalised narration key
  party       VARCHAR(190) NOT NULL,           -- the party it maps to
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (plant_id, company_id, alias_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
