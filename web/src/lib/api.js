/**
 * API base for production (GitHub Pages → Render).
 * Locally leave unset so Vite proxies `/api` to localhost:8787.
 *
 * Example: VITE_API_BASE=https://egx-api.onrender.com
 */
export function apiUrl(path) {
  const base = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
