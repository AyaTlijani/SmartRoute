# SmartRoute

Delivery dispatch for a small Tunisian courier, from the confirmed-orders Excel file to the driver's phone.

In Tunisia, many online shops take orders over Instagram or WhatsApp. A confirmation agent calls each customer, and the confirmed orders end up in an Excel file. SmartRoute starts from that file:

1. **Import:** the admin uploads the day's Excel file. Every row is checked before anything is saved:
   - phone numbers (8 digits, `+216` accepted)
   - governorate spelling, with "did you mean Ariana?" suggestions and Arabic names
   - missing fields and cash amounts
   - duplicate customers
   - customers who refused past deliveries
2. **Dispatch:** each order goes to a driver who covers its governorate. The rule balances load and keeps each driver's stops close together. Google OR-Tools then orders each driver's stops within their morning or afternoon slot (a VRP with time windows).
3. **Driver app** (phone layout): the driver sees the next stop and can call the customer or navigate with Google Maps. Each stop is marked **Delivered** (cash collected + proof photo + GPS) or **Failed** (reason). Mistakes can be undone.
4. **Analytics:** success rate per day, driver and governorate; failure reasons; cash collected vs. expected; customers who keep refusing.

The app runs with **no API keys**. Locations come from GPS columns in the Excel file or from a built-in table of Tunisian cities. Driving times are estimated from distance. If you add an OpenRouteService key, SmartRoute uses real road times and road geometry instead.

## Run it

**Backend** (Python 3.11+):

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

On first start, the backend creates `backend/smartroute.db` and loads 5 demo drivers plus 3 weeks of delivery history. API docs are at http://localhost:8000/docs.

**Frontend** (Node 18+):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## 2-minute demo

1. **Import:** click **Download sample day**. Drop the file back in and see the 5 deliberate mistakes flagged. Click **Use "Ariana"** on the typo row, then click **Import**.
2. **Dispatch:** click **Assign & optimize routes**. Click a driver to see their route on the map. Move an order to another driver with the dropdown; both routes are re-optimized. Djerba and Nabeul stay unassigned because no driver covers them.
3. **Driver app:** open it, or open `http://<your-computer-ip>:5173/#/driver/1` on your phone (same Wi-Fi). Deliver a stop with a photo, and fail another. The dispatch page updates within 15 seconds.
4. **Analytics:** look at the success rate by governorate (Manouba is the weak spot in the demo data), the failure reasons and the risky customers.

To start over: `curl -X POST localhost:8000/demo/reset`, or delete `backend/smartroute.db`.

## Optional: real road routes

Copy `.env.example` to `backend/.env` and set `ORS_API_KEY` (free at openrouteservice.org). Dispatch then uses OpenRouteService for driving times and road geometry, and falls back to estimates if the service fails. The **Quick planner** tab is the original free-text address planner. It needs the key because it geocodes addresses.

## How it's built

| Part | What |
|---|---|
| `backend/main.py` | FastAPI app, original `/optimize-route` planner, startup seeding |
| `backend/dispatch.py` | Import, assignment, per-driver routing, driver actions, analytics endpoints |
| `backend/vrptw_solver.py` | OR-Tools VRP with time windows; can skip a stop instead of failing the whole route |
| `backend/orders_import.py` | Excel reading (openpyxl) and row validation |
| `backend/tunisia.py` | 24 governorates, common cities, spelling aliases (offline geocoding) |
| `backend/distance.py` | OpenRouteService client + distance-based fallback |
| `backend/db.py` | SQLite (built-in `sqlite3`): drivers, orders, attempts, routes |
| `backend/sample_data.py` | Demo drivers, history, sample Excel day, template |
| `frontend/src/components/` | `ImportView`, `DispatchView`, `DriverView`, `AnalyticsView`, `RouteMap` (Leaflet), `QuickPlanner` |

**Assignment rule:** only drivers covering the order's governorate and under their daily maximum are eligible. The driver with the lowest score gets the order:

```
score = orders already assigned + 0.5 × km from the driver's current stops
```

**Not included (on purpose):** login, SMS/WhatsApp, offline mode, live GPS tracking, deployment. Demo data is generated, not real customers.
