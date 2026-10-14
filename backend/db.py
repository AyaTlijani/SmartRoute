"""
db.py — SQLite storage (Python's built-in sqlite3, no ORM).

One file, smartroute.db, next to this module. Delete it to start over,
or call POST /demo/reset.
"""

import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.getenv(
    "SMARTROUTE_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "smartroute.db"),
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS drivers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    phone       TEXT,
    vehicle     TEXT DEFAULT 'scooter',
    zones       TEXT NOT NULL,          -- comma-separated governorates
    depot_name  TEXT NOT NULL,
    depot_lat   REAL NOT NULL,
    depot_lng   REAL NOT NULL,
    max_orders  INTEGER DEFAULT 20,
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'driver')),
    driver_id     INTEGER REFERENCES drivers(id) ON DELETE CASCADE,
    full_name     TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_date      TEXT NOT NULL,    -- YYYY-MM-DD
    customer_name      TEXT NOT NULL,
    phone              TEXT NOT NULL,    -- 8 digits
    governorate        TEXT NOT NULL,
    city               TEXT,
    address            TEXT NOT NULL,
    landmark           TEXT,
    product            TEXT,
    cod_amount         REAL NOT NULL,    -- Tunisian dinars
    slot               INTEGER DEFAULT 0, -- 0 any, 1 morning, 2 afternoon
    notes              TEXT,
    lat                REAL NOT NULL,
    lng                REAL NOT NULL,
    location_precision TEXT,             -- exact | city | governorate
    status             TEXT NOT NULL DEFAULT 'pending',
                       -- pending | assigned | delivered | failed
    driver_id          INTEGER REFERENCES drivers(id),
    stop_number        INTEGER,
    eta                TEXT,
    unscheduled_reason TEXT,             -- set when the solver could not fit the stop
    retry_of           INTEGER REFERENCES orders(id),
    created_at         TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attempts (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id       INTEGER NOT NULL REFERENCES orders(id),
    driver_id      INTEGER REFERENCES drivers(id),
    result         TEXT NOT NULL,        -- delivered | failed
    reason         TEXT,
    note           TEXT,
    cash_collected REAL DEFAULT 0,
    photo_path     TEXT,
    lat            REAL,
    lng            REAL,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    voided_at      TEXT                  -- set by "undo"; the row is kept for audit
);

CREATE TABLE IF NOT EXISTS routes (
    driver_id       INTEGER NOT NULL REFERENCES drivers(id),
    delivery_date   TEXT NOT NULL,
    geometry        TEXT,                -- JSON [[lng, lat], ...]
    distance_km     REAL,
    driving_minutes INTEGER,
    source          TEXT,                -- ors | estimate
    end_time        TEXT,                -- back at the depot
    baseline_minutes INTEGER,            -- nearest-neighbour route, same matrix
    baseline_late   INTEGER,             -- stops the baseline reaches after their window
    PRIMARY KEY (driver_id, delivery_date)
);

-- One row per driver per working day: start, end and cash handover.
CREATE TABLE IF NOT EXISTS driver_days (
    driver_id      INTEGER NOT NULL REFERENCES drivers(id),
    day            TEXT NOT NULL,
    started_at     TEXT,                 -- "Start route" after loading packages
    last_lat       REAL,                 -- last known position (re-planning)
    last_lng       REAL,
    ended_at       TEXT,                 -- "End day"
    cash_declared  REAL,                 -- what the driver says they hand over
    cash_received  REAL,                 -- what the admin confirms receiving
    received_at    TEXT,
    received_by    INTEGER REFERENCES users(id),
    PRIMARY KEY (driver_id, day)
);

CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(delivery_date);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_attempts_order ON attempts(order_id);
"""

# Columns added after the first release. Older smartroute.db files get them
# through ALTER TABLE, so nobody has to delete their database.
MIGRATIONS = {
    "drivers": [("active", "INTEGER NOT NULL DEFAULT 1")],
    "orders": [("unscheduled_reason", "TEXT"), ("retry_of", "INTEGER REFERENCES orders(id)")],
    "attempts": [("voided_at", "TEXT")],
    "routes": [("end_time", "TEXT"), ("baseline_minutes", "INTEGER"), ("baseline_late", "INTEGER")],
}

# One retry per failed order, enforced by the database itself.
POST_MIGRATION = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_retry_of ON orders(retry_of) WHERE retry_of IS NOT NULL;
"""


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        for table, columns in MIGRATIONS.items():
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            for name, definition in columns:
                if name not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        conn.executescript(POST_MIGRATION)


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()  # all-or-nothing per request
        raise
    finally:
        conn.close()


def rows(conn, sql, params=()):
    return [dict(r) for r in conn.execute(sql, params).fetchall()]
