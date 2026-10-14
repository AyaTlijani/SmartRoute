import axios from "axios";

// "/api" goes through the Vite dev proxy to FastAPI (see vite.config.js),
// so the app also works from a phone on the same Wi-Fi.
export const API_URL = import.meta.env.VITE_API_URL || "/api";

const TOKEN_KEY = "smartroute.token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session simply won't survive a reload */
  }
}

export const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Any 401 means the session is gone: drop it and go back to the login page.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401 && !err.config?.url?.includes("/auth/login")) {
      setToken(null);
      if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
    }
    return Promise.reject(err);
  }
);

export function errorText(err) {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => `${d.loc?.at(-1) ?? ""}: ${d.msg}`).join(", ");
  if (err?.code === "ERR_NETWORK") return "Can't reach the server. Is the backend running?";
  return err?.message || "Something went wrong.";
}

// Download a protected file (Excel) with the auth header, then save it.
export async function download(path, filename, params) {
  const r = await api.get(path, { params, responseType: "blob" });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDay(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export const dt = (n) => `${Number(n || 0).toLocaleString("fr-TN", { maximumFractionDigits: 1 })} DT`;

// Shape an order for the RouteMap component.
export function toMapStop(o) {
  return {
    stop_number: o.stop_number,
    coordinates: [o.lng, o.lat],
    address: `${o.customer_name}, ${o.address}, ${o.city || o.governorate}`,
    arrival_time: o.eta || "-",
    time_window: o.slot_label || "Any time",
    status: o.status,
  };
}
