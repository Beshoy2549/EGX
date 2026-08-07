<script setup>
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../composables/useI18n.js";

const props = defineProps({
  locale: { type: String, default: "ar-EG" },
});

const { lang, t } = useI18n();
const router = useRouter();

const question = ref("");
const asking = ref(false);
const scanning = ref(false);
const error = ref(null);
const answer = ref(null);
const scanItems = ref([]);
const activeScan = ref(null);
const messagesEl = ref(null);

const chips = computed(() => [
  { id: "ask5", kind: "ask", label: t.value.aiChipAsk5, question: t.value.aiQAsk5 },
  { id: "scalp", kind: "scan", type: "scalp", label: t.value.aiChipScalp, limit: 8 },
  { id: "top", kind: "scan", type: "top", label: t.value.aiChipTop, limit: 10 },
  { id: "accumulation", kind: "scan", type: "accumulation", label: t.value.aiChipAccum },
  { id: "breakout", kind: "scan", type: "breakout", label: t.value.aiChipBreakout },
  { id: "rsi", kind: "scan", type: "rsi", label: t.value.aiChipRsi },
  { id: "macd", kind: "scan", type: "macd", label: t.value.aiChipMacd },
]);

const isScalpScan = computed(() => activeScan.value === "scalp");

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString(props.locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function actionLabel(action) {
  return t.value.aiAction[action] || action;
}

async function scrollDown() {
  await nextTick();
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
}

async function runAsk(q) {
  const text = String(q || question.value || "").trim();
  if (!text || asking.value) return;
  question.value = text;
  asking.value = true;
  error.value = null;
  activeScan.value = null;
  scanItems.value = [];
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, lang: lang.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    answer.value = data;
    await scrollDown();
  } catch (err) {
    error.value = err.message;
    answer.value = null;
  } finally {
    asking.value = false;
  }
}

async function runScan(type, limit = 10) {
  if (scanning.value) return;
  scanning.value = true;
  error.value = null;
  activeScan.value = type;
  answer.value = null;
  try {
    const res = await fetch(`/api/scan?type=${encodeURIComponent(type)}&limit=${limit}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    scanItems.value = data.items || [];
    await scrollDown();
  } catch (err) {
    error.value = err.message;
    scanItems.value = [];
  } finally {
    scanning.value = false;
  }
}

function onChip(chip) {
  if (chip.kind === "ask") runAsk(chip.question);
  else runScan(chip.type, chip.limit || 10);
}

function onSubmit(e) {
  e.preventDefault();
  runAsk(question.value);
}

function openStock(ticker) {
  const code = String(ticker || "").replace(/\.CA$/i, "");
  if (!code) return;
  router.push({ name: "stock", params: { ticker: code } });
}
</script>

<template>
  <section class="ai-home">
    <div class="ai-home-head">
      <div>
        <h2>{{ t.aiAssistTitle }}</h2>
        <p>{{ t.aiAssistLede }}</p>
      </div>
    </div>

    <div class="ai-chips" role="group">
      <button
        v-for="chip in chips"
        :key="chip.id"
        type="button"
        class="chip"
        :class="{ active: activeScan === chip.type }"
        :disabled="asking || scanning"
        @click="onChip(chip)"
      >
        {{ chip.label }}
      </button>
    </div>

    <form class="ai-ask-form" @submit="onSubmit">
      <input
        v-model="question"
        type="text"
        :placeholder="t.aiPlaceholder"
        :disabled="asking"
        maxlength="800"
        autocomplete="off"
      />
      <button type="submit" class="ai-btn" :disabled="asking || !question.trim()">
        {{ asking ? t.aiLoading : t.aiSend }}
      </button>
    </form>

    <p v-if="error" class="ai-error">{{ t.aiError }}: {{ error }}</p>
    <p v-else-if="asking || scanning" class="ai-status">{{ t.aiLoading }}</p>

    <div ref="messagesEl" class="ai-results">
      <template v-if="answer">
        <p class="ai-answer">{{ answer.answer }}</p>
        <div v-if="answer.picks?.length" class="pick-grid">
          <article
            v-for="pick in answer.picks"
            :key="pick.ticker"
            class="pick-card"
            :class="pick.action"
            @click="openStock(pick.ticker)"
          >
            <div class="pick-top">
              <strong>{{ pick.ticker }}</strong>
              <span class="badge">{{ actionLabel(pick.action) }}</span>
              <span class="conf">{{ pick.confidence }}/100</span>
            </div>
            <p class="pick-reason">{{ pick.reason }}</p>
            <dl class="pick-levels">
              <div><dt>{{ t.aiEntry }}</dt><dd>{{ fmt(pick.entry) }}</dd></div>
              <div><dt>{{ t.aiStop }}</dt><dd>{{ fmt(pick.stopLoss) }}</dd></div>
              <div><dt>{{ t.aiT1 }}</dt><dd>{{ fmt(pick.target1) }}</dd></div>
              <div><dt>{{ t.aiT2 }}</dt><dd>{{ fmt(pick.target2) }}</dd></div>
            </dl>
          </article>
        </div>
        <p v-if="answer.disclaimer" class="ai-disclaimer">{{ answer.disclaimer }}</p>
      </template>

      <template v-else-if="scanItems.length">
        <p class="ai-answer">{{ t.aiScanTitle(activeScan) }}</p>
        <div class="pick-grid">
          <article
            v-for="item in scanItems"
            :key="item.ticker"
            class="pick-card"
            :class="item.score >= 60 ? 'buy' : item.score <= 35 ? 'sell' : 'hold'"
            @click="openStock(item.ticker)"
          >
            <div class="pick-top">
              <strong>{{ item.ticker.replace('.CA', '') }}</strong>
              <span class="conf">{{ item.score }}/100</span>
            </div>
            <p class="pick-name">{{ lang === 'ar' ? item.nameAr : item.nameEn }}</p>
            <p class="pick-reason">{{ item.reasons?.slice(0, 2).join(' · ') }}</p>
            <template v-if="isScalpScan">
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
                <div><dt>{{ t.aiStop }}</dt><dd>{{ fmt(item.scalp?.stop) }}</dd></div>
                <div><dt>{{ t.nowPrice }}</dt><dd>{{ fmt(item.price) }}</dd></div>
                <div><dt>Vol</dt><dd>{{ fmt(item.indicators?.volumeRatio, 1) }}×</dd></div>
                <div><dt>RSI</dt><dd>{{ fmt(item.indicators?.rsi, 1) }}</dd></div>
              </dl>
            </template>
            <template v-else>
              <dl class="pick-levels">
                <div><dt>{{ t.aiEntry }}</dt><dd>{{ fmt(item.trade?.entry) }}</dd></div>
                <div><dt>{{ t.aiStop }}</dt><dd>{{ fmt(item.trade?.stopLoss) }}</dd></div>
                <div><dt>{{ t.aiT1 }}</dt><dd>{{ fmt(item.trade?.target1) }}</dd></div>
                <div><dt>{{ t.aiT2 }}</dt><dd>{{ fmt(item.trade?.target2) }}</dd></div>
              </dl>
              <div class="pick-meta">
                <span>RSI {{ fmt(item.indicators?.rsi, 1) }}</span>
                <span>Vol {{ fmt(item.indicators?.volumeRatio, 1) }}×</span>
                <span>{{ item.indicators?.trend }}</span>
              </div>
            </template>
          </article>
        </div>
        <p class="ai-disclaimer">{{ t.aiDisclaimer }}</p>
      </template>
    </div>
  </section>
</template>
