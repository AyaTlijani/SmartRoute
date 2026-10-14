# SmartRoute

A dispatch console for small Tunisian delivery companies. Confirmed orders arrive as an Excel file in the morning. SmartRoute checks them, assigns them to drivers by zone, plans each driver's route with Google OR-Tools, and follows every delivery and every dinar collected.

There are two kinds of accounts:
- **Admin** (web console): imports orders, plans routes, manages drivers and their logins, confirms the cash each driver hands over, sees analytics.
- **Driver** (phone screen): sees only their own deliveries.
  1. Ticks off the packages while loading, then starts the route.
  2. Calls, navigates, and marks each stop delivered (cash + optional photo) or failed (reason).
  3. Re-plans the remaining stops from where they are when running late.
  4. Ends the day by declaring the cash handed over.

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
2. **Dispatch:** click **Plan routes** and pick the assignment mode:
   - **Zone rule:** the nearest least-loaded driver covering the governorate.
   - **Fleet optimizer:** OR-Tools chooses drivers and stop order together.

   Run both and compare the total driving. Djerba and Nabeul stay unassigned, with the reason.
3. **Driver:** in another browser or a phone, sign in as `ahmed`. Tick the packages, then **Start route**. Deliver a stop with a photo and a short cash amount, fail another, and try **Re-plan from here**. When every stop is done, **End day** with the cash amount.
4. **Overview:** the cash handover and the failed delivery appear under **Needs attention**. Confirm the cash in Dispatch, and schedule a retry from the order.
5. **Analytics:** attempt success, first-try and eventual delivery, the cash gap per driver, weak governorates and customers who keep refusing.

## How routing works

**Assignment.** There are two modes:
- **Zone rule:** each order goes to the eligible driver (active, covers the governorate, has room) with the fewest orders, adjusted for distance to their other stops.
- **Fleet optimizer:** one OR-Tools model for all drivers. It chooses who serves what and in which order, minimizing total driving, with zones (allowed vehicles), capacity and time windows as constraints.

**Plan routes** rebuilds assignments only for drivers who haven't started. Drivers already on the road keep their packages, and their remaining stops are re-sequenced from their last stop or phone position, starting from the current time. Past days are read-only.

**Sequencing.** For each driver and day:
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

| Whole fleet, 5 drivers, ~55 orders/day, 10 days | Total driving per day | Orders served |
|---|---|---|
| Zone rule + OR-Tools per driver | 579 min | 52.6 |
| Fleet optimizer | 533 min (−7.9%) | 53.3 |

With time slots, OR-Tools drives about as much as the greedy route but reaches every customer on time. Without time slots, it saves about 7% driving. Letting the optimizer also choose the drivers saves about 8% more across the fleet. These numbers use estimated travel times on generated data. They show the method works; they are not real-world savings.

## Tests

From `backend/`:

```bash
pip install -r requirements-dev.txt
python -m pytest -q
```

There are 21 end-to-end API tests:
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
- past days read-only
- the driver's day: start, end, cash handover and its confirmation
- re-planning from the current time and position
- started drivers keep their stops
- the fleet optimizer respects zones and capacity, and drives no more than the zone rule

## Project layout

```
backend/
  main.py            app and startup
  auth.py            accounts, sessions, admin/driver roles
  dispatch.py        import, orders, planning endpoint, driver actions, retries
  planning.py        zone rule, fleet optimizer, per-driver sequencing, re-planning
  driver_day.py      start route, re-plan from here, end day, cash confirmation
  drivers.py         driver management
  analytics.py       overview and analytics
  vrptw_solver.py    OR-Tools model (multi-vehicle, time windows, capacity, zones)
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
  pages/admin/       Overview, Import, Dispatch, Orders, Drivers, Analytics
  pages/driver/      DriverApp
  layouts/           admin sidebar layout
  components/        RouteMap (Leaflet), OrderDetail, shared UI
```

More detail is in [TECHNICAL.md](TECHNICAL.md).

## Limits

- **A local demo, not production software.** Passwords are hashed and every endpoint checks the role, but there's no HTTPS setup, no rate limiting and no password-reset email. Don't put real customer data on a public server with it as is.
- **Locations come from a small city table** (about 40 places), unless the Excel file has GPS columns.
- **One depot per driver.** No hubs, no live GPS tracking, no SMS, no offline mode.
