<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";

const props = defineProps({
  quote: { type: Object, required: true },
  lang: { type: String, default: "ar" },
  locale: { type: String, default: "ar-EG" },
});

const router = useRouter();

const name = computed(() =>
  props.lang === "ar"
    ? props.quote.nameAr || props.quote.name || props.quote.nameEn || ""
    : props.quote.nameEn || props.quote.name || props.quote.nameAr || ""
);

const up = computed(() => (props.quote.changePercent ?? 0) >= 0);

const shortTicker = computed(() => props.quote.ticker.replace(/\.CA$/i, ""));

function fmt(n, d = 2) {
  return Number(n).toLocaleString(props.locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function openDetails() {
  router.push({ name: "stock", params: { ticker: shortTicker.value } });
}
</script>

<template>
  <button type="button" class="stock" @click="openDetails">
    <div class="sym">{{ shortTicker }}</div>
    <div class="name">{{ name }}</div>
    <div class="price">{{ fmt(quote.price) }} {{ quote.currency || "EGP" }}</div>
    <div class="chg" :class="up ? 'up' : 'down'">
      <template v-if="quote.change == null">—</template>
      <template v-else>
        {{ quote.change >= 0 ? "+" : "" }}{{ fmt(quote.change) }}
        ·
        {{ quote.changePercent >= 0 ? "+" : "" }}{{ fmt(quote.changePercent) }}%
      </template>
    </div>
  </button>
</template>
