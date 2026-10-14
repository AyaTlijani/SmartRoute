"""
demo_seed.py — A lived-in demo company, written to the SQLite database.

What it creates (all fictional):

  past days   3 weeks of finished work for 5 drivers: routes sequenced with
              OR-Tools, start/end times, delivered and failed stops with
              reasons, proof photos, retries of failed orders, cash
              handovers confirmed by the admin (a few with a shortfall)

  today       a day in progress, so every screen has something to show:
                Ahmed    on the road, about 60% done
                Sami     just started
                Youssef  finished, cash declared, waiting for the admin
                Mehdi    planned, not started yet
                Karim    on the road, about half done
              plus unassigned orders in regions nobody covers

  tomorrow    confirmed orders imported but not planned, to demo
              "Plan routes" live

Built-in patterns for analytics: Manouba and Ben Arous fail more often, one
driver is slightly weaker, 12 phone numbers refuse most deliveries, Mondays
are busier, about 2% of deliveries collect a little less cash.
"""

import json
import os
import random
import struct
import zlib
from datetime import date, timedelta

import planning
from auth import hash_password
from distance import _estimate_minutes, _haversine_km
from route_eval import nearest_neighbour, simulate
from vrptw_solver import DAY_END, _minutes_to_time_str as clock, solve

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
PHOTOS = ["demo_parcel_1.png", "demo_parcel_2.png", "demo_parcel_3.png"]
FAIL_REASONS = (["No answer"] * 8 + ["Customer refused"] * 5 + ["Not at home"] * 4
                + ["Address not found"] * 2 + ["Other"])
GOV_FAIL_BONUS = {"Manouba": 0.10, "Ben Arous": 0.05}
WEAK_DRIVER = "Youssef Gharbi"


def _stamp(day, minutes):
    total = max(0, min(23 * 60 + 59, 9 * 60 + int(minutes)))
    return f"{day} {total // 60:02d}:{total % 60:02d}:00"


# ============================================================================
# PROOF PHOTOS (tiny generated PNGs: a parcel at a door)
# ============================================================================

def _png(width, height, pixel):
    raw = b"".join(b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(width)) for y in range(height))
    chunk = lambda tag, data: (struct.pack(">I", len(data)) + tag + data
                               + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _ensure_photos():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    doors = [(30, 90, 140), (120, 60, 50), (40, 110, 80)]
    for name, door in zip(PHOTOS, doors):
        path = os.path.join(UPLOAD_DIR, name)
        if os.path.exists(path):
            continue

        def pixel(x, y, door=door):
            if y > 190:
                return (150, 145, 135)                       # floor
            if 110 <= x <= 210 and 20 <= y <= 190:
                return door                                 # door
            if 135 <= x <= 245 and 120 <= y <= 205:          # parcel
                if 186 <= x <= 194 or 158 <= y <= 164:
                    return (220, 200, 150)                  # tape
                return (176, 128, 74)
            return (232, 228, 218)                           # wall
        with open(path, "wb") as f:
            f.write(_png(320, 240, pixel))


# ============================================================================
# HELPERS
# ============================================================================

def _insert_order(conn, day, o, status, driver_id=None, retry_of=None, precision="exact"):
    cur = conn.execute(
        "INSERT INTO orders (delivery_date, customer_name, phone, governorate, city, address, landmark, product, "
        "cod_amount, slot, notes, lat, lng, location_precision, status, driver_id, retry_of) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (day, o["customer_name"], o["phone"], o["governorate"], o["city"], o["address"], o["landmark"],
         o["product"], o["cod_amount_dt"], {"morning": 1, "afternoon": 2}.get(o["slot"], 0), o["notes"],
         o["lat"], o["lng"], precision, status, driver_id, retry_of))
    return cur.lastrowid


def _route_history(conn, drv, day, order_ids):
    """
    Sequence a past day's stops for one driver (OR-Tools, construction only,
    estimated travel times) and store stop numbers, ETAs, legs and the route.
    Returns [(order_id, arrival_minutes)] in route order and the dropped ids.
    """
    stops = [dict(conn.execute("SELECT id, lat, lng, slot FROM orders WHERE id = ?", (i,)).fetchone()) for i in order_ids]
    depot = [drv["depot_lng"], drv["depot_lat"]]
    coords = [depot] + [[s["lng"], s["lat"]] for s in stops]
    windows = [(0, DAY_END)] + [planning.SLOT_WINDOWS[s["slot"] or 0] for s in stops]
    matrix = [[_estimate_minutes(_haversine_km(a, b) * 1.3) for b in coords] for a in coords]
    result = solve(matrix, windows, [0] + [planning.SERVICE_MINUTES] * len(stops), [0], [0], [0],
                   drop_penalty=planning.DROP_PENALTY, improve=False)
    visited = result["routes"][0] if result else []
    order = [v["node"] for v in visited]
    prev = depot
    for k, v in enumerate(visited, start=1):
        here = coords[v["node"]]
        conn.execute("UPDATE orders SET stop_number = ?, eta = ?, leg_geometry = ? WHERE id = ?",
                     (k, clock(v["arrival"]), json.dumps([prev, here]), stops[v["node"] - 1]["id"]))
        prev = here
    if order:
        opt = simulate(order, matrix, windows, planning.SERVICE_MINUTES)
        base = simulate(nearest_neighbour(matrix, range(1, len(stops) + 1)), matrix, windows, planning.SERVICE_MINUTES)
        path = [depot] + [coords[j] for j in order] + [depot]
        km = sum(_haversine_km(a, b) * 1.3 for a, b in zip(path, path[1:]))
        conn.execute(
            "INSERT OR REPLACE INTO routes (driver_id, delivery_date, geometry, distance_km, driving_minutes, source, "
            "end_time, baseline_minutes, baseline_late, return_leg) VALUES (?, ?, ?, ?, ?, 'estimate', ?, ?, ?, ?)",
            (drv["id"], day, json.dumps(path), round(km, 1), opt["travel_minutes"], clock(opt["end_minutes"]),
             base["travel_minutes"], base["late_stops"], json.dumps([prev, depot])))
    visited_ids = [(stops[v["node"] - 1]["id"], v["arrival"]) for v in visited]
    dropped = [s["id"] for s in stops if s["id"] not in {i for i, _ in visited_ids}]
    return visited_ids, dropped


def _p_fail(o, driver_name, risky):
    if o["phone"] in risky:
        return 0.65
    return 0.10 + GOV_FAIL_BONUS.get(o["governorate"], 0) + (0.06 if driver_name == WEAK_DRIVER else 0)


def _record(conn, rng, order_id, drv, day, when, failed, cod, photo_ok=True):
    cash = 0 if failed else cod
    if not failed and rng.random() < 0.02:
        cash = round(cod - rng.choice([5, 10, 20]), 1)
    photo = rng.choice(PHOTOS) if (not failed and photo_ok and rng.random() < 0.35) else None
    conn.execute(
        "INSERT INTO attempts (order_id, driver_id, result, reason, cash_collected, photo_path, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (order_id, drv["id"], "failed" if failed else "delivered",
         rng.choice(FAIL_REASONS) if failed else None, cash, photo, when))
    conn.execute("UPDATE orders SET status = ? WHERE id = ?", ("failed" if failed else "delivered", order_id))
    return cash


# ============================================================================
# MAIN
# ============================================================================

def seed(conn, drivers_spec, admin_login, driver_password, make_order, risky_phones, phone, days=21, live_today=True):
    from sample_data import CITY_WEIGHTS  # noqa: F401  (same generator as the Excel samples)

    _ensure_photos()
    for table in ("sessions", "driver_days", "users", "attempts", "routes", "orders", "drivers"):
        conn.execute(f"DELETE FROM {table}")
    conn.execute("DELETE FROM sqlite_sequence")

    drivers = []
    for name, ph, vehicle, zones, (dname, dlat, dlng) in drivers_spec:
        cur = conn.execute("INSERT INTO drivers (name, phone, vehicle, zones, depot_name, depot_lat, depot_lng) "
                           "VALUES (?, ?, ?, ?, ?, ?, ?)", (name, ph, vehicle, zones, dname, dlat, dlng))
        conn.execute("INSERT INTO users (username, password_hash, role, driver_id, full_name) "
                     "VALUES (?, ?, 'driver', ?, ?)",
                     (name.split()[0].lower(), hash_password(driver_password), cur.lastrowid, name))
        drivers.append(dict(conn.execute("SELECT * FROM drivers WHERE id = ?", (cur.lastrowid,)).fetchone()))
    admin_id = conn.execute("INSERT INTO users (username, password_hash, role, full_name) VALUES (?, ?, 'admin', ?)",
                            (admin_login[0], hash_password(admin_login[1]), admin_login[2])).lastrowid

    rng = random.Random(42)
    risky = risky_phones()
    regulars = [phone(rng) for _ in range(60)]
    today = date.today()
    history = 0
    carry = []  # (original order id, order dict) retried the next day

    def new_order():
        pick = rng.random()
        ph = rng.choice(risky) if pick < 0.08 else rng.choice(regulars) if pick < 0.35 else None
        return make_order(rng, ph)

    # ------------------------------------------------------------- past days
    for back in range(days, 0, -1):
        day = (today - timedelta(days=back)).isoformat()
        n = rng.randint(28, 46) + (8 if (today - timedelta(days=back)).weekday() == 0 else 0)
        todays, carry = [(None, new_order()) for _ in range(n)] + carry, []
        per_driver = {d["id"]: [] for d in drivers}
        for retry_of, o in todays:
            covering = [d for d in drivers if o["governorate"] in d["zones"].split(",")]
            if not covering:
                continue  # far cities went to a partner courier
            drv = min(covering, key=lambda d: len(per_driver[d["id"]]) + rng.random())
            if len(per_driver[drv["id"]]) >= drv["max_orders"]:
                continue
            oid = _insert_order(conn, day, o, "assigned", drv["id"], retry_of)
            per_driver[drv["id"]].append((oid, o))

        for drv in drivers:
            mine = per_driver[drv["id"]]
            if not mine:
                continue
            by_id = {oid: o for oid, o in mine}
            visited, dropped = _route_history(conn, drv, day, [oid for oid, _ in mine])
            start = rng.randint(-15, 0)
            conn.execute("INSERT INTO driver_days (driver_id, day, started_at) VALUES (?, ?, ?)",
                         (drv["id"], day, _stamp(day, start)))
            t, collected = start, 0.0
            for oid, arrival in visited:
                o = by_id[oid]
                t = max(t + 3, arrival + rng.randint(-4, 9))
                failed = rng.random() < _p_fail(o, drv["name"], risky)
                collected += _record(conn, rng, oid, drv, day, _stamp(day, t), failed, o["cod_amount_dt"])
                if failed and back > 1 and rng.random() < 0.4:
                    carry.append((oid, o))
                history += 1
            for oid in dropped:  # never fitted the day: recorded as a failure
                conn.execute("INSERT INTO attempts (order_id, driver_id, result, reason, note, created_at) "
                             "VALUES (?, ?, 'failed', 'Other', 'Not reached before 6 PM', ?)",
                             (oid, drv["id"], _stamp(day, t + 5)))
                conn.execute("UPDATE orders SET status = 'failed' WHERE id = ?", (oid,))
            ended = _stamp(day, t + rng.randint(20, 40))
            declared = collected if rng.random() > 0.12 else round(collected - rng.choice([5, 10, 15, 20]), 1)
            conn.execute("UPDATE driver_days SET ended_at = ?, cash_declared = ?, cash_received = ?, "
                         "received_at = ?, received_by = ? WHERE driver_id = ? AND day = ?",
                         (ended, round(declared, 1), round(declared, 1), _stamp(day, t + rng.randint(45, 80)),
                          admin_id, drv["id"], day))

    if not live_today:
        return {"drivers": len(drivers), "history_attempts": history, "days": days}

    # ------------------------------------------------------------- today
    d = today.isoformat()
    trng = random.Random(today.toordinal())
    todays = [(oid, o) for oid, o in carry] + [(None, make_order(trng, trng.choice(risky) if trng.random() < 0.06 else None))
                                                 for _ in range(58)]
    for retry_of, o in todays:
        _insert_order(conn, d, o, "pending", retry_of=retry_of)
    # Two orders with only a governorate-level location (driver must call).
    for o in conn.execute("SELECT id FROM orders WHERE delivery_date = ? AND status = 'pending' "
                          "AND governorate IN ('Tunis', 'Ariana') LIMIT 2", (d,)).fetchall():
        conn.execute("UPDATE orders SET location_precision = 'governorate', city = 'Cite El Khadra' WHERE id = ?", (o["id"],))

    planning.plan_day(conn, d, "zones")

    progress = {"Ahmed Trabelsi": 0.6, "Sami Ben Ali": 0.25, "Youssef Gharbi": 1.0, "Karim Masmoudi": 0.5}
    for drv in drivers:
        share = progress.get(drv["name"])
        if share is None:
            continue  # Mehdi: planned, not started
        stops = conn.execute("SELECT id, cod_amount, phone, governorate, eta FROM orders WHERE delivery_date = ? "
                             "AND driver_id = ? AND status = 'assigned' AND stop_number IS NOT NULL "
                             "ORDER BY stop_number", (d, drv["id"])).fetchall()
        start = trng.randint(-15, -2)
        conn.execute("INSERT INTO driver_days (driver_id, day, started_at) VALUES (?, ?, ?)",
                     (drv["id"], d, _stamp(d, start)))
        t, collected = start, 0.0
        done = stops[: round(len(stops) * share)]
        for k, s in enumerate(done):
            hh, mm = map(int, s["eta"].split()[0].split(":"))
            arrival = (hh % 12 + (12 if s["eta"].endswith("PM") else 0)) * 60 + mm - 540
            t = max(t + 3, arrival + trng.randint(-3, 7))
            forced = drv["name"] == "Ahmed Trabelsi" and k == 2  # one visible failure to retry
            failed = forced or trng.random() < _p_fail(dict(s), drv["name"], risky) * 0.6
            cash = _record(conn, trng, s["id"], drv, d, _stamp(d, t), failed, s["cod_amount"])
            if drv["name"] == "Ahmed Trabelsi" and k == 1 and not failed:  # one visible cash shortfall
                cash = s["cod_amount"] - 10
                conn.execute("UPDATE attempts SET cash_collected = ? WHERE order_id = ?", (cash, s["id"]))
            collected += cash
        if share == 1.0:
            conn.execute("UPDATE driver_days SET ended_at = ?, cash_declared = ? WHERE driver_id = ? AND day = ?",
                         (_stamp(d, t + 25), round(collected - 15, 1), drv["id"], d))

    # ------------------------------------------------------------- tomorrow
    tm = (today + timedelta(days=1)).isoformat()
    mrng = random.Random(today.toordinal() + 1)
    for _ in range(46):
        _insert_order(conn, tm, make_order(mrng), "pending")

    return {"drivers": len(drivers), "history_attempts": history, "days": days, "today": d, "tomorrow": tm}
