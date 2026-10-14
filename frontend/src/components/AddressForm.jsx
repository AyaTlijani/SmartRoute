/**
 * AddressForm.jsx — SmartRoute route planning workspace.
 *
 * Handles:
 *   - Depot / starting point
 *   - Dynamic delivery stops
 *   - Delivery time windows
 *   - Add / remove stops
 *   - Client-side validation
 *   - Route optimization submission
 */

import React, { useState } from "react";

const MAX_STOPS = 20;

const newStop = () => ({
  id: `${Date.now()}-${Math.random()}`,
  address: "",
  slot: 1,
});

export default function AddressForm({ onSubmit, loading }) {
  const [depotAddress, setDepotAddress] = useState("");
  const [stops, setStops] = useState([newStop()]);
  const [errors, setErrors] = useState({});

  const addStop = () => {
    if (stops.length >= MAX_STOPS || loading) {
      return;
    }

    setStops((prev) => [...prev, newStop()]);
  };

  const removeStop = (id) => {
    if (stops.length <= 1 || loading) {
      return;
    }

    setStops((prev) => prev.filter((stop) => stop.id !== id));

    setErrors((prev) => {
      const next = { ...prev };

      Object.keys(next).forEach((key) => {
        if (key.startsWith("stop_")) {
          delete next[key];
        }
      });

      return next;
    });
  };

  const updateStop = (id, field, value) => {
    setStops((prev) =>
      prev.map((stop) =>
        stop.id === id
          ? {
              ...stop,
              [field]: value,
            }
          : stop
      )
    );

    setErrors((prev) => {
      const next = { ...prev };

      if (field === "address") {
        Object.keys(next).forEach((key) => {
          if (key.startsWith("stop_")) {
            delete next[key];
          }
        });
      }

      return next;
    });
  };

  const validate = () => {
    const nextErrors = {};

    if (!depotAddress.trim()) {
      nextErrors.depot =
        "Enter the address where the route starts.";
    }

    stops.forEach((stop, index) => {
      if (!stop.address.trim()) {
        nextErrors[`stop_${index}`] =
          "Enter a delivery address.";
      }
    });

    return nextErrors;
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (loading) {
      return;
    }

    const validationErrors = validate();

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);

      const firstError = Object.keys(validationErrors)[0];

      document
        .getElementById(`field-${firstError}`)
        ?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

      return;
    }

    setErrors({});

    onSubmit({
      depot_address: depotAddress.trim(),
      deliveries: stops.map((stop) => ({
        address: stop.address.trim(),
        slot: stop.slot,
      })),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="space-y-7"
    >

      {/* ============================================================
          DEPOT / START
          ============================================================ */}

      <div>

        <div className="mb-3 flex items-start gap-3">

          <div
            className="flex h-9 w-9 shrink-0 items-center
              justify-center rounded-lg bg-slate-900 text-white
              text-sm font-bold"
            aria-hidden="true"
          >
            D
          </div>

          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Starting point
            </h3>

            <p className="mt-0.5 text-xs text-slate-500">
              Where the vehicle begins its route.
            </p>
          </div>

        </div>

        <label
          htmlFor="depot-input"
          className="mb-1.5 block text-xs font-semibold
            text-slate-600"
        >
          Depot / warehouse address
        </label>

        <input
          id="depot-input"
          type="text"
          value={depotAddress}
          onChange={(event) => {
            setDepotAddress(event.target.value);

            if (errors.depot) {
              setErrors((prev) => {
                const next = { ...prev };
                delete next.depot;
                return next;
              });
            }
          }}
          placeholder="e.g. Avenue de la Liberté, Monastir, Tunisia"
          autoComplete="street-address"
          disabled={loading}
          className={`w-full rounded-xl border px-4 py-3
            text-base text-slate-900 outline-none transition
            placeholder:text-slate-400
            focus:ring-2 focus:ring-blue-500
            disabled:cursor-not-allowed disabled:bg-slate-50
            ${
              errors.depot
                ? "border-red-400 bg-red-50"
                : "border-slate-200 bg-white"
            }`}
        />

        {errors.depot && (
          <p
            id="field-depot-error"
            className="mt-1.5 text-xs font-medium text-red-600"
            role="alert"
          >
            {errors.depot}
          </p>
        )}

      </div>


      {/* ============================================================
          DELIVERY STOPS
          ============================================================ */}

      <div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row
          sm:items-end sm:justify-between">

          <div className="flex items-start gap-3">

            <div
              className="flex h-9 w-9 shrink-0 items-center
                justify-center rounded-lg bg-blue-600 text-white
                text-sm font-bold"
              aria-hidden="true"
            >
              1
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Delivery stops
              </h3>

              <p className="mt-0.5 text-xs text-slate-500">
                Add each customer and their preferred delivery window.
              </p>
            </div>

          </div>

          <span className="text-xs font-medium text-slate-400">
            {stops.length} / {MAX_STOPS} stops
          </span>

        </div>


        {/* Stop list */}

        <div className="space-y-3">

          {stops.map((stop, index) => {

            const addressError =
              errors[`stop_${index}`];

            return (
              <div
                key={stop.id}
                id={`field-stop_${index}`}
                className={`rounded-xl border p-3 transition
                  ${
                    addressError
                      ? "border-red-200 bg-red-50/50"
                      : "border-slate-200 bg-slate-50/60"
                  }`}
              >

                <div className="flex gap-3">

                  {/* Number */}

                  <div
                    className="flex h-9 w-9 shrink-0 items-center
                      justify-center rounded-full bg-blue-600
                      text-sm font-bold text-white"
                    aria-label={`Delivery ${index + 1}`}
                  >
                    {index + 1}
                  </div>


                  {/* Fields */}

                  <div className="min-w-0 flex-1 space-y-2.5">

                    <div>

                      <label
                        htmlFor={`address-${stop.id}`}
                        className="sr-only"
                      >
                        Address for delivery {index + 1}
                      </label>

                      <input
                        id={`address-${stop.id}`}
                        type="text"
                        value={stop.address}
                        onChange={(event) =>
                          updateStop(
                            stop.id,
                            "address",
                            event.target.value
                          )
                        }
                        placeholder={`Customer address ${index + 1}`}
                        autoComplete="off"
                        disabled={loading}
                        className={`w-full rounded-lg border
                          bg-white px-3 py-2.5 text-sm
                          text-slate-900 outline-none transition
                          placeholder:text-slate-400
                          focus:ring-2 focus:ring-blue-500
                          disabled:cursor-not-allowed
                          disabled:bg-slate-100
                          ${
                            addressError
                              ? "border-red-400"
                              : "border-slate-200"
                          }`}
                      />

                      {addressError && (
                        <p
                          className="mt-1 text-xs font-medium
                            text-red-600"
                          role="alert"
                        >
                          {addressError}
                        </p>
                      )}

                    </div>


                    {/* Time window */}

                    <div className="flex flex-col gap-2 sm:flex-row
                      sm:items-center">

                      <label
                        htmlFor={`slot-${stop.id}`}
                        className="text-xs font-semibold
                          text-slate-500"
                      >
                        Delivery window
                      </label>

                      <select
                        id={`slot-${stop.id}`}
                        value={stop.slot}
                        onChange={(event) =>
                          updateStop(
                            stop.id,
                            "slot",
                            Number(event.target.value)
                          )
                        }
                        disabled={loading}
                        className="rounded-lg border border-slate-200
                          bg-white px-3 py-2 text-sm font-medium
                          text-slate-700 outline-none
                          focus:ring-2 focus:ring-blue-500
                          disabled:cursor-not-allowed
                          disabled:bg-slate-100"
                      >
                        <option value={1}>
                          Morning · 9:00 AM – 12:00 PM
                        </option>

                        <option value={2}>
                          Afternoon · 1:00 PM – 5:00 PM
                        </option>
                      </select>

                    </div>

                  </div>


                  {/* Remove */}

                  {stops.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStop(stop.id)}
                      disabled={loading}
                      aria-label={`Remove delivery ${index + 1}`}
                      title="Remove delivery"
                      className="flex h-9 w-9 shrink-0 items-center
                        justify-center rounded-lg text-slate-400
                        transition hover:bg-red-50 hover:text-red-600
                        disabled:cursor-not-allowed
                        disabled:opacity-40"
                    >
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          d="M6 6l12 12M18 6L6 18"
                        />
                      </svg>
                    </button>
                  )}

                </div>

              </div>
            );
          })}

        </div>


        {/* Add stop */}

        <button
          type="button"
          onClick={addStop}
          disabled={stops.length >= MAX_STOPS || loading}
          className="mt-3 inline-flex items-center gap-2
            rounded-lg border border-dashed border-slate-300
            px-3 py-2 text-sm font-semibold text-blue-600
            transition hover:border-blue-300 hover:bg-blue-50
            disabled:cursor-not-allowed disabled:text-slate-400
            disabled:hover:border-slate-300
            disabled:hover:bg-transparent"
        >
          <span className="text-base leading-none">
            +
          </span>

          Add delivery

        </button>

        {stops.length >= MAX_STOPS && (
          <p className="mt-2 text-xs text-slate-400">
            Maximum of {MAX_STOPS} delivery stops reached.
          </p>
        )}

      </div>


      {/* ============================================================
          TIME WINDOW LEGEND
          ============================================================ */}

      <div className="rounded-xl border border-slate-100
        bg-slate-50 p-4">

        <p className="mb-2 text-xs font-bold text-slate-600">
          Delivery windows
        </p>

        <div className="flex flex-col gap-2 text-xs text-slate-500
          sm:flex-row sm:gap-5">

          <span className="flex items-center gap-2">

            <span
              className="h-2.5 w-2.5 rounded-full bg-blue-500"
              aria-hidden="true"
            />

            Morning · 9:00 AM – 12:00 PM

          </span>

          <span className="flex items-center gap-2">

            <span
              className="h-2.5 w-2.5 rounded-full bg-orange-500"
              aria-hidden="true"
            />

            Afternoon · 1:00 PM – 5:00 PM

          </span>

        </div>

      </div>


      {/* ============================================================
          OPTIMIZE
          ============================================================ */}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2
          rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-bold
          text-white shadow-sm transition
          hover:bg-blue-700
          active:scale-[0.99]
          disabled:cursor-not-allowed
          disabled:opacity-60"
      >

        {loading ? (
          <>
            <svg
              className="h-5 w-5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />

              <path
                className="opacity-90"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v8H4z"
              />
            </svg>

            Optimizing route...

          </>
        ) : (
          <>
            Optimize delivery route

            <span
              className="text-base"
              aria-hidden="true"
            >
              →
            </span>
          </>
        )}

      </button>

      <p className="text-center text-xs text-slate-400">
        SmartRoute will calculate travel times and find a feasible
        delivery sequence while respecting your time windows.
      </p>

    </form>
  );
}