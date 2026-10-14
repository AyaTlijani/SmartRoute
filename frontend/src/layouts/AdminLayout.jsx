import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useOutletContext } from "react-router-dom";
import {
  AlertTriangle, BarChart3, Bell, CheckCircle2, Info, OctagonAlert, CalendarDays, ChevronLeft, ChevronRight, FileSpreadsheet, LayoutDashboard, LogOut,
  Menu, Package, RotateCcw, Route, Users, X,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, dt, errorText, formatDay, setToken, shiftDay, todayISO } from "../api";
import { Button, ErrorBanner, HeaderExtrasContext, Modal, cx, useToast } from "../components/ui";

const NAV = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/import", label: "Import orders", icon: FileSpreadsheet },
  { to: "/admin/dispatch", label: "Dispatch", icon: Route },
  { to: "/admin/orders", label: "Orders", icon: Package },
  { to: "/admin/drivers", label: "Drivers", icon: Users },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
];

export function Logo({ light, size = "md" }) {
  const box = size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 40 40" className={cx(box, "shrink-0")} aria-hidden="true">
        <rect width="40" height="40" rx="12" fill="#16935C" />
        <path d="M11 27c0-5 4-6.5 9-6.5s9-1.5 9-6.5" stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        <circle cx="11" cy="27" r="3.4" fill="#fff" />
        <circle cx="29" cy="14" r="3.4" fill="#A8D86A" />
      </svg>
      <span className={cx("font-extrabold tracking-tight", size === "lg" ? "text-[26px]" : "text-[22px]",
        light ? "text-white" : "text-ink")}>SmartRoute</span>
    </div>
  );
}

function initials(name) {
  return (name || "A").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function NavItem({ item, onClick }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-3.5 rounded-2xl px-4 py-3 text-[15px] transition-colors",
          isActive ? "bg-mint-300/80 font-bold text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)]"
            : "font-medium text-ink-700 hover:bg-white/60 hover:text-ink"
        )
      }
    >
      <Icon className="h-[22px] w-[22px] text-brand-700" strokeWidth={1.8} aria-hidden="true" />
      {item.label}
    </NavLink>
  );
}

function ResetDemo({ onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reset = async () => {
    setBusy(true);
    try {
      await api.post("/admin/demo/reset");
      setToken(null); // accounts are recreated, so sign in again
      window.location.assign("/login");
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal title="Reset demo data?" onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={reset}>Reset everything</Button></>}>
      <ErrorBanner error={error} />
      <p className="text-sm text-ink-700">
        Deletes every order, route, delivery and driver change, then loads the demo company again: 3 weeks of history,
        today in progress (drivers on the road, one waiting for cash confirmation) and tomorrow's orders to plan.
      </p>
      <p className="mt-2 text-sm text-ink-500">It takes about 10 seconds. You will be signed out.</p>
    </Modal>
  );
}

function Sidebar({ onNavigate }) {
  const { user, logout } = useAuth();
  const [resetting, setResetting] = useState(false);
  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#E6F5EC] to-[#D9F0E3] px-4 py-7">
      <div className="px-3 pb-10"><Logo size="lg" /></div>
      <nav className="flex flex-col gap-1.5" aria-label="Main">
        {NAV.map((item) => <NavItem key={item.to} item={item} onClick={onNavigate} />)}
      </nav>
      <div className="mt-auto rounded-3xl bg-white/75 p-4 shadow-[0_6px_18px_rgba(15,31,23,0.06)]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-sm font-bold text-white" aria-hidden="true">
            {initials(user?.full_name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">{user?.full_name}</span>
            <span className="block text-xs text-ink-500">Administrator</span>
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-1.5">
          <button type="button" onClick={logout} className="flex items-center gap-2 text-sm font-medium text-ink-700 hover:text-ink">
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
          <button type="button" onClick={() => setResetting(true)} className="flex items-center gap-2 text-sm font-medium text-ink-700 hover:text-ink">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset demo data
          </button>
        </div>
      </div>
      {resetting && <ResetDemo onClose={() => setResetting(false)} />}
    </div>
  );
}

const LEVEL_ICON = {
  critical: [OctagonAlert, "bg-red-100 text-red-700"],
  warning: [AlertTriangle, "bg-amber-100 text-amber-700"],
  info: [Info, "bg-mint-200 text-brand-700"],
};
const SEEN_KEY = "smartroute.seenAlerts";
const readSeen = () => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); } catch { return new Set(); }
};
const writeSeen = (titles) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(titles)); } catch { /* private mode */ }
};

// Closes a dropdown on outside click or Escape.
function useDismiss(open, setOpen) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return ref;
}

// Top-right of every admin page: alerts, live driver updates and the account menu.
function HeaderExtras() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [seen, setSeen] = useState(readSeen);
  const [open, setOpen] = useState(false);
  const known = useRef(null); // last attempt id seen, so only new results make a toast
  const ref = useDismiss(open, setOpen);

  useEffect(() => {
    const load = () => api.get("/overview", { params: { day: todayISO() } })
      .then((r) => setItems(r.data.attention)).catch(() => {});
    // New driver results since the page opened appear as toasts.
    const poll = () => api.get("/updates", { params: known.current == null ? {} : { after: known.current } }).then((r) => {
      if (known.current != null && r.data.attempts.length) load();
      r.data.attempts.forEach((a) => toast(
        a.result === "delivered"
          ? `${a.driver} delivered to ${a.customer_name}, ${dt(a.cash_collected)} collected`
          : `${a.driver} could not deliver to ${a.customer_name}: ${a.reason}`,
        a.result === "delivered" ? "good" : "warn"));
      known.current = r.data.latest;
    }).catch(() => {});
    load();
    poll();
    const t1 = setInterval(poll, 10000);
    const t2 = setInterval(load, 30000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  const unseen = (items || []).filter((a) => a.level !== "info" && !seen.has(a.title)).length;
  const toggle = () => {
    setOpen((o) => !o);
    if (!open && items) {
      const titles = items.map((a) => a.title);
      writeSeen(titles);
      setSeen(new Set(titles));
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative" ref={ref}>
        <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="true"
          aria-label={unseen ? `${unseen} new alerts` : "Alerts"}
          className={cx("relative flex h-11 w-11 items-center justify-center rounded-full shadow-card transition-colors",
            open ? "bg-mint-200" : "bg-white hover:bg-mint-50")}>
          <Bell className="h-5 w-5 text-ink" />
          {unseen > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white ring-2 ring-white">
              {unseen}
            </span>
          )}
        </button>
        {open && (
          <div className="absolute right-0 top-14 z-[1500] w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-3xl bg-white shadow-float ring-1 ring-black/5">
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <p className="font-bold">Needs attention today</p>
              <span className="rounded-full bg-mint px-2.5 py-0.5 text-xs font-semibold text-brand-700">{items?.length || 0}</span>
            </div>
            {!items || items.length === 0 ? (
              <p className="flex items-center gap-2 px-5 pb-5 pt-2 text-sm text-ink-500">
                <CheckCircle2 className="h-4 w-4 text-brand" /> Nothing to act on. Every order is planned.
              </p>
            ) : (
              <ul className="max-h-[60vh] overflow-y-auto px-2 pb-2">
                {items.map((a) => {
                  const [Icon, tone] = LEVEL_ICON[a.level] || LEVEL_ICON.info;
                  return (
                    <li key={a.title}>
                      <Link to={a.to} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-2xl px-3 py-2.5 hover:bg-mint-50">
                        <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", tone)}><Icon className="h-4 w-4" /></span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{a.title}</span>
                          <span className="block text-[13px] text-ink-500">{a.detail}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
      <AccountMenu />
    </div>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const ref = useDismiss(open, setOpen);
  const item = "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium hover:bg-mint-50";
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" aria-label="Account menu"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-700 text-sm font-bold text-white shadow-card ring-2 ring-white hover:brightness-110">
        {initials(user?.full_name)}
      </button>
      {open && (
        <div className="absolute right-0 top-14 z-[1500] w-64 rounded-3xl bg-white p-2 shadow-float ring-1 ring-black/5">
          <div className="flex items-center gap-3 px-3 py-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{initials(user?.full_name)}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{user?.full_name}</span>
              <span className="block text-xs text-ink-500">Administrator, @{user?.username}</span>
            </span>
          </div>
          <div className="my-1 h-px bg-slate-100" />
          <button type="button" className={item} onClick={() => { setOpen(false); setResetting(true); }}>
            <RotateCcw className="h-4 w-4 text-brand-700" /> Reset demo data
          </button>
          <button type="button" className={item} onClick={logout}>
            <LogOut className="h-4 w-4 text-brand-700" /> Sign out
          </button>
        </div>
      )}
      {resetting && <ResetDemo onClose={() => setResetting(false)} />}
    </div>
  );
}

// True on desktop widths, where the bell and avatar sit in the page header;
// on phones they move to the top bar.
function useWide() {
  const q = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

export default function AdminLayout() {
  const [day, setDay] = useState(todayISO);
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current = NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));
  useEffect(() => {
    document.title = current ? `${current.label} · SmartRoute` : "SmartRoute";
  }, [current]);

  return (
    <div className="min-h-screen lg:pl-72">
      <aside className="fixed inset-y-0 left-0 z-[1200] hidden w-72 lg:block">
        <Sidebar />
      </aside>

      <div className="sticky top-0 z-[1100] flex items-center justify-between bg-[#E6F5EC]/95 px-4 py-3 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-full p-2 hover:bg-white/70">
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-bold">{current?.label}</span>
        {!wide && <HeaderExtras />}
      </div>
      {open && (
        <div className="fixed inset-0 z-[1300] lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">
            <Sidebar onNavigate={() => setOpen(false)} />
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
              className="absolute right-3 top-4 rounded-full p-1.5 text-ink hover:bg-white/70">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
        <HeaderExtrasContext.Provider value={wide ? <HeaderExtras /> : null}>
          <Outlet context={{ day, setDay }} />
        </HeaderExtrasContext.Provider>
      </main>
    </div>
  );
}

export const useDay = () => useOutletContext();

// Delivery-day pill used in page headers.
export function DayPicker() {
  const { day, setDay } = useDay();
  const today = todayISO();
  return (
    <div className="flex h-11 items-center rounded-full bg-white px-1 shadow-card">
      <button type="button" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day"
        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 hover:bg-mint-50">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <label className="relative flex cursor-pointer items-center gap-2 px-2 text-sm font-semibold tabular">
        <CalendarDays className="h-4 w-4 text-brand-700" aria-hidden="true" />
        {day === today ? `Today, ${formatDay(day)}` : formatDay(day)}
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0" aria-label="Delivery day" />
      </label>
      <button type="button" onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day"
        className="flex h-9 w-9 items-center justify-center rounded-full text-ink-500 hover:bg-mint-50">
        <ChevronRight className="h-4 w-4" />
      </button>
      {day !== today && (
        <button type="button" onClick={() => setDay(today)} className="ml-1 h-9 rounded-full bg-mint px-3 text-sm font-semibold text-brand-700 hover:bg-mint-200">
          Today
        </button>
      )}
    </div>
  );
}
