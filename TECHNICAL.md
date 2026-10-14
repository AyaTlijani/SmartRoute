# SmartRoute — Technical Documentation

This document describes what the code currently does. It does not describe planned features.


## 1. Purpose

SmartRoute is a web app for a small delivery company in Tunisia. It covers one delivery day:

1. An admin uploads an Excel file of confirmed orders.
2. The app checks each row and imports the valid ones into a database.
3. The app assigns orders to drivers based on governorate, then computes an ordered route for each driver.
4. A driver opens a phone-sized page, follows the stops, and marks each order delivered (with cash amount and optional photo) or failed (with a reason).
5. The admin sees order statuses and an analytics page.

The app also contains the original "Quick planner": a form where you type a depot and up to 20 addresses and get one optimized route.

There is no login. Anyone who opens the app can use the admin pages and any driver's page.


## 2. Stack

Backend:
- Python, FastAPI, Uvicorn
- Google OR-Tools (route optimization)
- SQLite through Python's built-in sqlite3 module (no ORM)
- openpyxl (read and write Excel files)
- python-multipart (file uploads)
- requests and python-dotenv (OpenRouteService client and .env loading)

Frontend:
- React 18, Vite, Tailwind CSS
- Leaflet and react-leaflet (map), OpenStreetMap tiles
- axios (HTTP)

Project layout:

    backend/
      main.py            FastAPI app, original /optimize-route endpoint, startup
      dispatch.py        all endpoints of the daily workflow
      vrptw_solver.py    OR-Tools route solver
      distance.py        OpenRouteService client + distance-based fallback
      orders_import.py   Excel reading and row validation
      tunisia.py         governorates, cities, coordinates, spelling aliases
      sample_data.py     demo drivers, demo history, sample and template Excel files
      db.py              SQLite schema and connection helper
      config.py          reads ORS_API_KEY from .env
      models.py          Pydantic models for /optimize-route
      requirements.txt
    frontend/src/
      App.jsx            page shell, tabs, hash routing, delivery-day picker
      api.js             axios instance and small helpers
      components/
        ImportView.jsx     Import tab
        DispatchView.jsx   Dispatch tab
        DriverView.jsx     Driver app
        AnalyticsView.jsx  Analytics tab
        QuickPlanner.jsx   original address planner
        AddressForm.jsx    form used by the Quick planner
        RouteDisplay.jsx   result view used by the Quick planner
        RouteMap.jsx       Leaflet map used by Quick planner, Dispatch and Driver app
        ui.jsx             shared buttons, cards, badges, stat tiles


## 3. Running modes: with or without an API key

`config.py` reads `ORS_API_KEY` from `backend/.env`. The app starts either way.

Without a key (default):
- Locations come from the Excel file (lat/lng columns) or from the built-in Tunisia table.
- Travel time between two points is estimated from straight-line distance:
  - road distance = straight-line distance x 1.3
  - speed = 25 km/h if that distance is under 15 km, otherwise 70 km/h
  - plus 2 minutes per trip (parking)
- The map shows straight lines between stops, labelled "Stop order (straight lines)".
- The Quick planner returns an error (HTTP 503) because it needs the key to geocode typed addresses.

With a key:
- The dispatch workflow asks OpenRouteService for the travel-time matrix and the road geometry. If an ORS call fails, it falls back to the estimate above.
- The Quick planner works: it geocodes the addresses with ORS, then solves and draws the road route.


## 4. Data model (SQLite)

The database file is `backend/smartroute.db`. Another path can be set with the `SMARTROUTE_DB` environment variable.

Table `drivers`
- id, name, phone, vehicle (text)
- zones: comma-separated governorate names the driver covers
- depot_name, depot_lat, depot_lng: where the driver's route starts
- max_orders: maximum orders per day (default 20)

Table `orders`
- id, delivery_date (YYYY-MM-DD)
- customer_name, phone (8 digits), governorate, city, address, landmark, product, notes
- cod_amount: cash to collect, in dinars
- slot: 0 = any time, 1 = morning, 2 = afternoon
- lat, lng, location_precision ("exact", "city" or "governorate")
- status: "pending", "assigned", "delivered" or "failed"
- driver_id, stop_number (position in the route), eta (text like "10:24 AM")
- created_at

Table `attempts` (one row per delivered or failed action)
- id, order_id, driver_id
- result: "delivered" or "failed"
- reason, note (for failures)
- cash_collected
- photo_path (file name in backend/uploads)
- lat, lng (driver's phone position, if the browser gave it)
- created_at

Table `routes` (one row per driver per day)
- driver_id, delivery_date
- geometry: JSON list of [lng, lat] points
- distance_km, driving_minutes
- source: "ors" or "estimate"

Order status flow:

    pending  --assign-->  assigned  --driver-->  delivered
                                    --driver-->  failed
    delivered or failed  --undo-->  assigned
    assigned  --reassign to nobody-->  pending

"Retry tomorrow" on a failed order does not change that order. It creates a new pending order with the same details for the next day, with "Retry." added at the start of its notes.


## 5. Demo data

On startup, the backend creates the tables. If the drivers table is empty, it loads demo data. `POST /demo/reset` deletes everything and loads it again.

Demo drivers:

    Ahmed Trabelsi   scooter  Tunis, Ariana              depot: SmartRoute Hub, Charguia
    Sami Ben Ali     scooter  Tunis, Ben Arous           depot: SmartRoute Hub, Charguia
    Youssef Gharbi   car      Ariana, Manouba, Ben Arous depot: SmartRoute Hub, Charguia
    Mehdi Jlassi     car      Sousse, Monastir, Mahdia   depot: Sousse relay point
    Karim Masmoudi   car      Sfax                       depot: Sfax relay point

Demo history:
- 21 past days, 28 to 46 orders per day, 8 more on Mondays.
- Every order is already delivered or failed, with an attempt row.
- Orders in governorates no driver covers are not created in the history.
- Built-in patterns:
  - base failure chance 10%
  - +10% in Manouba, +5% in Ben Arous
  - +6% for Youssef Gharbi
  - a fixed group of 12 "risky" phone numbers fail 65% of the time
  - about 2% of deliveries collect 5, 10 or 20 DT less than the amount due
- A phone number always maps to the same customer name.

All demo names, phones and addresses are generated. They are not real people.


## 6. Excel import

### 6.1 Files the app provides
- `GET /excel/template`: empty template with one example row, plus a "How to fill" sheet.
- `GET /excel/sample?day=YYYY-MM-DD`: 58 generated orders plus one duplicate (59 rows), with deliberate problems:
  - a 7-digit phone
  - "Ariena" as governorate
  - a missing address
  - "cent dinars" as amount
  - a duplicated customer
  - a "+216" prefix
  - "Benarous" as governorate
  - some rows without lat/lng

### 6.2 Reading
- Only the first sheet is read; the first row must be the header row.
- Headers are matched without regard to case, accents, spaces, dashes or underscores. Accepted names:

      customer_name  customer, name, nom, client, nom client
      phone          telephone, tel, mobile, numero, gsm
      governorate    gouvernorat, region, state
      city           ville, delegation, town
      address        adresse
      landmark       repere, point de repere, reference
      product        produit, article, item
      cod_amount_dt  cod, amount, montant, prix, price, cod amount
      slot           creneau, time slot, time
      notes          note, remarque, comment
      lat            latitude
      lng            lon, long, longitude

- Unknown columns are ignored. Empty rows are skipped.
- The file is rejected if no phone or governorate column is found.

### 6.3 Row checks
Errors block a row from being imported:
- Missing customer name, phone, governorate, address or cash amount.
- Phone not valid after cleaning. Cleaning removes everything except digits and strips a leading "216" or "00216". The result must be 8 digits starting with 2 to 9.
- Governorate not recognised. Recognition accepts:
  - the 24 names, without regard to case or accents
  - listed spelling variants (for example Benarous, Bizerta, Nabel, El Kef)
  - some Arabic names
  - Djerba or Jerba, which map to Medenine

  If the name is close to a known one, the error includes a suggestion ("did you mean Ariana?").
- Cash amount not a number, below 0 or above 10,000. "DT", "TND" and "dinar(s)" are removed, and a comma counts as a decimal point.
- Slot not recognised. Accepted values:
  - empty, "any", "all day", "journee" or 0 → any time
  - "morning", "matin", "am" or 1 → morning
  - "afternoon", "apres midi", "pm", "soir" or 2 → afternoon
- lat/lng given but outside Tunisia (lat 30–38, lng 7–12).

Warnings do not block a row:
- Same phone as an earlier row in the file ("possible duplicate").
- The customer already has an order on that delivery day.
- Risky customer: this phone has 2 or more failed orders in the database.
- Approximate location: no lat/lng and the city was not found, so the governorate centre is used.

### 6.4 Location of each order
1. lat/lng from the file, if present and valid (precision "exact").
2. Otherwise the city, if it is in the built-in table and belongs to the same governorate (precision "city"). The table holds about 40 cities and neighbourhoods, mostly in Grand Tunis, the Sahel and Sfax.
3. Otherwise the governorate's main city (precision "governorate").

### 6.5 Import screen behaviour
- Upload by drag-and-drop or file picker. The backend returns every row with its status (ok, warning or error), messages and suggestions.
- Summary tiles show total, ready, warnings and errors. A filter shows all rows or only problem rows.
- A "Use ..." button applies a governorate suggestion and re-checks all rows (`POST /orders/revalidate`).
- Each row has an import checkbox:
  - error rows cannot be ticked
  - rows with a "possible duplicate" warning start unticked
  - all other rows start ticked
- "Import N orders" sends the ticked rows. The backend checks them again and saves only rows without errors as "pending" orders for the selected day.
- The page also shows how many orders already exist for the day by status, and has a "Clear day" button. It deletes that day's pending and assigned orders and its routes.


## 7. Assignment

Triggered by "Assign & optimize routes" on the Dispatch page (`POST /dispatch/assign`).

1. Only orders with status "pending" on the selected day are assigned. Already assigned orders keep their driver.
2. Pending orders are processed sorted by governorate, then latitude.
3. A driver can take an order if the order's governorate is in the driver's zones and the driver has fewer than max_orders orders that day.
4. Among those drivers, the one with the lowest score gets the order:

       score = orders the driver already has that day
             + 0.5 x distance in km from the order to the driver's centre point

   The centre point is the average position of the driver's orders that day, or the depot if the driver has none yet.
5. If no driver can take the order, it stays "pending". The Dispatch page lists it as unassigned with a reason:
   - "No driver covers <governorate>", or
   - "All drivers for this zone are full".
6. After assignment, every driver's route is recomputed (section 8).

Manual change: on the Dispatch page, each pending or assigned order has a driver dropdown (`POST /orders/{id}/reassign`).
- Choosing a driver sets the order to "assigned".
- Choosing "Unassigned" sets it back to "pending".
- The routes of the old and new driver are recomputed.


## 8. Route computation (per driver)

For each driver, the route uses that day's orders with status "assigned":
- Points: the driver's depot, then each order's location.
- Travel-time matrix in minutes (ORS or estimate, section 3).
- Time is counted in minutes after 9:00 AM:
  - depot: 0–540 (9:00 AM to 6:00 PM)
  - any time: 0–480
  - morning: 0–180 (9:00 AM to 12:00 PM)
  - afternoon: 240–480 (1:00 PM to 5:00 PM)
- Service time: 10 minutes at each stop.
- Solver (`vrptw_solver.py`, OR-Tools):
  - one vehicle, starts at the depot at 9:00
  - must be back by 6:00 PM
  - minimises total driving time
  - first solution: parallel cheapest insertion
  - improvement: guided local search
  - time limit: 1 second for 8 stops or fewer, 2 seconds otherwise
- A stop that cannot fit its time window is skipped rather than failing the route (penalty 100,000 per skipped stop). It keeps status "assigned" with no stop number. The UI shows it as "Doesn't fit slot", and the driver card says how many stops don't fit.
- Each routed order gets a stop_number and an ETA (arrival time from the solver).
- Geometry and totals are computed for the path depot → stops in order. They do not include the return to the depot. The result is saved in the routes table.

Recomputing a route clears and rewrites stop numbers, ETAs and the route row for that driver and day. Orders already delivered or failed are not included and keep their old stop numbers.


## 9. Dispatch page (admin)

- Summary tiles: total orders, unassigned, to deliver, delivered, failed.
- One card per driver:
  - name, zones, vehicle
  - order count / max
  - progress bar of finished stops
  - route km and driving minutes
  - warning if some stops don't fit their slot
- Clicking a driver card shows:
  - the route map: depot marker "D", numbered stop markers, route line
  - starting depot, cash to collect, cash collected
  - "Open driver app" button
  - the order table: stop number, ETA and slot, customer with history badge, location, cash, status, action
- Actions in the order table:
  - driver dropdown (pending or assigned orders)
  - "Retry tomorrow" (failed orders; after use it shows "Moved to tomorrow" until the page reloads)
  - "Proof photo" link (delivered orders with a photo)
- Unassigned orders are listed in a separate table with their reason and a driver dropdown.
- The page reloads its data from the server every 15 seconds.

Customer history badge (based on other orders with the same phone that are delivered or failed):
- "Risky: X/Y failed" if 2 or more failed
- "Trusted · Y orders" if 3 or more orders and none failed
- "New customer" if no previous orders


## 10. Driver app (phone layout)

Address: `#/driver` (driver list) or `#/driver/<id>`. There is no login; the driver is picked from a list.

Screen content:
- Header: driver name, day, depot, "Switch" (change driver) and "Admin" links.
- Summary: stops done / total, progress bar, cash collected and cash expected.
- "Stops" and "Map" tabs. The map shows all routed stops and the route line.
- The first unfinished stop is open by default and marked "Next stop". Tapping another stop opens it instead.

An open stop shows:
- stop number and ETA, customer name and history badge, cash to collect
- address and city, landmark, product, notes
- an "Approximate location: call the customer" notice when only the governorate is known
- slot
- Buttons:
  - Call: opens `tel:+216<phone>`
  - Navigate: opens Google Maps directions to the stop's lat/lng
  - Failed
  - Delivered

"Delivered":
- A panel asks for cash collected (pre-filled with the amount due) and an optional photo.
- On phones, the photo input opens the camera directly.
- A note appears if the cash is lower than the amount due.
- The browser's GPS position is requested (3-second limit) and sent if available.
- The backend saves the photo in `backend/uploads/` and creates an attempt. The order becomes "delivered".

"Failed":
- The driver picks a reason: No answer, Customer refused, Not at home, Wrong address, Other. An optional note can be added.
- The GPS position is sent if available. The order becomes "failed".

Finished stops appear in a "Finished" list with an "Undo" button. Undo deletes the latest attempt and sets the order back to "assigned".

When all stops are finished, the screen shows "Route finished" and the cash to hand over.


## 11. Analytics page

Data: all attempts for orders whose delivery date is within the last 7, 30 or 90 days (chosen on the page). Each delivered or failed action counts as one attempt.

Shown:
- Success rate (delivered / attempts), delivered count, failed count, worst governorate.
- Cash collected, and the gap between cash due on delivered orders and cash collected.
- Deliveries per day: stacked bars of delivered and failed, with exact numbers on hover.
- Success rate by driver.
- Success rate by governorate, lowest first.
- Failure reasons, by count.
- Customers who keep refusing: phones with 2 or more failed attempts (top 8).


## 12. Quick planner (original feature)

- Form: depot address plus up to 20 delivery addresses, each with slot 1 (morning) or 2 (afternoon).
- `POST /optimize-route`:
  1. geocodes the addresses with ORS
  2. builds the ORS travel-time matrix
  3. runs the same OR-Tools solver
  4. gets the road route from ORS
  5. returns ordered stops with ETAs, distance, driving time, service time and a Google Maps link
- Requires ORS_API_KEY; returns 503 without it.
- Stops are matched to coordinates by their position in the list, so two identical addresses are handled correctly.
- Nothing is saved to the database.


## 13. API reference

Health:

    GET    /health

Demo and files:

    POST   /demo/reset                  wipe and reload demo data
    GET    /excel/template              download template .xlsx
    GET    /excel/sample?day=           download sample day .xlsx

Orders and import:

    POST   /orders/validate             form-data: file, day  -> rows with status and messages
    POST   /orders/revalidate           JSON {day, rows}      -> same, for corrected rows
    POST   /orders/import               JSON {day, rows}      -> saves rows without errors
    GET    /orders?day=                 all orders of a day
    DELETE /orders?day=                 delete a day's pending and assigned orders

Drivers and dispatch:

    GET    /drivers                     list drivers
    POST   /dispatch/assign             JSON {day} -> assign pending orders, recompute routes
    GET    /dispatch?day=               drivers with orders, routes, stats; unassigned orders
    POST   /orders/{id}/reassign        JSON {driver_id or null}
    POST   /orders/{id}/retry-tomorrow  copy a failed order to the next day
    GET    /drivers/{id}/day?day=       one driver's orders, route and stats

Driver actions:

    POST   /orders/{id}/deliver         form-data: cash_collected, lat?, lng?, photo?
    POST   /orders/{id}/fail            JSON {reason, note?, lat?, lng?}
    POST   /orders/{id}/undo            remove last attempt, back to assigned

Analytics and photos:

    GET    /analytics?days=30
    GET    /photos/{file}               saved delivery photos

Original planner:

    POST   /optimize-route

If no day is given, the server's current date is used. Interactive API docs are at http://localhost:8000/docs.


## 14. Frontend routing and network

- Hash-based routes: `#/import`, `#/dispatch`, `#/driver`, `#/driver/<id>`, `#/analytics`, `#/planner`.
- The "Delivery day" picker in the header applies to the Import, Dispatch and Driver pages. It defaults to today.
- The frontend calls the backend at `/api/...`. The Vite dev server forwards these calls to `http://localhost:8000` and removes the `/api` prefix. The `VITE_API_URL` variable can override the base URL.
- The Vite dev server listens on the local network (`host: true`), so a phone on the same Wi-Fi can open the app.


## 15. Current limitations

- No authentication or user accounts; anyone with the URL can act as admin or any driver.
- Without an ORS key, travel times are estimates and the map shows straight lines.
- The city table has about 40 places; elsewhere the governorate centre is used.
- One depot per driver. No hubs or transfers between cities.
- No offline mode, live tracking, SMS/WhatsApp messages or deployment setup.
- Photos are stored on the server's disk. Delivered and failed actions cannot be edited, only undone.
