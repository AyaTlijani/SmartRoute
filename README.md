# SmartRoute

A dispatch console for small Tunisian delivery companies. Confirmed orders arrive as an Excel file in the morning. SmartRoute checks them, assigns them to drivers by zone, plans each driver's route with Google OR-Tools, and follows every delivery and every dinar collected.

There are two kinds of accounts:
- **Admin** (web console): imports orders, dispatches, manages drivers and their logins, sees analytics.
- **Driver** (phone screen): sees only their own deliveries for the day. They call the customer, navigate, and mark each stop delivered (cash + optional photo) or failed (reason). Mistakes can be undone.

Everything runs locally with generated demo data and **no API key**.

## Run it

Backend (Python 3.11+), from `backend/`:

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Frontend (Node 18+), from `frontend/`:

```bash
npm install
npm run dev
```

Open http://localhost:5173 and sign in.

| Account | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Drivers | `ahmed`, `sami`, `youssef`, `mehdi`, `karim` | `driver123` |

On first start, the backend creates `backend/smartroute.db` with 5 drivers, their logins and 3 weeks of delivery history. Restarting does not duplicate anything. To start over, stop the backend and delete `smartroute.db`. Databases from the earlier version are upgraded automatically, and their drivers get the logins above.

To use a phone on the same Wi-Fi, open the "Network" address Vite prints (for example `http://192.168.1.20:5173`) and sign in as a driver.

## Demo in 3 minutes

1. **Import orders:** download **Sample day**, then drop it back in. Four rows are rejected (bad phone, "Ariena", missing address, "cent dinars"), and a duplicate is left unticked. Click **Use Ariana**, fix the missing address with **Edit row**, then import.
2. **Dispatch:** click **Assign**. Orders go to drivers who cover their governorate and have room. Each route is optimized with time windows. Djerba and Nabeul stay unassigned, with the reason. Each route is compared with a nearest-stop-first route on the same data.
3. **Driver:** in another browser or a phone, sign in as `ahmed`. Deliver a stop with a photo and a short cash amount, and fail another.
4. **Overview:** the cash gap and the failed delivery appear under **Needs attention**. Open the failed order and schedule a retry.
5. **Analytics:** attempt success, first-try and eventual delivery, the cash gap per driver, weak governorates and customers who keep refusing.

## How routing works

For each driver and day:
- The stops start and end at the driver's depot. The working day is 9:00 AM–6:00 PM, with 10 minutes at each stop.
- Morning orders must be reached between 9:00 AM and 12:00 PM, afternoon orders between 1:00 PM and 5:00 PM.
- OR-Tools minimizes driving time:
  1. **Cheapest insertion:** builds a first valid route by inserting each stop where it adds the least time.
  2. **Guided local search:** keeps improving that route for 1–2 seconds by trying swaps and moves.
- A stop that cannot fit its window is never dropped silently. It stays on the driver's list with the reason (for example "Too far to reach in its morning window") and is flagged on the Overview page.

Travel times come from OpenRouteService if `ORS_API_KEY` is set in `backend/.env`. Otherwise they are estimated from straight-line distance:
- road distance = straight line × 1.3
- 25 km/h in town, 70 km/h between towns
- plus 2 minutes per trip

The UI says which one is in use, and never shows straight lines as roads.

### Does the optimizer help?

`python evaluate.py` runs a benchmark over 30 generated days, each with 12–20 Grand Tunis stops. All methods are scored on the same matrix and constraints. Full output is in [`backend/evaluation_results.md`](backend/evaluation_results.md).

| With customer time slots | Avg driving | Late stops (30 days) | Skipped |
|---|---|---|---|
| Excel order | 372 min | 226 | 0 |
| Nearest stop first | 209 min | 141 | 0 |
| OR-Tools | 209 min | 0 | 2 |

| No time slots | Avg driving | vs nearest stop first |
|---|---|---|
| Nearest stop first | 209 min | |
| OR-Tools | 194 min | −7.2% |

With time slots, OR-Tools drives about as much as the greedy route but reaches every customer on time. Without time slots, it saves about 7% driving. These numbers use estimated travel times on generated data. They show the method works; they are not real-world savings.

## Tests

From `backend/`:

```bash
pip install -r requirements-dev.txt
python -m pytest -q
```

There are 17 end-to-end API tests:
- roles and login
- import validation, revalidation and persistence
- zone, capacity and inactive-driver rules
- time windows respected; unscheduled stops explained
- same-address orders kept distinct
- reassignment eligibility
- driver ownership, double-submit protection, photo validation
- undo kept as history; retry linked and created only once
- re-routing never touching finished stops
- analytics totals checked against the database
- the Quick planner's missing-key message

## Project layout

```
backend/
  main.py            app, startup, original /optimize-route planner
  auth.py            accounts, sessions, admin/driver roles
  dispatch.py        import, assignment, routing, driver actions, retries
  drivers.py         driver management
  analytics.py       overview and analytics
  vrptw_solver.py    OR-Tools model
  route_eval.py      route scoring + nearest-neighbour baseline
  evaluate.py        optimizer benchmark
  distance.py        OpenRouteService client + offline estimate
  orders_import.py   Excel reading and row checks
  tunisia.py         governorates, cities, spelling variants
  sample_data.py     demo drivers, accounts, history, Excel files
  db.py              SQLite schema and migrations
  tests/             pytest suite
frontend/src/
  pages/Login.jsx
  pages/admin/       Overview, Import, Dispatch, Orders, Drivers, Analytics, Planner
  pages/driver/      DriverApp
  layouts/           admin sidebar layout
  components/        RouteMap (Leaflet), OrderDetail, shared UI
```

More detail is in [TECHNICAL.md](TECHNICAL.md).

## Limits

- **A local demo, not production software.** Passwords are hashed and every endpoint checks the role, but there's no HTTPS setup, no rate limiting and no password-reset email. Don't put real customer data on a public server with it as is.
- **Locations come from a small city table** (about 40 places), unless the Excel file has GPS columns.
- **One depot per driver.** No hubs, no live GPS tracking, no SMS, no offline mode.
