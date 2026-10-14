import React from "react";

export function Card({ title, subtitle, actions, children, className = "" }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-bold text-slate-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const BUTTON = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300",
  secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({ variant = "primary", className = "", ...props }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

const BADGE = {
  ok: "bg-emerald-50 text-emerald-700",
  delivered: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  pending: "bg-amber-50 text-amber-700",
  error: "bg-rose-50 text-rose-700",
  failed: "bg-rose-50 text-rose-700",
  assigned: "bg-blue-50 text-blue-700",
  neutral: "bg-slate-100 text-slate-600",
};

const STATUS_TEXT = { assigned: "To deliver", ok: "OK" };

export function Badge({ kind = "neutral", children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[kind] || BADGE.neutral}`}>
      {children ?? STATUS_TEXT[kind] ?? kind}
    </span>
  );
}

export function Stat({ label, value, hint, tone = "slate" }) {
  const tones = {
    slate: "text-slate-900",
    green: "text-emerald-700",
    red: "text-rose-700",
    amber: "text-amber-700",
    blue: "text-blue-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function ErrorBox({ error, onClose }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <span>{error}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="text-xs font-semibold underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function Spinner({ className = "" }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden="true" />;
}

// Risk badge from the customer's past deliveries (matched by phone).
export function CustomerBadge({ order }) {
  const total = order.customer_orders || 0;
  const failed = order.customer_failed || 0;
  if (failed >= 2) return <Badge kind="error">Risky: {failed}/{total} failed</Badge>;
  if (total >= 3 && failed === 0) return <Badge kind="ok">Trusted · {total} orders</Badge>;
  if (total === 0) return <Badge>New customer</Badge>;
  return null;
}
