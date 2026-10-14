import React, { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { errorText } from "../api";
import { homeFor, useAuth } from "../auth";
import { Logo } from "../layouts/AdminLayout";
import { Button, ErrorBanner, Field, Input } from "../components/ui";

const DEMO = [
  { role: "Admin", username: "admin", password: "admin123", note: "Import, dispatch, drivers, analytics" },
  { role: "Driver", username: "ahmed", password: "driver123", note: "Tunis and Ariana" },
  { role: "Driver", username: "mehdi", password: "driver123", note: "Sousse, Monastir, Mahdia" },
];

export default function Login() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (ready && user) return <Navigate to={homeFor(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(username, password);
      const from = location.state?.from;
      navigate(from && from.startsWith(homeFor(u)) ? from : homeFor(u), { replace: true });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,560px)]">
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <RouteArt />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo light />
          <div className="max-w-md">
            <p className="text-[28px] font-semibold leading-tight text-white">
              Confirmed orders in the morning. Every driver on the right route by nine.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-300">
              Import the day's Excel file, assign orders by zone, optimize each route with time windows,
              and follow every delivery and every dinar collected.
            </p>
          </div>
          <p className="text-xs text-ink-500">Demo build. Generated customers, no real data.</p>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden"><Logo /></div>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight lg:mt-0">Sign in</h1>
          <p className="mt-1 text-sm text-ink-500">Admins and drivers use the same page.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <ErrorBanner error={error} />
            <Field label="Username">
              <Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Button type="submit" loading={busy} className="w-full" size="lg">Sign in</Button>
          </form>

          <div className="mt-10 border-t border-slate-200 pt-5">
            <p className="text-[13px] font-medium text-ink-700">Demo accounts</p>
            <ul className="mt-2 divide-y divide-slate-100">
              {DEMO.map((d) => (
                <li key={d.username}>
                  <button type="button" onClick={() => { setUsername(d.username); setPassword(d.password); }}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:text-brand">
                    <span>
                      <span className="text-sm font-medium">{d.role}: {d.username}</span>
                      <span className="block text-xs text-ink-500">{d.note}</span>
                    </span>
                    <span className="text-xs text-ink-500">Fill in</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-500">Driver passwords are all driver123. Every driver has their own login.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// A quiet route drawing behind the login text: depot, stops, one path.
function RouteArt() {
  const stops = [[120, 520], [210, 430], [330, 470], [420, 360], [520, 410], [600, 290], [470, 220], [640, 150]];
  const d = stops.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 760 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {Array.from({ length: 19 }, (_, i) => (
        <line key={i} x1={i * 40} y1="0" x2={i * 40} y2="760" stroke="#1B3A2B" strokeWidth="1" />
      ))}
      {Array.from({ length: 19 }, (_, i) => (
        <line key={`h${i}`} x1="0" y1={i * 40} x2="760" y2={i * 40} stroke="#1B3A2B" strokeWidth="1" />
      ))}
      <path d={d} stroke="#3FBF86" strokeWidth="3" fill="none" strokeLinejoin="round" opacity="0.55" />
      {stops.map(([x, y], i) => (
        <circle key={i} opacity="0.7" cx={x} cy={y} r={i === 0 ? 9 : 6} fill={i === 0 ? "#fff" : "#12291E"} stroke={i === 0 ? "#3FBF86" : "#7FD6AE"} strokeWidth="3" />
      ))}
    </svg>
  );
}
