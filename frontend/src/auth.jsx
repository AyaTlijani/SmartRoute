import React, { createContext, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, getToken, setToken } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // Restore the session on page load.
  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    api.get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const login = async (username, password) => {
    const r = await api.post("/auth/login", { username, password });
    setToken(r.data.token);
    setUser(r.data.user);
    return r.data.user;
  };

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const homeFor = (user) => (user?.role === "driver" ? "/driver" : "/admin");

// Route guard: must be logged in with the given role.
export function RequireRole({ role, children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return children;
}
