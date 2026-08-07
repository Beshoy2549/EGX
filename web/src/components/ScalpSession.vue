<script setup>
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../composables/useI18n.js";

const props = defineProps({
  locale: { type: String, default: "ar-EG" },
  scrapedAt: { type: String, default: null },
});

const { lang, t } = useI18n();
const router = useRouter();

const items = ref([]);
const loading = ref(false);
const error = ref(null);

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(props.locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/scan?type=scalp&limit=8");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    items.value = data.items || [];
  } catch (err) {
    error.value = err.message;
    items.value = [];
  } finally {
    loading.value = false;
  }
}

function openStock(ticker) {
  const code = String(ticker || "").replace(/\.CA$/i, "");
  if (!code) return;
  router.push({ name: "stock", params: { ticker: code } });
}

onMounted(load);
watch(() => props.scrapedAt, load);
</script>

<template>
  <section class="scalp-section">
    <div class="scalp-head">
      <div>
        <h2>{{ t.scalpTitle }}</h2>
        <p>{{ t.scalpLede }}</p>
      </div>
      <button type="button" class="chip" :disabled="loading" @click="load">
        {{ loading ? t.loading : t.scalpRefresh }}
      </button>
    </div>

    <p v-if="loading && !items.length" class="ai-status">{{ t.loading }}</p>
    <p v-else-if="error" class="ai-error">{{ t.aiError }}: {{ error }}</p>
    <p v-else-if="!items.length" class="empty scalp-empty">{{ t.scalpEmpty }}</p>

    <div v-else class="pick-grid scalp-grid">
      <article
        v-for="item in items"
        :key="item.ticker"
        class="pick-card scalp-card"
        @click="openStock(item.ticker)"
      >
        <div class="pick-top">
          <strong>{{ item.ticker.replace(".CA", "") }}</strong>
          <span class="badge">{{ t.scalpBadge }}</span>
          <span class="conf">{{ item.scalp?.score ?? item.score }}/100</span>
        </div>
        <p class="pick-name">{{ lang === "ar" ? item.nameAr : item.nameEn }}</p>
        <p class="pick-reason">
          {{ (item.scalp?.reasons || item.reasons || []).slice(0, 2).join(" · ") }}
        </p>

        <div class="scalp-prices">
          <div class="scalp-buy">
            <span>{{ t.scalpBuy }}</span>
            <strong>{{ fmt(item.scalp?.buy) }}</strong>
          </div>
          <div class="scalp-sell">
            <span>{{ t.scalpSell }}</span>
            <strong>{{ fmt(item.scalp?.sell) }}</strong>
          </div>
        </div>

        <dl class="pick-levels">
          <div>
            <dt>{{ t.aiStop }}</dt>
            <dd>{{ fmt(item.scalp?.stop) }}</dd>
          </div>
          <div>
            <dt>{{ t.nowPrice }}</dt>
            <dd>{{ fmt(item.price) }}</dd>
          </div>
          <div>
            <dt>Vol</dt>
            <dd>{{ fmt(item.indicators?.volumeRatio, 1) }}×</dd>
          </div>
          <div>
            <dt>RSI</dt>
            <dd>{{ fmt(item.indicators?.rsi, 1) }}</dd>
          </div>
        </dl>
      </article>
    </div>

    <p class="ai-disclaimer">{{ t.scalpDisclaimer }}</p>
  </section>
</template>
