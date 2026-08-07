<script setup>
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../composables/useI18n.js";

const props = defineProps({
  locale: { type: String, default: "ar-EG" },
});

const { lang, t } = useI18n();
const router = useRouter();

const items = ref([]);
const loading = ref(false);
const error = ref(null);
const loadedOnce = ref(false);
const aiByTicker = reactive({});
const aiLoading = reactive({});
const aiError = reactive({});

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
    for (const key of Object.keys(aiByTicker)) delete aiByTicker[key];
    for (const key of Object.keys(aiError)) delete aiError[key];
  } catch (err) {
    error.value = err.message;
    items.value = [];
  } finally {
    loading.value = false;
    loadedOnce.value = true;
  }
}

function openStock(ticker) {
  const code = String(ticker || "").replace(/\.CA$/i, "");
  if (!code) return;
  router.push({ name: "stock", params: { ticker: code } });
}

async function askScalpAi(item, e) {
  e?.stopPropagation?.();
  const ticker = item?.ticker;
  if (!ticker || aiLoading[ticker]) return;
  aiLoading[ticker] = true;
  aiError[ticker] = null;
  try {
    const res = await fetch("/api/suggest-scalp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, lang: lang.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    aiByTicker[ticker] = data.suggestion;
  } catch (err) {
    aiError[ticker] = err.message;
    delete aiByTicker[ticker];
  } finally {
    aiLoading[ticker] = false;
  }
}

onMounted(load);
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
    <p v-else-if="!items.length" class="empty scalp-empty">
      {{ loadedOnce ? t.scalpEmpty : t.scalpIdle }}
    </p>

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

        <div class="scalp-ai" @click.stop>
          <button
            type="button"
            class="ai-btn scalp-ai-btn"
            :disabled="aiLoading[item.ticker]"
            @click="askScalpAi(item, $event)"
          >
            {{ aiLoading[item.ticker] ? t.aiLoading : t.scalpAiCta }}
          </button>

          <p v-if="aiError[item.ticker]" class="ai-error">
            {{ t.aiError }}: {{ aiError[item.ticker] }}
          </p>

          <div v-if="aiByTicker[item.ticker]" class="scalp-ai-result" :class="aiByTicker[item.ticker].action">
            <div class="ai-action">
              <span class="badge">{{ t.aiAction[aiByTicker[item.ticker].action] || aiByTicker[item.ticker].action }}</span>
              <span class="confidence">
                {{ t.aiConfidence }}: {{ aiByTicker[item.ticker].confidence }}/100
              </span>
            </div>
            <p class="ai-summary">{{ aiByTicker[item.ticker].summary }}</p>
            <div class="scalp-prices ai-prices">
              <div class="scalp-buy">
                <span>{{ t.scalpBuy }}</span>
                <strong>{{ fmt(aiByTicker[item.ticker].buy) }}</strong>
              </div>
              <div class="scalp-sell">
                <span>{{ t.scalpSell }}</span>
                <strong>{{ fmt(aiByTicker[item.ticker].sell) }}</strong>
              </div>
            </div>
            <dl class="pick-levels">
              <div>
                <dt>{{ t.aiStop }}</dt>
                <dd>{{ fmt(aiByTicker[item.ticker].stop) }}</dd>
              </div>
              <div>
                <dt>{{ t.nowPrice }}</dt>
                <dd>{{ fmt(item.price) }}</dd>
              </div>
            </dl>
            <ul v-if="aiByTicker[item.ticker].reasons?.length" class="scalp-ai-reasons">
              <li v-for="(reason, i) in aiByTicker[item.ticker].reasons" :key="i">{{ reason }}</li>
            </ul>
            <dl
              v-if="aiByTicker[item.ticker].considerations"
              class="considerations-grid scalp-considerations"
            >
              <div
                v-for="(text, key) in aiByTicker[item.ticker].considerations"
                :key="key"
              >
                <dt>{{ t.aiConsideration[key] || key }}</dt>
                <dd>{{ text }}</dd>
              </div>
            </dl>
          </div>
        </div>
      </article>
    </div>

    <p class="ai-disclaimer">{{ t.scalpDisclaimer }}</p>
  </section>
</template>
