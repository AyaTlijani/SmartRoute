"""
clock.py — What time is it for a driver?

Two modes, set with the SMARTROUTE_CLOCK environment variable:

  real   the wall clock. What a real deployment uses.

  demo   (default) each driver's clock follows their own progress: the time
         of their last recorded stop, or of their start. Deliveries are
         stamped at a plausible time (their planned arrival, never before
         the previous stop). A demo opened at 10 PM therefore still behaves
         like a working day, instead of every remaining stop being "too
         late" because the real time is past 6 PM.

Times inside the planner are minutes after 9:00 AM.
"""

import os
import random
from datetime import datetime

DEMO = os.getenv("SMARTROUTE_CLOCK", "demo").strip().lower() != "real"


def _minutes(ts: str) -> int:
    hh, mm = int(ts[11:13]), int(ts[14:16])
    return hh * 60 + mm - 9 * 60


def _stamp(day: str, minutes: int) -> str:
    total = max(0, min(23 * 60 + 59, 9 * 60 + int(minutes)))
    return f"{day} {total // 60:02d}:{total % 60:02d}:00"


def wall_minutes() -> int:
    n = datetime.now()
    return n.hour * 60 + n.minute - 9 * 60


def driver_now(conn, driver_id: int, day: str) -> int:
    """Minutes after 9:00 for this driver on this day."""
    if not DEMO:
        return wall_minutes()
    last = conn.execute(
        "SELECT a.created_at FROM attempts a JOIN orders o ON o.id = a.order_id WHERE a.driver_id = ? "
        "AND o.delivery_date = ? AND a.voided_at IS NULL ORDER BY a.created_at DESC LIMIT 1",
        (driver_id, day)).fetchone()
    if last:
        return _minutes(last["created_at"])
    start = conn.execute("SELECT started_at FROM driver_days WHERE driver_id = ? AND day = ?",
                         (driver_id, day)).fetchone()
    return _minutes(start["started_at"]) if start and start["started_at"] else 0


def attempt_time(conn, order) -> str:
    """Timestamp for a delivered/failed action on this order."""
    if not DEMO:
        return datetime.now().isoformat(sep=" ", timespec="seconds")
    now = driver_now(conn, order["driver_id"], order["delivery_date"])
    planned = _minutes(f"0000-00-00 {_eta_24h(order['eta'])}") if order["eta"] else now
    return _stamp(order["delivery_date"], max(now + 3, planned + random.randint(-4, 6)))


def start_time(day: str) -> str:
    if not DEMO:
        return datetime.now().isoformat(sep=" ", timespec="seconds")
    return _stamp(day, random.randint(-15, 0))  # left the depot between 8:45 and 9:00


def end_time(conn, driver_id: int, day: str) -> str:
    if not DEMO:
        return datetime.now().isoformat(sep=" ", timespec="seconds")
    return _stamp(day, driver_now(conn, driver_id, day) + random.randint(20, 40))  # drive back


def _eta_24h(eta: str) -> str:
    """'2:35 PM' → '14:35'."""
    clock, period = eta.split()
    h, m = map(int, clock.split(":"))
    h = h % 12 + (12 if period == "PM" else 0)
    return f"{h:02d}:{m:02d}"
