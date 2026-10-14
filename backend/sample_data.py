"""
sample_data.py — Realistic Tunisian demo data.

    seed_demo(conn)          drivers + 3 weeks of past deliveries
    sample_orders_xlsx(day)  a day's confirmed-orders Excel file,
                             with a few deliberate mistakes to catch
    template_xlsx()          the empty template admins fill in
"""

import io
import random
from datetime import date, timedelta

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

from orders_import import TEMPLATE_HEADERS
from tunisia import CITIES

HUB = ("SmartRoute Hub, Charguia", 36.8400, 10.2050)

DRIVERS = [
    # name, phone, vehicle, zones, depot (name, lat, lng)
    ("Ahmed Trabelsi", "98123456", "scooter", "Tunis,Ariana", HUB),
    ("Sami Ben Ali", "55234567", "scooter", "Tunis,Ben Arous", HUB),
    ("Youssef Gharbi", "22345678", "car", "Ariana,Manouba,Ben Arous", HUB),
    ("Mehdi Jlassi", "97456789", "car", "Sousse,Monastir,Mahdia", ("Sousse relay point", 35.8256, 10.6084)),
    ("Karim Masmoudi", "50567890", "car", "Sfax", ("Sfax relay point", 34.7406, 10.7603)),
]

FIRST = ["Amira", "Mohamed", "Fatma", "Ahmed", "Yasmine", "Oussema", "Sarra", "Khalil",
         "Nour", "Aymen", "Rania", "Hamza", "Ines", "Skander", "Mariem", "Wassim",
         "Salma", "Bilel", "Eya", "Firas", "Olfa", "Hichem", "Chaima", "Seif"]
LAST = ["Ben Salah", "Trabelsi", "Jaziri", "Gharbi", "Hammami", "Mansouri", "Ayari",
        "Chaabane", "Dridi", "Ferchichi", "Khemiri", "Mejri", "Saidi", "Zouari",
        "Baccouche", "Chebbi", "Jebali", "Kefi", "Brahmi", "Masmoudi"]
STREETS = ["Rue de Marseille", "Avenue Habib Bourguiba", "Rue Ibn Khaldoun",
           "Avenue de la Liberte", "Rue de Palestine", "Avenue Hedi Nouira",
           "Rue 18 Janvier", "Rue Farhat Hached", "Avenue Taieb Mhiri", "Rue Mongi Slim"]
LANDMARKS = ["Near the pharmacy", "Behind the mosque", "Next to Monoprix",
             "In front of the school", "Above the bakery", "Blue door, 2nd floor",
             "Near the Total station", "Opposite the post office", ""]
PRODUCTS = ["Sneakers size 42", "Black hoodie L", "Phone case", "Perfume 100ml",
            "Leather handbag", "Kids dress", "Smart watch", "Hair dryer", "Makeup kit",
            "Bluetooth earbuds", "Abaya", "Kitchen set"]
FAIL_REASONS = (["No answer"] * 8 + ["Customer refused"] * 5 + ["Not at home"] * 4
                + ["Wrong address"] * 2 + ["Other"])

# Where orders come from: Grand Tunis dominates, a few from far cities
# that no driver covers (they show up as "unassigned").
CITY_WEIGHTS = (
    [(c, 6) for c, (g, *_ ) in CITIES.items() if g in ("Tunis", "Ariana", "Ben Arous", "Manouba")]
    + [(c, 3) for c, (g, *_ ) in CITIES.items() if g in ("Sousse", "Monastir")]
    + [("Sfax Centre", 4), ("Sakiet Ezzit", 2), ("Hammamet", 1), ("Nabeul Centre", 1),
       ("Djerba Houmt Souk", 1), ("Bizerte Centre", 1)]
)
GOV_FAIL_BONUS = {"Manouba": 0.10, "Ben Arous": 0.05}


def _phone(rng):
    return rng.choice("2459") + "".join(rng.choice("0123456789") for _ in range(7))


def _risky_phones():
    rng = random.Random(7)
    return [_phone(rng) for _ in range(12)]


def _name_for(phone):
    """Same phone number → same customer name across days."""
    r = random.Random(phone)
    return f"{r.choice(FIRST)} {r.choice(LAST)}"


def _make_order(rng, phone=None):
    city = rng.choices([c for c, _ in CITY_WEIGHTS], [w for _, w in CITY_WEIGHTS])[0]
    gov, lat, lng = CITIES[city]
    phone = phone or _phone(rng)
    return {
        "customer_name": _name_for(phone),
        "phone": phone,
        "governorate": gov,
        "city": city,
        "address": f"{rng.randint(1, 120)} {rng.choice(STREETS)}",
        "landmark": rng.choice(LANDMARKS),
        "product": rng.choice(PRODUCTS),
        "cod_amount_dt": round(rng.uniform(25, 180) * 2) / 2,
        "slot": rng.choices(["morning", "afternoon", ""], [1, 1, 2])[0],
        "notes": rng.choice(["", "", "", "Call before arriving", "Leave with the guard"]),
        # ~1.5 km spread around the city centre, like a shared GPS pin.
        "lat": round(lat + rng.uniform(-0.012, 0.012), 5),
        "lng": round(lng + rng.uniform(-0.012, 0.012), 5),
    }


def seed_demo(conn, days: int = 21) -> dict:
    """Wipe everything, add drivers and `days` days of finished deliveries."""
    for table in ("attempts", "routes", "orders", "drivers"):
        conn.execute(f"DELETE FROM {table}")
    conn.execute("DELETE FROM sqlite_sequence")

    driver_ids = []
    for name, phone, vehicle, zones, (dname, dlat, dlng) in DRIVERS:
        cur = conn.execute(
            "INSERT INTO drivers (name, phone, vehicle, zones, depot_name, depot_lat, depot_lng) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, phone, vehicle, zones, dname, dlat, dlng),
        )
        driver_ids.append((cur.lastrowid, zones.split(","), name))

    rng = random.Random(42)
    risky = _risky_phones()
    regulars = [_phone(rng) for _ in range(60)]
    today = date.today()
    count = 0

    for back in range(days, 0, -1):
        day = today - timedelta(days=back)
        n = rng.randint(28, 46) + (8 if day.weekday() == 0 else 0)  # busier Mondays
        for _ in range(n):
            pick = rng.random()
            phone = rng.choice(risky) if pick < 0.08 else rng.choice(regulars) if pick < 0.35 else None
            o = _make_order(rng, phone)
            covering = [d for d in driver_ids if o["governorate"] in d[1]]
            if not covering:
                continue  # far-city orders were handled by a partner courier
            driver_id, _, dname = rng.choice(covering)
            p_fail = 0.10 + GOV_FAIL_BONUS.get(o["governorate"], 0)
            p_fail += 0.06 if dname == "Youssef Gharbi" else 0
            p_fail = 0.65 if o["phone"] in risky else p_fail
            failed = rng.random() < p_fail
            cur = conn.execute(
                "INSERT INTO orders (delivery_date, customer_name, phone, governorate, city, "
                "address, landmark, product, cod_amount, slot, notes, lat, lng, "
                "location_precision, status, driver_id) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'exact', ?, ?)",
                (day.isoformat(), o["customer_name"], o["phone"], o["governorate"], o["city"],
                 o["address"], o["landmark"], o["product"], o["cod_amount_dt"],
                 {"morning": 1, "afternoon": 2}.get(o["slot"], 0), o["notes"],
                 o["lat"], o["lng"], "failed" if failed else "delivered", driver_id),
            )
            cash = 0 if failed else o["cod_amount_dt"]
            if not failed and rng.random() < 0.02:
                cash = round(cash - rng.choice([5, 10, 20]), 1)  # occasional shortfall
            hour = rng.randint(9, 17)
            conn.execute(
                "INSERT INTO attempts (order_id, driver_id, result, reason, cash_collected, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (cur.lastrowid, driver_id, "failed" if failed else "delivered",
                 rng.choice(FAIL_REASONS) if failed else None, cash,
                 f"{day.isoformat()} {hour:02d}:{rng.randint(0, 59):02d}:00"),
            )
            count += 1

    return {"drivers": len(DRIVERS), "history_orders": count, "days": days}


def _workbook(rows, title="Orders"):
    wb = Workbook()
    ws = wb.active
    ws.title = title
    ws.append(TEMPLATE_HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1E40AF")
    for r in rows:
        ws.append([r.get(h, "") for h in TEMPLATE_HEADERS])
    widths = {"customer_name": 22, "address": 28, "landmark": 24, "product": 20, "notes": 22}
    for i, h in enumerate(TEMPLATE_HEADERS):
        ws.column_dimensions[ws.cell(1, i + 1).column_letter].width = widths.get(h, 14)
    ws.freeze_panes = "A2"
    return wb


def _to_bytes(wb):
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def template_xlsx() -> bytes:
    wb = _workbook([
        {"customer_name": "Amira Ben Salah", "phone": "22345678", "governorate": "Ariana",
         "city": "La Soukra", "address": "12 Rue des Roses", "landmark": "Near the pharmacy",
         "product": "Sneakers size 41", "cod_amount_dt": 89.5, "slot": "morning",
         "notes": "Call before arriving"},
    ])
    info = wb.create_sheet("How to fill")
    for line in [
        ["Required: customer_name, phone, governorate, address, cod_amount_dt"],
        ["phone: 8 digits, +216 prefix is fine"],
        ["governorate: one of the 24 (Tunis, Ariana, Ben Arous, Sfax, ...)"],
        ["slot: morning (9-12), afternoon (13-17) or empty for any time"],
        ["lat / lng: optional GPS pin; without it the city or governorate centre is used"],
        ["Delete the example row before uploading."],
    ]:
        info.append(line)
    info.column_dimensions["A"].width = 80
    return _to_bytes(wb)


def sample_orders_xlsx(day: date, n: int = 58) -> bytes:
    """A realistic day of confirmed orders, including 5 rows to catch."""
    rng = random.Random(day.toordinal())
    risky = _risky_phones()
    rows = [_make_order(rng, rng.choice(risky) if rng.random() < 0.07 else None) for _ in range(n)]
    for r in rows[::5]:
        r["lat"] = r["lng"] = ""  # some rows without a GPS pin → city lookup

    # Deliberate problems the validator should flag:
    rows[3]["phone"] = "2234 567"             # 7 digits
    rows[8]["governorate"] = "Ariena"          # typo → "did you mean Ariana?"
    rows[8]["lat"] = rows[8]["lng"] = ""
    rows[8]["city"] = "Ennasr"
    rows[13]["address"] = ""                   # missing address
    rows[17]["cod_amount_dt"] = "cent dinars"  # not a number
    dup = dict(rows[5]); dup["product"] = rng.choice(PRODUCTS)
    rows.insert(20, dup)                       # same customer twice
    rows[25]["phone"] = "+216 " + rows[25]["phone"]  # valid, prefix stripped
    rows[30]["governorate"] = "Benarous"       # alias → Ben Arous
    return _to_bytes(_workbook(rows))
