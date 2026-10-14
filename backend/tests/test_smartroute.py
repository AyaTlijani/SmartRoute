"""
End-to-end API tests for SmartRoute.

Run from backend/:   python -m pytest -q

Every test gets a fresh SQLite file with the demo data, and the ORS key is
disabled so routing uses the offline estimate (deterministic, no network).
"""

import io
import os
import random
import sys
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["ORS_API_KEY"] = ""

import config  # noqa: E402

config.USE_ORS = False
import distance  # noqa: E402

distance.USE_ORS = False

from fastapi.testclient import TestClient  # noqa: E402

import db  # noqa: E402
import main  # noqa: E402
import sample_data  # noqa: E402
from orders_import import TEMPLATE_HEADERS  # noqa: E402
from route_eval import nearest_neighbour, simulate  # noqa: E402
from vrptw_solver import solve_vrptw  # noqa: E402

TODAY = date.today().isoformat()
PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00"
       b"\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "test.db"))
    with TestClient(main.app) as c:
        yield c


def login(c, username, password):
    r = c.post("/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture()
def admin(client):
    return login(client, "admin", "admin123")


def raw_rows(content):
    from orders_import import read_excel
    return read_excel(content)


def import_sample(c, admin, day=TODAY):
    xlsx = c.get("/excel/sample", params={"day": day}, headers=admin).content
    v = c.post("/orders/validate", files={"file": ("o.xlsx", xlsx)}, data={"day": day}, headers=admin).json()
    rows = [r["raw"] for r in v["rows"] if not r["errors"]]
    return c.post("/orders/import", json={"day": day, "rows": rows}, headers=admin).json()


def row(**kw):
    base = {"customer_name": "Test Customer", "phone": "22111222", "governorate": "Tunis",
            "city": "Tunis Centre", "address": "1 Rue de Test", "landmark": "", "product": "Box",
            "cod_amount_dt": 50, "slot": "", "notes": "", "lat": "", "lng": ""}
    base.update(kw)
    return base


# ---------------------------------------------------------------- A. startup

def test_seed_runs_once_and_restart_does_not_duplicate(client, admin):
    n1 = len(client.get("/drivers", headers=admin).json())
    with TestClient(main.app):  # second startup on the same database
        pass
    assert len(client.get("/drivers", headers=admin).json()) == n1 == 5


def test_old_database_gets_accounts(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", str(tmp_path / "old.db"))
    db.init_db()
    with db.connect() as conn:
        sample_data.seed_demo(conn)
        conn.execute("DELETE FROM users")
    with TestClient(main.app) as c:
        login(c, "admin", "admin123")
        login(c, "ahmed", "driver123")


# ---------------------------------------------------------------- auth

def test_auth_and_roles(client, admin):
    assert client.get("/dispatch").status_code == 401
    assert client.post("/auth/login", json={"username": "admin", "password": "nope"}).status_code == 401
    driver = login(client, "ahmed", "driver123")
    assert client.get("/dispatch", headers=driver).status_code == 403
    assert client.get("/analytics", headers=driver).status_code == 403
    assert client.get("/me/day", headers=admin).status_code == 403
    client.post("/auth/logout", headers=driver)
    assert client.get("/me/day", headers=driver).status_code == 401


# ---------------------------------------------------------------- B. Excel

def test_excel_validation_and_import(client, admin):
    assert client.get("/excel/template", headers=admin).status_code == 200
    xlsx = client.get("/excel/sample", headers=admin).content
    v = client.post("/orders/validate", files={"file": ("o.xlsx", xlsx)}, data={"day": TODAY}, headers=admin).json()
    assert v["summary"]["error"] == 4
    msgs = " ".join(m for r in v["rows"] for m in r["errors"] + r["warnings"])
    assert "Invalid phone" in msgs and "did you mean Ariana" in msgs
    assert "Missing address" in msgs and "Invalid cash amount" in msgs and "possible duplicate" in msgs
    assert "Approximate location" in msgs

    # Correct the typo and re-check: one error fewer.
    raw = [r["raw"] for r in v["rows"]]
    typo = next(r for r in v["rows"] if r["suggestions"])
    raw[v["rows"].index(typo)]["governorate"] = typo["suggestions"]["governorate"]
    v2 = client.post("/orders/revalidate", json={"day": TODAY, "rows": raw}, headers=admin).json()
    assert v2["summary"]["error"] == 3

    res = client.post("/orders/import", json={"day": TODAY, "rows": raw}, headers=admin).json()
    assert res["imported"] == v2["summary"]["total"] - 3 and res["rejected"] == 3

    # Persisted: visible through a brand-new connection.
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM orders WHERE delivery_date = ?", (TODAY,)).fetchone()[0] == res["imported"]


def test_upload_rejects_bad_files(client, admin):
    r = client.post("/orders/validate", files={"file": ("x.csv", b"a,b")}, headers=admin)
    assert r.status_code == 400
    r = client.post("/orders/validate", files={"file": ("x.xlsx", b"not a zip")}, headers=admin)
    assert r.status_code == 400


# ---------------------------------------------------------------- C. dispatch

def test_assignment_respects_zones_capacity_and_activity(client, admin):
    drivers = client.get("/drivers", headers=admin).json()
    sami = next(d for d in drivers if d["name"].startswith("Sami"))
    youssef = next(d for d in drivers if d["name"].startswith("Youssef"))
    body = lambda d, **kw: {**{k: d[k] for k in ("name", "phone", "vehicle", "depot_name", "depot_lat",
                                                 "depot_lng", "max_orders")},
                            "zones": d["zones"].split(","), "active": True, **kw}
    client.put(f"/drivers/{sami['id']}", json=body(sami, max_orders=3), headers=admin)
    client.put(f"/drivers/{youssef['id']}", json=body(youssef, active=False), headers=admin)

    import_sample(client, admin)
    view = client.post("/dispatch/assign", json={"day": TODAY}, headers=admin).json()
    for d in view["drivers"]:
        zones = d["zones"].split(",")
        assert all(o["governorate"] in zones for o in d["orders"])
        assert len(d["orders"]) <= d["max_orders"]
        if d["id"] == youssef["id"]:
            assert not d["orders"]
        if d["id"] == sami["id"]:
            assert len(d["orders"]) <= 3
    reasons = {o["reason"] for o in view["unassigned"]}
    assert any(r.startswith("No driver covers") for r in reasons)


def test_routes_respect_time_windows_and_beat_or_match_baseline(client, admin):
    import_sample(client, admin)
    view = client.post("/dispatch/assign", json={"day": TODAY}, headers=admin).json()
    routed = [d for d in view["drivers"] if d["route"]]
    assert routed
    windows = {0: (0, 480), 1: (0, 180), 2: (240, 480)}
    for d in routed:
        for o in d["orders"]:
            if o["stop_number"]:
                h, m = map(int, o["eta"].split()[0].split(":"))
                h = h % 12 + (12 if o["eta"].endswith("PM") else 0)
                minutes = h * 60 + m - 540
                lo, hi = windows[o["slot"]]
                assert lo <= minutes <= hi, (o["eta"], o["slot"])
            else:
                assert o["unscheduled_reason"]
        assert d["route"]["end_time"]


def test_solver_beats_nearest_neighbour_without_windows():
    rng = random.Random(3)
    wins = 0
    for _ in range(5):
        pts = [(rng.uniform(0, 30), rng.uniform(0, 30)) for _ in range(15)]
        m = [[round(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 * 2) for b in pts] for a in pts]
        w = [(0, 10_000)] * len(pts)
        sol = solve_vrptw({"time_matrix": m, "time_windows": w, "num_vehicles": 1, "depot": 0,
                           "service_time": 0, "addresses": [""] * len(pts), "time_limit_seconds": 1})
        opt = simulate([s["node"] for s in sol], m, w, 0)["travel_minutes"]
        nn = simulate(nearest_neighbour(m, range(1, len(pts))), m, w, 0)["travel_minutes"]
        assert opt <= nn
        wins += opt < nn
    assert wins >= 3  # strictly better on most random instances


def test_unschedulable_stop_is_explained(client, admin):
    client.post("/drivers", headers=admin, json={
        "name": "Far Away", "phone": "22000111", "vehicle": "car", "zones": ["Tataouine"],
        "depot_name": "SmartRoute Hub, Charguia", "depot_lat": 36.84, "depot_lng": 10.205,
        "max_orders": 5, "username": "faraway", "password": "secret1"})
    client.post("/orders/import", headers=admin, json={"day": TODAY, "rows": [
        row(governorate="Tataouine", city="", slot="morning", phone="22333444")]})
    view = client.post("/dispatch/assign", json={"day": TODAY}, headers=admin).json()
    far = next(d for d in view["drivers"] if d["name"] == "Far Away")
    o = far["orders"][0]
    assert o["status"] == "assigned" and o["stop_number"] is None
    assert o["unscheduled_reason"].startswith("Too far")
    assert far["stats"]["unscheduled"] == 1


def test_same_address_orders_stay_distinct(client, admin):
    same = dict(address="5 Rue Identique", city="El Menzah", lat=36.838, lng=10.17)
    client.post("/orders/import", headers=admin, json={"day": TODAY, "rows": [
        row(customer_name="First", phone="22100100", **same), row(customer_name="Second", phone="22100200", **same)]})
    view = client.post("/dispatch/assign", json={"day": TODAY}, headers=admin).json()
    orders = [o for d in view["drivers"] for o in d["orders"]]
    assert {o["customer_name"] for o in orders} == {"First", "Second"}
    assert len({o["id"] for o in orders}) == 2 and all(o["stop_number"] for o in orders)


def test_reassign_checks_eligibility(client, admin):
    import_sample(client, admin)
    view = client.post("/dispatch/assign", json={"day": TODAY}, headers=admin).json()
    tunis_order = next(o for d in view["drivers"] for o in d["orders"] if o["governorate"] == "Tunis")
    karim = next(d for d in view["drivers"] if d["name"].startswith("Karim"))  # Sfax only
    r = client.post(f"/orders/{tunis_order['id']}/reassign", json={"driver_id": karim["id"]}, headers=admin)
    assert r.status_code == 400 and "does not cover" in r.json()["detail"]
    r = client.post(f"/orders/{tunis_order['id']}/reassign", json={"driver_id": None}, headers=admin)
    assert any(o["id"] == tunis_order["id"] for o in r.json()["unassigned"])


# ---------------------------------------------------------------- D. driver

def test_driver_flow_ownership_duplicates_undo_retry(client, admin):
    import_sample(client, admin)
    client.post("/dispatch/assign", json={"day": TODAY}, headers=admin)
    ahmed = login(client, "ahmed", "driver123")
    sami = login(client, "sami", "driver123")
    mine = client.get("/me/day", headers=ahmed).json()
    assert mine["name"] == "Ahmed Trabelsi" and mine["orders"]
    o1, o2 = mine["orders"][0], mine["orders"][1]

    # Another driver can't touch Ahmed's order.
    assert client.post(f"/orders/{o1['id']}/deliver", data={"cash_collected": 1}, headers=sami).status_code == 403
    # Fake image rejected, real PNG accepted, double submit refused.
    bad = client.post(f"/orders/{o1['id']}/deliver", data={"cash_collected": o1["cod_amount"]},
                      files={"photo": ("x.jpg", b"hello")}, headers=ahmed)
    assert bad.status_code == 400
    ok = client.post(f"/orders/{o1['id']}/deliver", data={"cash_collected": o1["cod_amount"] - 10},
                     files={"photo": ("p.png", PNG)}, headers=ahmed)
    assert ok.status_code == 200
    again = client.post(f"/orders/{o1['id']}/deliver", data={"cash_collected": 1}, headers=ahmed)
    assert again.status_code == 409
    assert client.get(f"/orders/{o1['id']}/photo", headers=ahmed).content == PNG
    assert client.get(f"/orders/{o1['id']}/photo", headers=sami).status_code == 403

    # Failure needs a known reason; undo keeps the attempt (voided).
    assert client.post(f"/orders/{o2['id']}/fail", json={"reason": "Bored"}, headers=ahmed).status_code == 400
    assert client.post(f"/orders/{o2['id']}/fail", json={"reason": "No answer"}, headers=ahmed).status_code == 200
    assert client.post(f"/orders/{o2['id']}/undo", headers=ahmed).status_code == 200
    with db.connect() as conn:
        a = conn.execute("SELECT voided_at FROM attempts WHERE order_id = ?", (o2["id"],)).fetchall()
    assert len(a) == 1 and a[0]["voided_at"]

    # Fail again, retry twice → one linked retry; undo is then locked.
    client.post(f"/orders/{o2['id']}/fail", json={"reason": "Not at home"}, headers=ahmed)
    r1 = client.post(f"/orders/{o2['id']}/retry", headers=admin).json()
    r2 = client.post(f"/orders/{o2['id']}/retry", headers=admin).json()
    assert r1["retry_order_id"] == r2["retry_order_id"] and r1["created"] and not r2["created"]
    assert client.post(f"/orders/{o2['id']}/undo", headers=ahmed).status_code == 409

    day = client.get("/me/day", headers=ahmed).json()
    assert day["stats"]["delivered"] == 1 and day["stats"]["failed"] == 1
    assert day["stats"]["cash_collected"] == round(o1["cod_amount"] - 10, 1)


def test_rerouting_keeps_finished_stops(client, admin):
    import_sample(client, admin)
    client.post("/dispatch/assign", json={"day": TODAY}, headers=admin)
    ahmed = login(client, "ahmed", "driver123")
    first = client.get("/me/day", headers=ahmed).json()["orders"][0]
    client.post(f"/orders/{first['id']}/deliver", data={"cash_collected": first["cod_amount"]}, headers=ahmed)
    client.post("/dispatch/reoptimize", json={"day": TODAY}, headers=admin)
    after = client.get("/me/day", headers=ahmed).json()["orders"]
    kept = next(o for o in after if o["id"] == first["id"])
    assert kept["status"] == "delivered" and kept["stop_number"] == first["stop_number"]
    assert all(o["stop_number"] > first["stop_number"] for o in after if o["status"] == "assigned" and o["stop_number"])


# ---------------------------------------------------------------- E. analytics

def test_analytics_matches_database(client, admin):
    a30 = client.get("/analytics", params={"days": 30}, headers=admin).json()
    a7 = client.get("/analytics", params={"days": 7}, headers=admin).json()
    start = (date.today() - timedelta(days=29)).isoformat()
    with db.connect() as conn:
        n, delivered, gap = conn.execute(
            "SELECT COUNT(*), SUM(a.result='delivered'), "
            "SUM(CASE WHEN a.result='delivered' THEN o.cod_amount - a.cash_collected ELSE 0 END) "
            "FROM attempts a JOIN orders o ON o.id = a.order_id "
            "WHERE a.voided_at IS NULL AND o.delivery_date BETWEEN ? AND ?", (start, TODAY)).fetchone()
    t = a30["totals"]
    assert t["attempts"] == n and t["delivered"] == delivered
    assert round(t["cash_expected"] - t["cash_collected"], 1) == round(gap, 1)
    assert a7["totals"]["attempts"] < t["attempts"]
    assert sum(d["attempts"] for d in a30["by_driver"]) == n
    o = a30["orders"]
    assert o["retried"] > 0 and o["first_try_rate"] <= o["eventual_rate"] <= 100


def test_overview_flags_attention(client, admin):
    import_sample(client, admin)
    ov = client.get("/overview", headers=admin).json()
    assert ov["counts"]["pending"] == ov["counts"]["total"] > 0
    assert any("unassigned" in a["title"] for a in ov["attention"])


# ---------------------------------------------------------------- F. regression

def test_quick_planner_explains_missing_key(client, admin):
    r = client.post("/optimize-route", headers=admin, json={
        "depot_address": "Avenue Habib Bourguiba, Tunis", "deliveries": [{"address": "La Marsa, Tunisia", "slot": 1}]})
    assert r.status_code == 503 and "ORS_API_KEY" in r.json()["detail"]


def test_clear_day_keeps_finished_orders(client, admin):
    import_sample(client, admin)
    client.post("/dispatch/assign", json={"day": TODAY}, headers=admin)
    ahmed = login(client, "ahmed", "driver123")
    o = client.get("/me/day", headers=ahmed).json()["orders"][0]
    client.post(f"/orders/{o['id']}/deliver", data={"cash_collected": o["cod_amount"]}, headers=ahmed)
    client.delete("/orders", params={"day": TODAY}, headers=admin)
    left = client.get("/orders", params={"day": TODAY}, headers=admin).json()
    assert [x["id"] for x in left] == [o["id"]]
