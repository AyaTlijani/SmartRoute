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
    max_orders  INTEGER DEFAULT 20
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
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS routes (
    driver_id       INTEGER NOT NULL REFERENCES drivers(id),
    delivery_date   TEXT NOT NULL,
    geometry        TEXT,                -- JSON [[lng, lat], ...]
    distance_km     REAL,
    driving_minutes INTEGER,
    source          TEXT,                -- ors | estimate
    PRIMARY KEY (driver_id, delivery_date)
);

CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(delivery_date);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
"""


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def rows(conn, sql, params=()):
    return [dict(r) for r in conn.execute(sql, params).fetchall()]
