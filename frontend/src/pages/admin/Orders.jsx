import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock3, Inbox, Package, Search, Truck, XCircle } from "lucide-react";
import { api, dt, errorText, formatDay } from "../../api";
import { DayPicker, useDay } from "../../layouts/AdminLayout";
import OrderDetail from "../../components/OrderDetail";
import {
  Button, CustomerBadge, EmptyState, ErrorBanner, Input, Loading, Skeleton, PageHeader, Panel, PrecisionBadge, StatusBadge, cx,
} from "../../components/ui";

const FILTERS = [
  ["all", "All orders", Package, "bg-mint-200 text-brand-700"],
  ["pending", "Unassigned", Inbox, "bg-lime/40 text-[#4F7A1E]"],
  ["assigned", "To deliver", Truck, "bg-sky-100 text-sky-700"],
  ["delivered", "Delivered", CheckCircle2, "bg-brand text-white"],
  ["failed", "Failed", XCircle, "bg-red-100 text-red-700"],
];

export default function Orders() {
  const { day } = useDay();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "all";
  const [orders, setOrders] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api.get("/orders", { params: { day } }).then((r) => setOrders(r.data)).catch((e) => setError(errorText(e)));
  useEffect(() => {
    setOrders(null);
    load();
  }, [day]);

  const shown = useMemo(() => {
    if (!orders) return [];
    const q = query.trim().toLowerCase();
    return orders.filter((o) =>
      (status === "all" || o.status === status) &&
      (!q || [o.customer_name, o.phone, o.city, o.governorate, o.address, String(o.id)].some((v) => (v || "").toLowerCase().includes(q)))
    );
  }, [orders, status, query]);

  const count = (s) => (orders || []).filter((o) => s === "all" || o.status === s).length;

  return (
    <>
      <PageHeader title="Orders" description={`Every order scheduled for ${formatDay(day)}.`} actions={<DayPicker />} />
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {!orders ? <Skeleton layout="table" /> : orders.length === 0 ? (
        <Panel><EmptyState icon={Package} title="No orders for this day"
          action={<Link to="/admin/import"><Button>Import orders</Button></Link>}>
          Import the confirmed-orders Excel file to schedule deliveries.
        </EmptyState></Panel>
      ) : (
        <>
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" role="tablist" aria-label="Filter by status">
          {FILTERS.map(([k, label, Icon, tone]) => (
            <button key={k} type="button" role="tab" aria-selected={status === k}
              onClick={() => setParams(k === "all" ? {} : { status: k })}
              className={cx("flex items-center gap-3 rounded-3xl border-2 bg-white px-4 py-3.5 text-left shadow-card transition-colors",
                status === k ? "border-brand" : "border-transparent hover:border-mint-300")}>
              <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", tone)}><Icon className="h-5 w-5" /></span>
              <span>
                <span className="block text-[13px] font-medium text-ink-500">{label}</span>
                <span className="block text-xl font-extrabold leading-tight tabular">{count(k)}</span>
              </span>
            </button>
          ))}
        </div>
        <Panel bodyClass="px-5 pb-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pt-5">
            <p className="text-lg font-bold">{FILTERS.find((f) => f[0] === status)?.[1] || "Orders"} <span className="text-sm font-semibold text-ink-500">· {shown.length} shown</span></p>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
              <Input placeholder="Search name, phone, city" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" aria-label="Search orders" />
            </div>
          </div>
          <div className="max-h-[calc(100vh-240px)] min-h-[320px] overflow-auto rounded-xl">
            <table className="table-soft table-sticky min-w-[880px]">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Location</th>
                  <th>Driver</th>
                  <th>Slot / ETA</th>
                  <th className="text-right">COD</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id} onClick={() => setOpen(o.id)} className="cursor-pointer align-top hover:bg-slate-50">
                    <td className="tabular text-ink-500">#{o.id}</td>
                    <td>
                      <button type="button" className="text-left font-medium hover:text-brand" onClick={() => setOpen(o.id)}>{o.customer_name}</button>
                      <span className="block tabular text-[13px] text-ink-500">{o.phone}</span>
                      <div className="mt-1"><CustomerBadge order={o} /></div>
                    </td>
                    <td>
                      {o.city || o.governorate}
                      <span className="block text-[13px] text-ink-500">{o.governorate}</span>
                      <div className="mt-1"><PrecisionBadge precision={o.location_precision} /></div>
                    </td>
                    <td>{o.driver_name || <span className="text-ink-500">None</span>}</td>
                    <td className="whitespace-nowrap tabular">
                      {o.eta || "–"}
                      <span className="block text-[13px] text-ink-500">{["Any time", "Morning", "Afternoon"][o.slot || 0]}</span>
                    </td>
                    <td className="whitespace-nowrap text-right tabular">
                      {dt(o.cod_amount)}
                      {o.status === "delivered" && o.cash_collected < o.cod_amount && (
                        <span className="block text-[13px] text-red-700">got {dt(o.cash_collected)}</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                      {o.fail_reason && <span className="mt-1 block text-[13px] text-red-700">{o.fail_reason}</span>}
                      {o.retry_order_id && <span className="mt-1 block text-[13px] text-ink-500">Retry #{o.retry_order_id}</span>}
                      {o.unscheduled_reason && <span className="mt-1 block text-[13px] text-amber-800">Not on route</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="px-5 py-8 text-sm text-ink-500">No order matches this filter.</p>}
          </div>
        </Panel>
        </>
      )}
      {open && <OrderDetail orderId={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
