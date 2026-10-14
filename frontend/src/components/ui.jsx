/**
 * ui.jsx — the small set of building blocks every page uses, so the app
 * looks and behaves the same everywhere.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";

export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- layout

// Pages put their own actions on the right; the admin layout adds the
// shared top-right cluster (alerts, date, avatar) through this context.
export const HeaderExtrasContext = createContext(null);

export function PageHeader({ title, description, actions, children }) {
  const extras = useContext(HeaderExtrasContext);
  return (
    <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:text-[32px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-ink-500">{description}</p>}
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {actions}
        {extras}
      </div>
    </div>
  );
}

export function Panel({ title, description, actions, children, className, bodyClass = "px-6 pb-6", id, tone = "white" }) {
  const tones = {
    white: "bg-white",
    mint: "bg-gradient-to-br from-mint-200 to-mint-300",
  };
  return (
    <section id={id} className={cx("overflow-hidden rounded-3xl border border-white/60 shadow-card", tones[tone], className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-6 pb-3 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-bold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-ink-500">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx(!title && !actions && bodyClass === "px-6 pb-6" ? "p-6" : bodyClass)}>{children}</div>
    </section>
  );
}

export function IconBadge({ icon: Icon, tone = "mint", size = "md" }) {
  const tones = {
    mint: "bg-mint-200 text-brand-700",
    white: "bg-white/80 text-brand-700",
    sun: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    sky: "bg-sky-100 text-sky-700",
  };
  const sizes = { sm: "h-9 w-9", md: "h-11 w-11", lg: "h-14 w-14" };
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-full", tones[tone], sizes[size])}>
      <Icon className={size === "lg" ? "h-6 w-6" : "h-5 w-5"} aria-hidden="true" />
    </span>
  );
}

export function Metric({ label, value, detail, tone, icon }) {
  const tones = { good: "text-brand", bad: "text-red-700", warn: "text-amber-700", brand: "text-brand" };
  return (
    <div className="flex min-w-0 items-center gap-3">
      {icon && <IconBadge icon={icon} />}
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink-500">{label}</p>
        <p className={cx("mt-0.5 text-2xl font-extrabold leading-tight tabular", tones[tone] || "text-ink")}>{value}</p>
        {detail && <p className="truncate text-xs text-ink-500">{detail}</p>}
      </div>
    </div>
  );
}

// A single bubbly number with its icon (Dispatch, Orders, Analytics headers).
export function StatCard({ label, value, detail, icon, tone }) {
  const tones = { good: "text-brand", bad: "text-red-700", warn: "text-amber-700" };
  return (
    <div className="flex min-w-0 items-center gap-4 rounded-3xl border border-white/60 bg-white px-4 py-4 shadow-card sm:px-5">
      {icon && <span className="hidden sm:block"><IconBadge icon={icon} tone={tone === "warn" ? "sun" : tone === "bad" ? "red" : "mint"} /></span>}
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink-500">{label}</p>
        <p className={cx("break-words text-xl font-extrabold leading-tight tabular sm:text-2xl", tones[tone] || "text-ink")}>{value}</p>
        {detail && <p className="text-xs leading-snug text-ink-500">{detail}</p>}
      </div>
    </div>
  );
}

export function MetricStrip({ children }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-3xl border border-white/60 bg-white px-6 py-5 shadow-card sm:grid-cols-3 lg:grid-cols-5">
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {Icon && <IconBadge icon={Icon} size="lg" />}
      <p className="mt-4 text-base font-bold text-ink">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-ink-500">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- controls

const VARIANT = {
  primary: "bg-brand text-white shadow-[0_6px_16px_rgba(22,147,92,0.28)] hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand/40 disabled:shadow-none",
  secondary: "border border-mint-200 bg-white text-ink hover:bg-mint-50 disabled:text-ink-300",
  ghost: "text-ink-700 hover:bg-slate-100 disabled:text-ink-300",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300",
  success: "bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-300",
};
const SIZE = { sm: "h-9 px-3.5 text-[13px]", md: "h-11 px-5 text-sm", lg: "h-12 px-6 text-base" };

export function Button({ variant = "primary", size = "md", icon: Icon, loading, className, children, ...props }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-colors disabled:cursor-not-allowed",
        VARIANT[variant], SIZE[size], className
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx("block", className)}>
      <span className="text-[13px] font-medium text-ink-700">{label}</span>
      <div className="mt-1">{children}</div>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </label>
  );
}

export const inputClass =
  "block w-full rounded-2xl border border-mint-200 bg-white px-3.5 py-2.5 text-ink placeholder:text-ink-300 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:bg-slate-50";

export function Input(props) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select({ children, ...props }) {
  return (
    <select {...props} className={cx(inputClass, "pr-8", props.className)}>
      {children}
    </select>
  );
}

export function Spinner({ className }) {
  return <Loader2 className={cx("h-4 w-4 animate-spin", className)} aria-hidden="true" />;
}

// Grey placeholders in the shape of the page, shown while data loads.
const Bone = ({ className }) => <div className={cx("animate-pulse rounded-3xl bg-white/80 shadow-card", className)} />;
export function Skeleton({ layout = "dashboard" }) {
  const stats = (n) => (
    <div className={cx("grid gap-4 sm:grid-cols-2", n === 5 ? "xl:grid-cols-5" : n === 3 ? "sm:grid-cols-3" : "xl:grid-cols-4")}>
      {Array.from({ length: n }, (_, i) => <Bone key={i} className="h-[92px]" />)}
    </div>
  );
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      {layout === "dashboard" && <>
        {stats(4)}
        <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]"><Bone className="h-[320px]" /><Bone className="h-[320px]" /></div>
        <div className="grid gap-6 lg:grid-cols-2"><Bone className="h-[260px]" /><Bone className="h-[260px]" /></div>
      </>}
      {layout === "dispatch" && <>
        {stats(5)}
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Bone key={i} className="h-[110px]" />)}</div>
          <Bone className="h-[560px]" />
        </div>
      </>}
      {layout === "cards" && (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Bone key={i} className="h-[380px]" />)}</div>
      )}
      {layout === "table" && (
        <div className="rounded-3xl bg-white p-5 shadow-card">
          <div className="mb-3 h-10 animate-pulse rounded-xl bg-mint" />
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="mb-2 h-12 animate-pulse rounded-xl bg-slate-100/70" />)}
        </div>
      )}
    </div>
  );
}

export function Loading({ label = "Loading" }) {
  return (
    <p className="flex items-center gap-2 py-10 text-sm text-ink-500" role="status">
      <Spinner /> {label}…
    </p>
  );
}

export function ErrorBanner({ error, onClose }) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{error}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="text-red-700 hover:text-red-900">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- badges

const TONE = {
  neutral: "bg-slate-100 text-ink-700",
  brand: "bg-brand-50 text-brand-700",
  info: "bg-sky-50 text-sky-800",
  good: "bg-emerald-50 text-emerald-800",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-red-50 text-red-800",
};

export function Badge({ tone = "neutral", children, className }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", TONE[tone], className)}>
      {children}
    </span>
  );
}

const STATUS = {
  pending: ["warn", "Unassigned"],
  assigned: ["info", "To deliver"],
  delivered: ["good", "Delivered"],
  failed: ["bad", "Failed"],
};

export function StatusBadge({ status }) {
  const [tone, label] = STATUS[status] || ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}

// Delivery history of the customer behind this order (matched by phone).
export function CustomerBadge({ order }) {
  const total = order.customer_orders || 0;
  const failed = order.customer_failed || 0;
  if (failed >= 2) return <Badge tone="bad">Refused before: {failed} of {total}</Badge>;
  if (total >= 3 && failed === 0) return <Badge tone="good">Regular, {total} delivered</Badge>;
  return null;
}

export function PrecisionBadge({ precision }) {
  if (precision === "governorate") return <Badge tone="warn">Approximate location</Badge>;
  return null;
}

// ---------------------------------------------------------------- overlays

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl sm:rounded-lg", wide ? "sm:max-w-2xl" : "sm:max-w-md")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = "good") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const icons = { good: CheckCircle2, bad: XCircle, warn: AlertTriangle, info: Info };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[3000] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:translate-x-0" aria-live="polite">
        {toasts.map((t) => {
          const Icon = icons[t.tone] || Info;
          return (
            <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-2xl bg-ink px-4 py-3 text-sm font-medium text-white shadow-float">
              <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", t.tone === "bad" ? "text-red-300" : t.tone === "warn" ? "text-amber-300" : "text-emerald-300")} />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// Where a driver is in their working day.
export function dayStateOf(ds) {
  if (!ds || !ds.started_at) return "not_started";
  if (ds.received_at) return "reconciled";
  if (ds.ended_at) return "finished";
  return "on_road";
}

export function DayStateBadge({ state, since }) {
  const map = {
    not_started: ["neutral", "Not started"],
    on_road: ["info", since ? `On the road since ${since.slice(11, 16)}` : "On the road"],
    finished: ["warn", "Finished, cash to confirm"],
    reconciled: ["good", "Day closed"],
  };
  const [tone, label] = map[state] || map.not_started;
  return <Badge tone={tone}>{label}</Badge>;
}
