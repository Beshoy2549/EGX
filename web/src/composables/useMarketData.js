import { computed, onMounted, onUnmounted, ref } from "vue";

const POLL_MS = 5000;

export function useMarketData() {
  const payload = ref({ results: [], errors: [], scrapedAt: null, range: null });
  const loading = ref(true);
  const error = ref(null);
  let timer = null;

  const results = computed(() => payload.value.results || []);

  async function load() {
    try {
      const res = await fetch(`/latest.json?t=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      payload.value = await res.json();
      error.value = null;
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  function findByTicker(ticker) {
    const raw = String(ticker || "").toUpperCase();
    const withCa = raw.endsWith(".CA") ? raw : `${raw}.CA`;
    const without = withCa.replace(/\.CA$/, "");
    return (
      results.value.find(
        (q) => q.ticker === withCa || q.ticker === without || q.ticker.replace(/\.CA$/, "") === without
      ) || null
    );
  }

  onMounted(() => {
    load();
    timer = setInterval(load, POLL_MS);
  });

  onUnmounted(() => {
    if (timer) clearInterval(timer);
  });

  return { payload, results, loading, error, load, findByTicker };
}
