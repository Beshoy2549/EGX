<script setup>
import { computed, watch } from "vue";
import { useRoute, RouterLink, RouterView } from "vue-router";
import { useI18n } from "./composables/useI18n.js";
import AiSettings from "./components/AiSettings.vue";

const { lang, t, setLang } = useI18n();
const route = useRoute();

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
      <div class="top-actions">
        <div class="lang-toggle" role="group" aria-label="Language">
          <button type="button" :class="{ active: lang === 'ar' }" @click="setLang('ar')">
            عربي
          </button>
          <button type="button" :class="{ active: lang === 'en' }" @click="setLang('en')">
            English
          </button>
        </div>
        <AiSettings />
      </div>
    </div>

    <nav class="main-nav" aria-label="Main">
      <RouterLink
        class="nav-link"
        :class="{ active: route.name === 'home' }"
        :to="{ name: 'home' }"
      >
        {{ t.navHome }}
      </RouterLink>
      <RouterLink
        class="nav-link"
        :class="{ active: route.name === 'scalp' }"
        :to="{ name: 'scalp' }"
      >
        {{ t.navScalp }}
      </RouterLink>
    </nav>

    <RouterView />
  </div>
</template>
