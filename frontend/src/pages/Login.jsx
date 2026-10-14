import React, { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Bike, ShieldCheck } from "lucide-react";
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
    <div className="grid min-h-screen gap-6 p-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:p-6">
      <div className="relative hidden overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-[#1FA46A] via-[#16935C] to-[#0D6540] lg:block">
        <RouteArt />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Logo light size="lg" />
          <div className="max-w-md">
            <div className="mb-8 flex flex-wrap gap-3">
              <Bubble label="Step 1" value="Excel import" />
              <Bubble label="Step 2" value="Optimized routes" />
              <Bubble label="Step 3" value="Cash on delivery" />
            </div>
            <p className="text-[32px] font-extrabold leading-tight tracking-tight text-white">
              Confirmed orders in the morning. Every driver on the right route by nine.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-white/80">
              Import the day's Excel file, assign orders by zone, optimize each route with time windows,
              and follow every delivery and every dinar collected.
            </p>
          </div>
          <p className="text-xs text-white/60">Demo build. Generated customers, no real data.</p>
        </div>
      </div>

      <div className="flex items-center justify-center px-2 py-10">
        <div className="w-full max-w-md rounded-[2rem] bg-white p-8 shadow-card sm:p-10">
          <div className="lg:hidden"><Logo /></div>
          <h1 className="mt-8 text-[28px] font-extrabold tracking-tight lg:mt-0">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-500">Sign in to SmartRoute. Admins and drivers use the same page.</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <ErrorBanner error={error} />
            <Field label="Username">
              <Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <Button type="submit" loading={busy} className="w-full" size="lg">Sign in</Button>
          </form>

          <div className="mt-8">
            <p className="text-[13px] font-semibold text-ink-700">Try a demo account</p>
            <ul className="mt-2 space-y-2">
              {DEMO.map((d) => (
                <li key={d.username}>
                  <button type="button" onClick={() => { setUsername(d.username); setPassword(d.password); }}
                    className="flex w-full items-center gap-3 rounded-2xl bg-mint-50 px-3 py-2.5 text-left transition-colors hover:bg-mint">
                    <span className={d.role === "Admin"
                      ? "flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white"
                      : "flex h-10 w-10 items-center justify-center rounded-full bg-mint-200 text-brand-700"}>
                      {d.role === "Admin" ? <ShieldCheck className="h-5 w-5" /> : <Bike className="h-5 w-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{d.role}: {d.username}</span>
                      <span className="block truncate text-xs text-ink-500">{d.note}</span>
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-brand-700">Fill in</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-500">Driver passwords are all driver123. Every driver has their own login.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ label, value }) {
  return (
    <div className="rounded-2xl bg-white/15 px-4 py-2.5 ring-1 ring-white/25 backdrop-blur">
      <p className="text-[11px] font-medium text-white/75">{label}</p>
      <p className="text-lg font-extrabold tabular text-white">{value}</p>
    </div>
  );
}

// A route drawing behind the login text: depot, stops, one path.
function RouteArt() {
  const stops = [[360, 330], [420, 255], [505, 285], [535, 190], [600, 220], [615, 125], [540, 95], [640, 60]];
  const d = stops.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 760 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="680" cy="80" r="220" fill="#ffffff" opacity="0.06" />
      <circle cx="80" cy="720" r="260" fill="#A8D86A" opacity="0.10" />
      <path d={d} stroke="#ffffff" strokeWidth="10" fill="none" strokeLinejoin="round" strokeLinecap="round" opacity="0.18" />
      <path d={d} stroke="#C9F0A0" strokeWidth="4" fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="2 12" opacity="0.9" />
      {stops.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 0 ? 11 : 8} fill={i === 0 ? "#0F1F17" : "#ffffff"} stroke={i === 0 ? "#ffffff" : "#16935C"} strokeWidth="4" />
      ))}
    </svg>
  );
}
