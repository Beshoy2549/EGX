<script setup>
import { RouterLink } from "vue-router";
import ScalpSession from "../components/ScalpSession.vue";
import { useI18n } from "../composables/useI18n.js";

const { t, locale } = useI18n();
</script>

<template>
  <div class="scalp-page">
    <RouterLink class="back" :to="{ name: 'home' }">{{ t.back }}</RouterLink>
    <ScalpSession :locale="locale" />
  </div>
</template>
