<script setup>
import { computed, watch } from "vue";
import { RouterView } from "vue-router";
import { useI18n } from "./composables/useI18n.js";

const { lang, t, setLang } = useI18n();

watch(
  lang,
  () => {
    document.documentElement.lang = lang.value;
    document.documentElement.dir = lang.value === "ar" ? "rtl" : "ltr";
    document.title = t.value.title;
  },
  { immediate: true }
);

const brandTo = computed(() => ({ name: "home" }));
</script>

<template>
  <div class="wrap">
    <div class="topbar">
      <header>
        <RouterLink class="brand" :to="brandTo">EGX</RouterLink>
        <p class="lede">{{ t.lede }}</p>
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

    <RouterView />
  </div>
</template>
