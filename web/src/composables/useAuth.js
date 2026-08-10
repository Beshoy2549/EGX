import { computed, ref } from "vue";

const STORAGE_KEY = "egx_auth_session";

/** Static credentials — change here or via VITE_AUTH_EMAIL / VITE_AUTH_PASSWORD. */
const AUTH_EMAIL = (import.meta.env.VITE_AUTH_EMAIL || "admin@egx.local").trim().toLowerCase();
const AUTH_PASSWORD = String(import.meta.env.VITE_AUTH_PASSWORD || "egx1234");

/**
 * Dev backdoor: open any URL with ?devbypass=1 (or VITE_AUTH_BYPASS value)
 * to skip the login form. Example: http://localhost:5173/?devbypass=1
 */
const BYPASS_PARAM = "devbypass";
const BYPASS_VALUE = String(import.meta.env.VITE_AUTH_BYPASS || "1");

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.email || !data?.at) return null;
    return data;
  } catch {
    return null;
  }
}

function writeSession(next) {
  session.value = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

const session = ref(loadSession());

export function useAuth() {
  const isAuthenticated = computed(() => Boolean(session.value?.email));
  const email = computed(() => session.value?.email || "");

  function login(inputEmail, inputPassword) {
    const e = String(inputEmail || "").trim().toLowerCase();
    const p = String(inputPassword || "");
    if (!e || !p) {
      return { ok: false, error: "empty" };
    }
    if (e !== AUTH_EMAIL || p !== AUTH_PASSWORD) {
      return { ok: false, error: "invalid" };
    }
    writeSession({ email: e, at: new Date().toISOString() });
    return { ok: true };
  }

  /** Accept the developer query-param backdoor and persist a session. */
  function loginViaBypass() {
    writeSession({
      email: "dev@bypass.local",
      at: new Date().toISOString(),
      bypass: true,
    });
    return true;
  }

  /** True when `to.query.devbypass` matches the configured value. */
  function hasBypassQuery(query) {
    const raw = query?.[BYPASS_PARAM];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value != null && String(value) === BYPASS_VALUE;
  }

  function stripBypassQuery(query) {
    const next = { ...query };
    delete next[BYPASS_PARAM];
    return next;
  }

  function logout() {
    session.value = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  return {
    isAuthenticated,
    email,
    login,
    loginViaBypass,
    hasBypassQuery,
    stripBypassQuery,
    logout,
  };
}
