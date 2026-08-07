<script setup>
import { computed } from "vue";

const props = defineProps({
  quote: { type: Object, required: true },
  active: Boolean,
  lang: { type: String, default: "ar" },
  locale: { type: String, default: "ar-EG" },
});

defineEmits(["select"]);

const name = computed(() =>
  props.lang === "ar"
    ? props.quote.nameAr || props.quote.name || props.quote.nameEn || ""
    : props.quote.nameEn || props.quote.name || props.quote.nameAr || ""
);

const up = computed(() => (props.quote.changePercent ?? 0) >= 0);

function fmt(n, d = 2) {
  return Number(n).toLocaleString(props.locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
</script>

<template>
  <button
    type="button"
    class="stock"
    :class="{ active }"
    @click="$emit('select')"
  >
    <div class="sym">{{ quote.ticker.replace(".CA", "") }}</div>
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
