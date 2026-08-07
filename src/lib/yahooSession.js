/**
 * Yahoo session helper (cookie + crumb) for quoteSummary / quote APIs.
 * Chart v8 does not need this; fundamentals usually do.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let cached = null;
let cachedAt = 0;
const TTL_MS = 15 * 60 * 1000;

function cookieFromResponse(res) {
  const list =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  return list.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}

async function fetchWithTimeout(url, options = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function getYahooSession({ force = false } = {}) {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;

  const headers = { "User-Agent": UA, Accept: "text/html,application/json" };
  let cookie = "";

  for (const url of ["https://fc.yahoo.com", "https://finance.yahoo.com/"]) {
    try {
      const res = await fetchWithTimeout(url, { headers, redirect: "follow" }, 10000);
      const part = cookieFromResponse(res);
      if (part) cookie = cookie ? `${cookie}; ${part}` : part;
    } catch {
      /* ignore */
    }
  }

  const crumbRes = await fetchWithTimeout(
    "https://query2.finance.yahoo.com/v1/test/getcrumb",
    { headers: { ...headers, Cookie: cookie, Accept: "text/plain" } },
    10000
  );
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.startsWith("{") || /too many/i.test(crumb)) {
    throw new Error(`Yahoo crumb failed (${crumbRes.status}): ${crumb.slice(0, 80)}`);
  }

  cached = { cookie, crumb, fetchedAt: new Date().toISOString() };
  cachedAt = Date.now();
  return cached;
}

export function yahooHeaders(session) {
  return {
    "User-Agent": UA,
    Accept: "application/json",
    Cookie: session?.cookie || "",
  };
}

export function clearYahooSession() {
  cached = null;
  cachedAt = 0;
}
