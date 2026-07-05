-- ============================================================
-- Cipher — Password Generator Database Schema
-- ============================================================
-- Engine: SQLite 3
--
-- SECURITY NOTE:
-- This database NEVER stores generated passwords in plaintext.
-- Only a SHA-256 hash of each password is kept (for duplicate
-- detection / breach-list checks), plus metadata about how it
-- was generated. The hash cannot be reversed to recover the
-- original password.
--
-- USAGE:
--   sqlite3 password_generator.db < schema.sql
-- or, if you don't have the sqlite3 CLI, run it via Python:
--   python3 -c "import sqlite3; sqlite3.connect('password_generator.db').executescript(open('schema.sql').read())"
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- users
-- Optional multi-user support. Only the user's own login
-- credential is hashed and stored here — never a generated
-- password.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    username            TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,          -- bcrypt/argon2 hash of the user's OWN login password
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- presets
-- Named, reusable generation configurations
-- (e.g. "Standard", "High Security", "Simple").
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = global/default preset
    name                TEXT NOT NULL,
    length              INTEGER NOT NULL CHECK (length BETWEEN 4 AND 128),
    use_lower           INTEGER NOT NULL DEFAULT 1 CHECK (use_lower IN (0,1)),
    use_upper           INTEGER NOT NULL DEFAULT 1 CHECK (use_upper IN (0,1)),
    use_numbers         INTEGER NOT NULL DEFAULT 1 CHECK (use_numbers IN (0,1)),
    use_symbols         INTEGER NOT NULL DEFAULT 1 CHECK (use_symbols IN (0,1)),
    exclude_ambiguous   INTEGER NOT NULL DEFAULT 0 CHECK (exclude_ambiguous IN (0,1)),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);

-- ------------------------------------------------------------
-- generation_log
-- Audit trail of generation events. Stores metadata and a
-- one-way hash only — never the plaintext password.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generation_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    preset_id           INTEGER REFERENCES presets(id) ON DELETE SET NULL,
    password_hash       TEXT NOT NULL,          -- SHA-256 hex digest of the generated password
    length              INTEGER NOT NULL CHECK (length BETWEEN 4 AND 128),
    pool_size           INTEGER NOT NULL CHECK (pool_size > 0),
    entropy_bits        INTEGER NOT NULL CHECK (entropy_bits >= 0),
    used_lower          INTEGER NOT NULL CHECK (used_lower IN (0,1)),
    used_upper          INTEGER NOT NULL CHECK (used_upper IN (0,1)),
    used_numbers        INTEGER NOT NULL CHECK (used_numbers IN (0,1)),
    used_symbols        INTEGER NOT NULL CHECK (used_symbols IN (0,1)),
    excluded_ambiguous  INTEGER NOT NULL DEFAULT 0 CHECK (excluded_ambiguous IN (0,1)),
    client_ip           TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Indexes for common lookups
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_generation_log_created_at ON generation_log (created_at);
CREATE INDEX IF NOT EXISTS idx_generation_log_user_id     ON generation_log (user_id);
CREATE INDEX IF NOT EXISTS idx_generation_log_hash        ON generation_log (password_hash);
CREATE INDEX IF NOT EXISTS idx_presets_user_id             ON presets (user_id);

-- ------------------------------------------------------------
-- View: strength_summary
-- Buckets generation events by strength band, derived from
-- entropy_bits, for quick reporting.
-- ------------------------------------------------------------
CREATE VIEW IF NOT EXISTS strength_summary AS
SELECT
    CASE
        WHEN entropy_bits < 40 THEN 'Weak'
        WHEN entropy_bits < 60 THEN 'Fair'
        WHEN entropy_bits < 90 THEN 'Strong'
        ELSE 'Vault-grade'
    END AS strength_band,
    COUNT(*) AS total_generated,
    ROUND(AVG(entropy_bits), 1) AS avg_entropy_bits,
    ROUND(AVG(length), 1) AS avg_length
FROM generation_log
GROUP BY strength_band;

-- ------------------------------------------------------------
-- Seed data: a few sensible default presets (global, user_id NULL)
-- ------------------------------------------------------------
INSERT OR IGNORE INTO presets (user_id, name, length, use_lower, use_upper, use_numbers, use_symbols, exclude_ambiguous)
VALUES
    (NULL, 'Standard',       16, 1, 1, 1, 1, 0),
    (NULL, 'High Security',  24, 1, 1, 1, 1, 1),
    (NULL, 'Simple',         12, 1, 0, 1, 0, 0),
    (NULL, 'Memorable Lite', 10, 1, 1, 0, 0, 1);
