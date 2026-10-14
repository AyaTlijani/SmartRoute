import React, { useState } from "react";
import { NavLink, Outlet, useLocation, useOutletContext } from "react-router-dom";
import {
  BarChart3, ChevronLeft, ChevronRight, FileSpreadsheet, LayoutDashboard, LogOut,
  Menu, Package, RotateCcw, Route, Users, X,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, errorText, formatDay, setToken, shiftDay, todayISO } from "../api";
import { Button, ErrorBanner, Modal, cx } from "../components/ui";

const NAV = [
  { to: "/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/admin/import", label: "Import orders", icon: FileSpreadsheet },
  { to: "/admin/dispatch", label: "Dispatch", icon: Route },
  { to: "/admin/orders", label: "Orders", icon: Package },
  { to: "/admin/drivers", label: "Drivers", icon: Users },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3 },
];

export function Logo({ light }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#16855A" />
        <path d="M9 22c0-4 3-5 7-5s7-1 7-5" stroke="white" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <circle cx="9" cy="22" r="2.6" fill="white" />
        <circle cx="23" cy="12" r="2.6" fill="white" />
      </svg>
      <span className={cx("text-xl font-extrabold tracking-tight", light ? "text-white" : "text-ink")}>SmartRoute</span>
    </div>
  );
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
          "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] transition-colors",
          isActive ? "bg-mint-200 font-semibold text-ink" : "font-medium text-ink-700 hover:bg-white/70 hover:text-ink"
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
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
    <div className="flex h-full flex-col border-r border-mint-200 bg-mint px-4 py-6">
      <div className="px-2 pb-8">
        <Logo />
        <p className="mt-1 pl-[42px] text-xs font-medium text-ink-500">Dispatch console</p>
      </div>
      <nav className="flex flex-col gap-1" aria-label="Main">
        {NAV.map((item) => <NavItem key={item.to} item={item} onClick={onNavigate} />)}
      </nav>
      <div className="mt-auto rounded-2xl bg-white/70 px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-sm font-bold text-white" aria-hidden="true">
            {(user?.full_name || "A").split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{user?.full_name}</span>
            <span className="block text-xs text-ink-500">Administrator</span>
          </span>
        </div>
        <button type="button" onClick={logout}
          className="mt-3 flex items-center gap-2 text-sm font-medium text-ink-700 hover:text-ink">
          <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
        </button>
        <button type="button" onClick={() => setResetting(true)}
          className="mt-2 flex items-center gap-2 text-sm font-medium text-ink-700 hover:text-ink">
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset demo data
        </button>
      </div>
      {resetting && <ResetDemo onClose={() => setResetting(false)} />}
    </div>
  );
}

export default function AdminLayout() {
  const [day, setDay] = useState(todayISO);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const current = NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)));

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-[1200] hidden w-64 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-[1100] flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="rounded p-1.5 hover:bg-slate-100">
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold">{current?.label}</span>
        <span className="w-8" />
      </div>
      {open && (
        <div className="fixed inset-0 z-[1300] lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">
            <Sidebar onNavigate={() => setOpen(false)} />
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
              className="absolute right-2 top-3 rounded p-1.5 text-ink hover:bg-white/70">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Outlet context={{ day, setDay }} />
      </main>
    </div>
  );
}

export const useDay = () => useOutletContext();

// Delivery-day switcher used in page headers.
export function DayPicker() {
  const { day, setDay } = useDay();
  const today = todayISO();
  return (
    <div className="flex items-center rounded-xl bg-white shadow-card">
      <button type="button" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-500 hover:bg-slate-50">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <label className="relative flex h-10 cursor-pointer items-center border-x border-slate-100 px-3 text-sm font-semibold tabular">
        {day === today ? `Today, ${formatDay(day)}` : formatDay(day)}
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0" aria-label="Delivery day" />
      </label>
      <button type="button" onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-500 hover:bg-slate-50">
        <ChevronRight className="h-4 w-4" />
      </button>
      {day !== today && (
        <button type="button" onClick={() => setDay(today)} className="h-10 rounded-r-xl border-l border-slate-100 px-3 text-sm font-semibold text-brand hover:bg-slate-50">
          Today
        </button>
      )}
    </div>
  );
}
