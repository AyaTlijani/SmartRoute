/**
 * App.jsx — routes.
 *
 *   /login               sign in (admin or driver)
 *   /admin/...           admin console (admins only)
 *   /driver              driver app (drivers only, their own deliveries)
 */

import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireRole, homeFor, useAuth } from "./auth";
import AdminLayout from "./layouts/AdminLayout";
import Login from "./pages/Login";
import Overview from "./pages/admin/Overview";
import Orders from "./pages/admin/Orders";
import Import from "./pages/admin/Import";
import Dispatch from "./pages/admin/Dispatch";
import Drivers from "./pages/admin/Drivers";
import Analytics from "./pages/admin/Analytics";
import DriverApp from "./pages/driver/DriverApp";

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return <Navigate to={user ? homeFor(user) : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/admin"
        element={
          <RequireRole role="admin">
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route index element={<Overview />} />
        <Route path="orders" element={<Orders />} />
        <Route path="import" element={<Import />} />
        <Route path="dispatch" element={<Dispatch />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="analytics" element={<Analytics />} />
      </Route>
      <Route
        path="/driver"
        element={
          <RequireRole role="driver">
            <DriverApp />
          </RequireRole>
        }
      />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
