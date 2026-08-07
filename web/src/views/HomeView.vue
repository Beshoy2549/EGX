<script setup>
import AiAssistant from "../components/AiAssistant.vue";
import StockCard from "../components/StockCard.vue";
import { useI18n } from "../composables/useI18n.js";
import { useMarketData } from "../composables/useMarketData.js";

const { lang, t, locale } = useI18n();
const { payload, results, loading, error } = useMarketData({
  poll: true,
  pollMs: 20_000,
});

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale.value);
}
</script>

<template>
  <div>
    <div class="meta">
      <span>{{ t.scraped }}: {{ fmtDateTime(payload.scrapedAt) }}</span>
      <span>{{ results.length }} {{ t.stocks }}</span>
      <span>{{ t.range }}: {{ payload.range || "—" }}</span>
      <span class="live">Vue · {{ t.livePoll }}</span>
      <span v-if="payload.errors?.length" class="err">
        {{ t.failed }}: {{ payload.errors.length }}
      </span>
    </div>

    <AiAssistant :locale="locale" />

    <p v-if="loading" class="empty">{{ t.loading }}</p>
    <p v-else-if="error" class="empty">{{ t.loadError }}: {{ error }}</p>
    <p v-else-if="!results.length" class="empty">{{ t.empty }}</p>

    <div v-else class="grid">
      <StockCard
        v-for="(q, i) in results"
        :key="q.ticker"
        :quote="q"
        :lang="lang"
        :locale="locale"
        :style="{ animationDelay: `${i * 0.04}s` }"
      />
    </div>
  </div>
</template>
