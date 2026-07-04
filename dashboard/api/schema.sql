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
