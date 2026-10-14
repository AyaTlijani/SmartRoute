/**
 * vite.config.js — Vite bundler configuration for the VRPTW frontend.
 *
 * Key configuration:
 *   plugins  — @vitejs/plugin-react enables JSX transform and HMR (hot reload).
 *
 *   server.proxy — During development, all requests to /api/* are proxied
 *     to the FastAPI backend running on http://localhost:8000.
 *     The "/api" prefix is stripped before forwarding (rewrite rule), so
 *     the backend route is /optimize-route (not /api/optimize-route).
 *
 *     Why a proxy instead of direct cross-origin calls?
 *       • Avoids CORS preflight overhead in dev.
 *       • The frontend code uses relative URLs ("/api/…") which work the
 *         same in both dev (proxied) and production (nginx / same origin).
 *       • Mirrors a typical production setup where frontend and backend
 *         sit behind the same reverse proxy.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    host: true, // reachable from a phone on the same Wi-Fi
    proxy: {
      // Any request from React matching /api/* will be forwarded to FastAPI.
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        // Strip the "/api" prefix so FastAPI sees e.g. "/optimize-route"
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
