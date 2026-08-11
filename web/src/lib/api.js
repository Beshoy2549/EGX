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

/**
 * Static files from web/public (latest.json, fundamentals.json).
 * Must include Vite BASE_URL so GitHub Pages serves /EGX/latest.json
 * instead of github.io/latest.json.
 */
export function publicUrl(path) {
  const base = String(import.meta.env.BASE_URL || "/");
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const p = String(path || "").replace(/^\//, "");
  return `${prefix}${p}`;
}
