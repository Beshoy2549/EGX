<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import StockCard from "./components/StockCard.vue";
import CandleChart from "./components/CandleChart.vue";
import { useI18n } from "./composables/useI18n.js";

const POLL_MS = 5000;
const { lang, t, setLang, locale } = useI18n();

const payload = ref({ results: [], errors: [], scrapedAt: null, range: null });
const active = ref(0);
const loading = ref(true);
const error = ref(null);
let timer = null;

const results = computed(() => payload.value.results || []);
const activeQuote = computed(() => results.value[active.value] || null);

async function load() {
  try {
    const res = await fetch(`/latest.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload.value = await res.json();
    if (active.value >= (payload.value.results?.length || 0)) active.value = 0;
    error.value = null;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function fmt(n, d = 2) {
  return Number(n).toLocaleString(locale.value, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale.value);
}

onMounted(() => {
  load();
  timer = setInterval(load, POLL_MS);
});
onUnmounted(() => clearInterval(timer));

watch(
  lang,
  () => {
    document.documentElement.lang = lang.value;
    document.documentElement.dir = lang.value === "ar" ? "rtl" : "ltr";
    document.title = t.value.title;
  },
  { immediate: true }
);
</script>

<template>
  <div class="wrap">
    <div class="topbar">
      <header>
        <div class="brand">EGX</div>
        <p class="lede">{{ t.lede }}</p>
        <div class="meta">
          <span>{{ t.scraped }}: {{ fmtDateTime(payload.scrapedAt) }}</span>
          <span>{{ results.length }} {{ t.stocks }}</span>
          <span>{{ t.range }}: {{ payload.range || "—" }}</span>
          <span class="live">Vue · {{ t.livePoll }}</span>
          <span v-if="payload.errors?.length" class="err">
            {{ t.failed }}: {{ payload.errors.length }}
          </span>
        </div>
      </header>
      <div class="lang-toggle" role="group" aria-label="Language">
        <button type="button" :class="{ active: lang === 'ar' }" @click="setLang('ar')">
          عربي
        </button>
        <button type="button" :class="{ active: lang === 'en' }" @click="setLang('en')">
          English
        </button>
      </div>
    </div>

    <p v-if="loading" class="empty">{{ t.loading }}</p>
    <p v-else-if="error" class="empty">{{ t.loadError }}: {{ error }}</p>
    <p v-else-if="!results.length" class="empty">{{ t.empty }}</p>

    <template v-else>
      <div class="grid">
        <StockCard
          v-for="(q, i) in results"
          :key="q.ticker"
          :quote="q"
          :active="i === active"
          :lang="lang"
          :locale="locale"
          :style="{ animationDelay: `${i * 0.04}s` }"
          @select="active = i"
        />
      </div>

      <CandleChart
        v-if="activeQuote"
        :quote="activeQuote"
        :lang="lang"
        :locale="locale"
        :as-of-label="t.asOf"
        :hover-label="t.hover"
        :hint="t.hint(payload.range || '3mo')"
      />
    </template>
  </div>
</template>
