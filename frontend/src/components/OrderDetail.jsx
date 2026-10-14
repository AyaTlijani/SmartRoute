import React, { useEffect, useState } from "react";
import { Camera, Phone } from "lucide-react";
import { api, dt, errorText, formatDay } from "../api";
import { Badge, Button, CustomerBadge, ErrorBanner, Loading, Modal, PrecisionBadge, StatusBadge, useToast } from "./ui";

// Admin view of one order: details, full attempt history, photo, retry.
export default function OrderDetail({ orderId, onClose, onChanged }) {
  const [o, setO] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = () => api.get(`/orders/${orderId}`).then((r) => setO(r.data)).catch((e) => setError(errorText(e)));
  useEffect(() => {
    load();
  }, [orderId]);
  useEffect(() => () => photo && URL.revokeObjectURL(photo), [photo]);

  const showPhoto = async () => {
    try {
      const r = await api.get(`/orders/${orderId}/photo`, { responseType: "blob" });
      setPhoto(URL.createObjectURL(r.data));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      const r = (await api.post(`/orders/${orderId}/retry`)).data;
      toast(r.created ? `Retry scheduled for ${formatDay(r.day)}` : `A retry already exists for ${formatDay(r.day)}`);
      await load();
      onChanged?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={o ? `Order #${o.id}` : "Order"} onClose={onClose} wide
      footer={o?.status === "failed" && !o.retry_order_id && <Button loading={busy} onClick={retry}>Retry next day</Button>}>
      <ErrorBanner error={error} />
      {!o ? <Loading /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-base font-semibold">{o.customer_name}</p>
              <a href={`tel:+216${o.phone}`} className="mt-0.5 inline-flex items-center gap-1.5 tabular text-brand">
                <Phone className="h-3.5 w-3.5" /> {o.phone}
              </a>
              <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge status={o.status} /><CustomerBadge order={o} /><PrecisionBadge precision={o.location_precision} /></div>
            </div>
            <div className="text-right">
              <p className="text-ink-500">Cash to collect</p>
              <p className="text-lg font-semibold tabular">{dt(o.cod_amount)}</p>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {[
              ["Address", `${o.address}, ${o.city ? o.city + ", " : ""}${o.governorate}`],
              ["Landmark", o.landmark || "None"],
              ["Product", o.product || "Not given"],
              ["Delivery day", formatDay(o.delivery_date)],
              ["Time slot", o.slot_label],
              ["Driver", o.driver_name ? `${o.driver_name}${o.stop_number ? `, stop ${o.stop_number}` : ""}${o.eta ? ` at ${o.eta}` : ""}` : "Not assigned"],
              ["Notes", o.notes || "None"],
            ].map(([k, v]) => (
              <div key={k}><dt className="text-ink-500">{k}</dt><dd className="mt-0.5">{v}</dd></div>
            ))}
          </dl>

          {o.unscheduled_reason && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              Not on the route: {o.unscheduled_reason} Move it to another driver, change its slot, or plan it for another day.
            </p>
          )}
          {o.retry_of && <p className="text-ink-500">This is a retry of order #{o.retry_of}.</p>}
          {o.retry_order_id && <p className="text-ink-500">Retried as order #{o.retry_order_id} on {formatDay(o.retry_date)}.</p>}

          <div>
            <p className="font-medium">Delivery attempts</p>
            {o.attempts.length === 0 ? (
              <p className="mt-1 text-ink-500">No attempt yet.</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {o.attempts.map((a) => (
                  <li key={a.id} className={a.voided_at ? "text-ink-500 line-through decoration-ink-300" : ""}>
                    <span className="tabular">{a.created_at.slice(0, 16)}</span>, {a.driver_name}:{" "}
                    {a.result === "delivered" ? `delivered, collected ${dt(a.cash_collected)}` : `failed (${a.reason}${a.note ? `, "${a.note}"` : ""})`}
                    {a.voided_at && <Badge className="ml-2 no-underline">Undone</Badge>}
                  </li>
                ))}
              </ol>
            )}
            {!!o.has_photo && !photo && (
              <Button variant="secondary" size="sm" icon={Camera} className="mt-3" onClick={showPhoto}>Show proof photo</Button>
            )}
            {photo && <img src={photo} alt="Proof of delivery" className="mt-3 max-h-72 rounded-md border border-slate-200" />}
          </div>
        </div>
      )}
    </Modal>
  );
}
