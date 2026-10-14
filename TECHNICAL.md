# SmartRoute — Technical Documentation

This document describes what the code currently does. It does not describe planned features.


## 1. Purpose

SmartRoute is a web app for a small delivery company in Tunisia. It covers one delivery day:

1. An admin signs in and uploads an Excel file of confirmed orders.
2. The app checks every row. The admin fixes or excludes problem rows, then imports.
3. Orders are assigned to drivers by governorate, capacity and distance.
4. Each driver's stops are ordered by an OR-Tools route solver with time windows.
5. Each driver signs in on a phone and sees only their own stops. For each stop they record delivered (cash + optional photo) or failed (reason).
6. The admin follows progress on Overview, decides on failed orders (retry next day), and reads Analytics.

The original "Quick planner" (typed addresses to one route) is still available to admins.


## 2. Stack

Backend:
- Python, FastAPI, Uvicorn, Pydantic
- Google OR-Tools
- SQLite through the built-in sqlite3 module (no ORM)
- openpyxl, python-multipart, requests, python-dotenv
- Password hashing and tokens use the standard library (hashlib PBKDF2, secrets)

Frontend:
- React 18, Vite, Tailwind CSS
- react-router-dom (pages and route guards)
- lucide-react (icons)
- Leaflet, react-leaflet (maps), OpenStreetMap tiles
- axios
- IBM Plex Sans font (Google Fonts)

Tests: pytest and httpx (FastAPI TestClient), listed in `backend/requirements-dev.txt`.


## 3. Accounts and access

Roles:
- **admin**: every admin endpoint and page.
- **driver**: linked to one driver record. Can read only `/me/day`, and can only deliver, fail, undo or view the photo of orders assigned to them.

Login:
- `POST /auth/login` checks the PBKDF2-SHA256 hash (200,000 iterations, random salt).
- It creates a session row with a random 32-byte token valid for 7 days, and returns the token.
- The frontend stores the token in localStorage and sends `Authorization: Bearer <token>`.
- `POST /auth/logout` deletes the session. Resetting a driver's password deletes all of that driver's sessions.

Every endpoint except `/health`, `/auth/login` and `/auth/logout` requires a valid session:
- Wrong role: HTTP 403.
- Missing or expired session: HTTP 401, and the frontend returns to the login page.
- A disabled user account cannot sign in.

Demo accounts (created with the demo data):

    admin / admin123
    ahmed, sami, youssef, mehdi, karim / driver123

A database created by the earlier version (drivers but no users) gets these accounts at startup. Driver usernames are their first names.


## 4. Data model (SQLite)

The file is `backend/smartroute.db`; the `SMARTROUTE_DB` environment variable overrides the path. Foreign keys are on. Each request runs in one transaction that is rolled back on error. Columns added in this version are added to older databases with ALTER TABLE at startup.

drivers
- id, name, phone, vehicle
- zones: comma-separated governorates
- depot_name, depot_lat, depot_lng
- max_orders (default 20)
- active (1/0)

users
- id, username (unique, case-insensitive), password_hash, full_name, active, created_at
- role: "admin" or "driver"
- driver_id: set for drivers

sessions
- token, user_id, expires_at

orders
- id, delivery_date, customer_name, phone (8 digits), governorate, city, address, landmark, product, notes, created_at
- cod_amount (DT)
- slot: 0 any time, 1 morning, 2 afternoon
- lat, lng, location_precision ("exact", "city" or "governorate")
- status: pending, assigned, delivered or failed
- driver_id, stop_number, eta
- unscheduled_reason: why the solver could not fit this stop
- retry_of: the failed order this one retries. A unique index allows one retry per order.

attempts (one row per delivered/failed action)
- id, order_id, driver_id, result, reason, note, cash_collected
- photo_path: random file name in backend/uploads
- lat, lng, created_at (server local time)
- voided_at: set by undo; the row is kept

routes (one row per driver per day)
- driver_id, delivery_date
- geometry: [lng, lat] points, depot → stops → depot
- distance_km
- driving_minutes: on the solver's travel-time matrix, including the return to the depot
- source: "ors" or "estimate"
- end_time: when the driver is back at the depot
- baseline_minutes, baseline_late: the nearest-neighbour route on the same matrix

Order lifecycle:

    pending  --assign / manual-->  assigned  --driver-->  delivered | failed
    assigned --"Unassigned" / driver deactivated or zone removed-->  pending
    delivered | failed  --undo-->  assigned   (attempt kept, marked voided; locked once a retry exists)
    failed  --retry-->  new pending order on the next day with retry_of = original id (idempotent)


## 5. Travel times (provider and fallback)

`distance.py` is the only module that knows about the routing provider. The solver only receives a matrix of minutes.

- With `ORS_API_KEY`: the OpenRouteService matrix API gives travel times and the directions API gives road geometry and distance. If a call fails, the estimate is used for that route.
- Without a key: road distance = straight line × 1.3. Speed is 25 km/h under 15 km and 70 km/h otherwise, plus 2 minutes per trip. The geometry is straight segments between stops.

The routes table records which source was used. The Dispatch page shows "Estimated" or "Road network", and labels straight lines as "Stop order (straight lines)".


## 6. Locations

Resolution order for each order:
1. lat/lng columns in the Excel file, if inside Tunisia (lat 30–38, lng 7–12): "exact".
2. The city, if it is in the built-in table (about 40 places) and belongs to the same governorate: "city".
3. Otherwise the governorate's main city: "governorate". The import shows a warning; Orders, Dispatch and the driver screen show "Approximate location".

Orders are always identified by their numeric id. Two orders at the same address are separate stops.


## 7. Excel import

Files:
- `GET /excel/template`: empty template plus a "How to fill" sheet.
- `GET /excel/sample?day=`: 59 generated rows with deliberate problems:
  - a 7-digit phone
  - "Ariena"
  - a missing address
  - "cent dinars"
  - a duplicate customer
  - a "+216" prefix
  - "Benarous"
  - two unknown cities (approximate location)

Limits: `.xlsx` only, checked by extension and by zip signature. At most 5 MB and 2,000 rows.

Reading:
- First sheet, first row is the header.
- Headers are matched without regard to case, accents or separators.
- English, French and short names are accepted (for example nom, téléphone, gouvernorat, ville, adresse, montant, créneau).

Errors (row cannot be imported):
- missing name, phone, governorate, address or COD
- phone not 8 digits starting 2–9 after removing spaces and a 216/00216 prefix
- unknown governorate, with a "did you mean" suggestion when one is close. The 24 names, spelling variants, some Arabic names, and Djerba/Jerba (mapped to Medenine) are accepted.
- COD not a number or outside 0–10,000. "DT", "TND" and a decimal comma are accepted.
- unknown slot
- lat/lng outside Tunisia

Warnings (importable):
- same phone earlier in the file
- customer already has an order that day
- 2 or more past failed orders for that phone
- approximate location

Review screen:
- Tabs show rows that need a look, or all rows.
- "Use X" applies a suggestion. "Edit row" opens a form for every field. Both re-check all rows on the server (`/orders/revalidate`).
- Error rows cannot be ticked. Possible duplicates start unticked.
- On import, the server checks the ticked rows again and saves those without errors as pending. The page reports imported, rejected and excluded counts.


## 8. Assignment

`POST /dispatch/assign` handles the day's pending orders, sorted by governorate then latitude.

- **Eligible driver:** active, covers the governorate, has fewer than max_orders orders that day.
- **Choice:** the lowest score wins:

      score = orders already assigned + 0.5 × km from the order to the average position of the driver's orders
              (the depot when the driver has none)

- **No eligible driver:** the order stays pending, with a reason:
  - "No driver covers X"
  - "All drivers covering X are inactive"
  - "All drivers covering X are full"

Manual reassignment (`POST /orders/{id}/reassign`):
- The server checks the same eligibility and returns 400 with the reason.
- The Dispatch dropdown only lists eligible drivers.
- Both affected routes are recomputed.

When a driver is deactivated, or a zone is removed from them, their open orders from today on go back to pending.


## 9. Route optimization

`dispatch._route_driver` runs for one driver and day:
- **Input:** orders with status "assigned". Delivered and failed orders are left untouched and keep their stop numbers; new stop numbers continue after them.
- **Time model:** minutes after 9:00 AM.
  - depot: 0–540 (back by 6:00 PM)
  - any time: 0–480
  - morning: 0–180
  - afternoon: 240–480
  - 10 minutes service per stop
- **Solver** (`vrptw_solver.py`): OR-Tools routing with a time dimension and the windows above. It minimizes total travel time, starting and ending at the depot.
  - First solution: parallel cheapest insertion.
  - Improvement: guided local search for 1 second (8 stops or fewer) or 2 seconds.
  - Every stop is optional with a penalty of 100,000, so an impossible stop is skipped instead of making the whole route infeasible. The solution is good, not proven optimal.
- **Skipped stops** keep status "assigned" with no stop number, plus an unscheduled_reason:
  - "Too far to reach in its ... window: N min from the depot, window closes at ..."
  - "Can't reach it and return to the depot within the working day"
  - "The route is full in its ... window"

  The Dispatch page, the order detail, the driver screen and the Overview page all show it.
- **Scoring:** `route_eval.simulate` drives the route on the same matrix (waiting if early, counting late stops). The nearest-neighbour route is scored the same way. Both results are stored in the routes table.

Benchmark: `python evaluate.py` runs 30 generated days, with and without time windows. It compares Excel order, latitude order, nearest neighbour and OR-Tools on identical inputs. Results are in `backend/evaluation_results.md`.


## 10. Admin pages

The sidebar holds Overview, Import orders, Dispatch, Orders, Drivers, Analytics, and Quick planner under Tools. Overview, Import, Dispatch and Orders share a day picker (previous/next/today).

**Overview** (`GET /overview?day=`):
- Order counts, completion %, delivered-on-attempt %, cash collected vs expected, active drivers.
- **Needs attention** items, each linking to the right page:
  - no orders
  - unassigned orders
  - stops off the route
  - failed deliveries with no retry
  - cash gap
  - approximate locations
  - customers who refused before
- Per-driver progress bars, return time, and the last 8 driver updates.
- Refreshes every 20 seconds.

**Dispatch**:
- Summary strip, driver list (load/capacity, progress, driving minutes) and an Unassigned entry.
- Selected driver: driving time, distance, return time, cash, the comparison with nearest-stop-first, the map (stop markers colored by status), and the stop table with eligible-driver dropdowns.
- Buttons: Assign, and Re-optimize (recompute all routes).
- Refreshes every 15 seconds.

**Orders**:
- The day's orders, with status tabs and search by name, phone, city or id.
- Clicking an order opens its detail: fields, location precision, customer history, unscheduled reason, retry links, every attempt including undone ones (struck through), the proof photo (loaded through the authenticated endpoint), and "Retry next day" for failed orders.

**Drivers**:
- List with login, zones, depot, today's load / capacity, all-time delivered %, and an active switch.
- Add driver creates the driver and their login (username + temporary password). Edit changes name, phone, vehicle, capacity, depot (from a preset list) and zones (24 checkboxes). Password sets a new password.

**Analytics**: see section 12.

**Quick planner**: the original form. It needs ORS_API_KEY; without it, the server answers 503 with that explanation.


## 11. Driver app (phone)

Address `/driver`; only reachable with a driver session.

- **Header:** name, day, stops done, cash collected vs to collect, progress bar, planned return time.
- **Tabs:**
  - To do: the stops in route order. The next stop is open and highlighted.
  - Map: stops colored green, red or blue.
  - Done: each finished stop, with an Undo button.
- **An open stop shows:**
  - customer history and approximate-location badges, and the time slot
  - address, landmark, product, notes
  - the unscheduled reason, if any
  - Call (`tel:+216…`) and Navigate (Google Maps directions to the lat/lng)
- **Bottom bar:** Failed and Delivered.
  - Delivered: cash collected, pre-filled with the amount due. A gap warning appears if it's lower. An optional photo can be added; the phone camera opens directly. The client checks it is an image of 8 MB or less, and the server checks the size and that the bytes are JPEG, PNG or WebP. It's stored under a random name.
  - Failed: reason (No answer, Not at home, Customer refused, Address not found, Other) and an optional note.
  - The phone's position is sent if available within 3 seconds. Without GPS, the action is still saved.
- **Duplicate protection:** the button locks after one tap, and the server answers 409 if the order is no longer open. The app treats that as already saved.
- **Refresh:** every 30 seconds, so route changes made by dispatch appear.


## 12. Analytics definitions

Period: 7, 30 or 90 days ending today, by order delivery date. Undone attempts are always excluded.

- **Attempt success:** delivered attempts ÷ all attempts.
- **First-try delivery:** original orders (not retries) delivered on their first attempt ÷ original orders with at least one attempt.
- **Eventually delivered:** original orders delivered on any attempt in their retry chain ÷ the same denominator. Chains are followed with a recursive SQL query; a retry is never counted as a new order.
- **Cash gap:** COD due on delivered orders − cash recorded by drivers.

Charts and tables:
- attempts per day (delivered vs failed)
- per driver: attempt success, stops per working day, cash gap
- per governorate, lowest success first
- failure reasons
- phones with 2 or more failed attempts


## 13. Demo data

`sample_data.seed_demo` runs on first start when there are no drivers.

- **5 drivers:**
  - three at the Charguia hub covering Grand Tunis governorates
  - Sousse/Monastir/Mahdia, from a Sousse relay point
  - Sfax, from a Sfax relay point
- **Accounts:** one admin and one login per driver.
- **History:** 21 past days, 28–46 orders per day (more on Mondays).
  - About 40% of failed orders are retried the next day as linked orders.
  - Built-in patterns: base failure 10%, +10% in Manouba, +5% in Ben Arous, +6% for one driver, 65% for 12 "risky" phone numbers, and about 2% of deliveries short by 5–20 DT.
- **Names:** generated. A phone number always has the same name.


## 14. API reference

    Auth        POST /auth/login, POST /auth/logout, GET /auth/me, POST /auth/change-password
    Health      GET  /health
    Admin       GET  /overview?day=
                GET  /excel/template, GET /excel/sample?day=
                POST /orders/validate (form: file, day), POST /orders/revalidate, POST /orders/import
                GET  /orders?day=, GET /orders/{id}, DELETE /orders?day= (open orders without attempts)
                POST /dispatch/assign, POST /dispatch/reoptimize, GET /dispatch?day=
                POST /orders/{id}/reassign, POST /orders/{id}/retry
                GET  /drivers, POST /drivers, PUT /drivers/{id}, POST /drivers/{id}/password, GET /meta
                GET  /analytics?days=7|30|90
                POST /admin/demo/reset
                POST /optimize-route (Quick planner)
    Driver      GET  /me/day?day=
    Owner/admin POST /orders/{id}/deliver (form: cash_collected, lat?, lng?, photo?)
                POST /orders/{id}/fail, POST /orders/{id}/undo, GET /orders/{id}/photo

Interactive docs: http://localhost:8000/docs


## 15. Tests

`python -m pytest -q` in backend/ runs 17 end-to-end API tests. They use a temporary database and no API key, and cover:
- startup: no duplication on restart; accounts added to old databases
- auth and roles
- import errors, revalidation and persistence
- upload rejection
- zone, capacity and inactive-driver rules
- time windows; unscheduled stop explained
- OR-Tools ≤ nearest neighbour on random instances
- same-address orders kept distinct
- reassignment eligibility
- driver ownership, photo validation, double submit, undo history, idempotent retry and undo lock
- re-routing keeps finished stops
- analytics totals checked against SQL; 7-day vs 30-day filter
- overview attention items
- Quick planner without a key
- clearing a day keeps finished orders


## 16. Current limitations

- Local demo security only: no HTTPS, rate limiting or password-reset email. The token lives in localStorage. Not suitable for real customer data on a public server.
- Without an ORS key, travel times are estimates and the map shows straight lines.
- The location table holds about 40 places; elsewhere the governorate centre is used.
- One depot per driver. No hubs, live tracking, SMS/WhatsApp or offline mode.
- No failure-risk prediction model. Risk is shown with rules: past failed orders per phone.
