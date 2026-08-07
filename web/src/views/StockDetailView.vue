<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import CandleChart from "../components/CandleChart.vue";
import { useI18n } from "../composables/useI18n.js";
import { useMarketData } from "../composables/useMarketData.js";

const props = defineProps({
  ticker: { type: String, required: true },
});

const router = useRouter();
const { lang, t, locale } = useI18n();
const { payload, loading, error, findByTicker } = useMarketData();

const suggesting = ref(false);
const suggestError = ref(null);
const suggestion = ref(null);

const quote = computed(() => findByTicker(props.ticker));

const name = computed(() => {
  if (!quote.value) return "";
  return lang.value === "ar"
    ? quote.value.nameAr || quote.value.name || quote.value.nameEn || ""
    : quote.value.nameEn || quote.value.name || quote.value.nameAr || "";
});

const up = computed(() => (quote.value?.changePercent ?? 0) >= 0);

const actionLabel = computed(() => {
  const action = suggestion.value?.action;
  if (!action) return "";
  return t.value.aiAction[action] || action;
});

watch(
  () => props.ticker,
  () => {
    suggestion.value = null;
    suggestError.value = null;
  }
);

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(locale.value, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale.value);
}

function goBack() {
  router.push({ name: "home" });
}

async function askAi() {
  if (!quote.value || suggesting.value) return;
  suggesting.value = true;
  suggestError.value = null;
  try {
    const res = await fetch("/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: quote.value.ticker, lang: lang.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    suggestion.value = data.suggestion;
  } catch (err) {
    suggestError.value = err.message;
    suggestion.value = null;
  } finally {
    suggesting.value = false;
  }
}
</script>

<template>
  <div class="detail">
    <button type="button" class="back" @click="goBack">{{ t.back }}</button>

    <p v-if="loading" class="empty">{{ t.loading }}</p>
    <p v-else-if="error" class="empty">{{ t.loadError }}: {{ error }}</p>
    <p v-else-if="!quote" class="empty">{{ t.stockMissing }}</p>

    <template v-else>
      <section class="detail-hero">
        <div class="detail-identity">
          <div class="sym">{{ quote.ticker.replace(".CA", "") }}</div>
          <h1>{{ name }}</h1>
          <p class="detail-meta">
            {{ quote.exchange || "EGX" }} · {{ t.asOf }} {{ fmtDateTime(quote.asOf) }}
          </p>
        </div>

        <div class="detail-price-block">
          <div class="price">{{ fmt(quote.price) }} {{ quote.currency || "EGP" }}</div>
          <div class="chg" :class="up ? 'up' : 'down'">
            <template v-if="quote.change == null">—</template>
            <template v-else>
              {{ quote.change >= 0 ? "+" : "" }}{{ fmt(quote.change) }}
              ·
              {{ quote.changePercent >= 0 ? "+" : "" }}{{ fmt(quote.changePercent) }}%
            </template>
          </div>
          <dl class="stats">
            <div>
              <dt>{{ t.prevClose }}</dt>
              <dd>{{ fmt(quote.previousClose) }}</dd>
            </div>
            <div>
              <dt>{{ t.range }}</dt>
              <dd>{{ payload.range || "—" }}</dd>
            </div>
            <div>
              <dt>{{ t.scraped }}</dt>
              <dd>{{ fmtDateTime(payload.scrapedAt) }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section class="ai-panel">
        <div class="ai-head">
          <div>
            <h2>{{ t.aiTitle }}</h2>
            <p>{{ t.aiLede }}</p>
          </div>
          <button
            type="button"
            class="ai-btn"
            :disabled="suggesting"
            @click="askAi"
          >
            {{ suggesting ? t.aiLoading : t.aiCta }}
          </button>
        </div>

        <p v-if="suggestError" class="ai-error">{{ t.aiError }}: {{ suggestError }}</p>

        <div
          v-if="suggestion"
          class="ai-result"
          :class="suggestion.action"
        >
          <div class="ai-action">
            <span class="badge">{{ actionLabel }}</span>
            <span class="confidence">{{ t.aiConfidence }}: {{ suggestion.confidence }}%</span>
          </div>
          <p class="ai-summary">{{ suggestion.summary }}</p>
          <ul v-if="suggestion.reasons?.length">
            <li v-for="(reason, i) in suggestion.reasons" :key="i">{{ reason }}</li>
          </ul>
          <p class="ai-disclaimer">{{ t.aiDisclaimer }}</p>
        </div>
      </section>

      <CandleChart
        :quote="quote"
        :lang="lang"
        :locale="locale"
        :as-of-label="t.asOf"
        :hover-label="t.hover"
        :hint="t.hint(payload.range || '3mo')"
      />
    </template>
  </div>
</template>
