import axios from "axios";

// "/api" goes through the Vite dev proxy to FastAPI (see vite.config.js),
// so the app also works from a phone on the same Wi-Fi.
export const API_URL = import.meta.env.VITE_API_URL || "/api";

export const api = axios.create({ baseURL: API_URL });

export function errorText(err) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => d.msg).join(", ");
  return err?.message || "Something went wrong.";
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const dt = (n) =>
  `${Number(n || 0).toLocaleString("fr-TN", { maximumFractionDigits: 1 })} DT`;

// Shape an order for the existing RouteMap component.
export function toMapStop(o) {
  return {
    stop_number: o.stop_number,
    coordinates: [o.lng, o.lat],
    address: `${o.customer_name} · ${o.address}, ${o.city || o.governorate}`,
    arrival_time: o.eta || "-",
    time_window: o.slot_label || "Any time",
  };
}
