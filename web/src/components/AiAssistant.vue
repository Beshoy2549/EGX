<script setup>
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../composables/useI18n.js";
import { useAiSettings } from "../composables/useAiSettings.js";
import { apiUrl } from "../lib/api.js";

const props = defineProps({
  locale: { type: String, default: "ar-EG" },
  /** `local` = rules engine only · `ai` = Cursor/OpenAI assistant */
  mode: { type: String, default: "ai" },
});

const { lang, t } = useI18n();
const { aiHeaders } = useAiSettings();
const router = useRouter();

const question = ref("");
const asking = ref(false);
const error = ref(null);
const answer = ref(null);
const answerSource = ref(null);
const activeChip = ref(null);
const messagesEl = ref(null);
const open = ref(true);

const isLocal = computed(() => props.mode === "local");

const title = computed(() =>
  isLocal.value ? t.value.localAssistTitle : t.value.aiAssistTitle
);
const lede = computed(() =>
  isLocal.value ? t.value.localAssistLede : t.value.aiAssistLede
);
const placeholder = computed(() =>
  isLocal.value ? t.value.localPlaceholder : t.value.aiPlaceholder
);

const chips = computed(() => [
  { id: "ask5", kind: "ask", label: t.value.aiChipAsk5, question: t.value.aiQAsk5 },
  { id: "scalp", kind: "nav", label: t.value.aiChipScalp },
  { id: "top", kind: "scan", type: "top", label: t.value.aiChipTop },
  { id: "accumulation", kind: "scan", type: "accumulation", label: t.value.aiChipAccum },
  { id: "breakout", kind: "scan", type: "breakout", label: t.value.aiChipBreakout },
  { id: "rsi", kind: "scan", type: "rsi", label: t.value.aiChipRsi },
  { id: "macd", kind: "scan", type: "macd", label: t.value.aiChipMacd },
]);

const byAi = computed(() => answerSource.value === "agent");

const uniquePicks = computed(() => {
  const seen = new Set();
  const out = [];
  for (const p of answer.value?.picks || []) {
    const key = String(p.ticker || "").toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
});

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
  answerSource.value = null;
  try {
    const headers = {
      "Content-Type": "application/json",
      ...(isLocal.value ? {} : aiHeaders()),
    };
    const res = await fetch(apiUrl("/api/ask"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        question: text,
        lang: lang.value,
        mode: isLocal.value ? "local" : "ai",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    answer.value = data;
    answerSource.value = data.source || null;
    await scrollDown();
  } catch (err) {
    error.value = err.message;
    answer.value = null;
    answerSource.value = null;
  } finally {
    asking.value = false;
  }
}

function onChip(chip) {
  if (chip.kind === "nav") {
    router.push({ name: "scalp" });
    return;
  }
  activeChip.value = chip.id;
  if (chip.kind === "scan") {
    runAsk(t.value.aiQScan(chip.type));
    return;
  }
  runAsk(chip.question);
}

function onSubmit(e) {
  e?.preventDefault?.();
  runAsk(question.value);
}

function openStock(ticker) {
  const code = String(ticker || "").replace(/\.CA$/i, "");
  if (!code) return;
  router.push({ name: "stock", params: { ticker: code } });
}
</script>

<template>
  <section class="ai-home" :class="{ collapsed: !open, local: isLocal, ai: !isLocal }">
    <button
      type="button"
      class="ai-home-head"
      :aria-expanded="open"
      @click="open = !open"
    >
      <div>
        <h2>
          <span class="assist-kind" :class="isLocal ? 'scan' : 'ai'">
            {{ isLocal ? t.aiByScanner : t.aiByAi }}
          </span>
          {{ title }}
        </h2>
        <p>{{ lede }}</p>
      </div>
      <span class="ai-home-chevron" :class="{ open }" aria-hidden="true">▾</span>
    </button>

    <div v-show="open" class="ai-home-body">
      <div class="ai-chips" role="group">
        <button
          v-for="chip in chips"
          :key="chip.id"
          type="button"
          class="chip"
          :class="{ active: activeChip === chip.id }"
          :disabled="asking"
          @click="onChip(chip)"
        >
          {{ chip.label }}
        </button>
      </div>

      <form class="ai-ask-form" @submit="onSubmit">
        <input
          v-model="question"
          type="text"
          class="ai-ask-input"
          :placeholder="placeholder"
          :disabled="asking"
          autocomplete="off"
        />
        <button type="submit" class="ai-btn" :disabled="asking || !question.trim()">
          {{ asking ? t.aiLoading : t.aiSend }}
        </button>
      </form>

      <p v-if="error" class="ai-error">{{ t.aiError }}: {{ error }}</p>
      <p v-else-if="asking" class="ai-status">{{ t.aiLoading }}</p>

      <div ref="messagesEl" class="ai-results">
        <template v-if="answer">
          <div class="ai-source">
            <span class="ai-badge" :class="byAi ? 'ai' : 'scan'">
              {{ byAi ? t.aiByAi : t.aiByScanner }}
            </span>
          </div>
          <p class="ai-answer">{{ answer.answer }}</p>
          <div v-if="uniquePicks.length" class="pick-grid">
            <article
              v-for="pick in uniquePicks"
              :key="pick.ticker"
              class="pick-card"
              :class="pick.action"
              @click="openStock(pick.ticker)"
            >
              <div class="pick-top">
                <strong>{{ pick.ticker }}</strong>
                <span v-if="byAi" class="ai-tag">{{ t.aiTag }}</span>
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
              <p v-if="pick.fundamentals" class="pick-fund">
                {{ t.fPe }} {{ fmt(pick.fundamentals.pe) }}
                · {{ t.fEps }} {{ fmt(pick.fundamentals.eps) }}
              </p>
            </article>
          </div>
          <p v-if="answer.disclaimer" class="ai-disclaimer">{{ answer.disclaimer }}</p>
        </template>
      </div>
    </div>
  </section>
</template>
