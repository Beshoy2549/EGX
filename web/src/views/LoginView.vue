<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuth } from "../composables/useAuth.js";
import { useI18n } from "../composables/useI18n.js";

const { t, lang, setLang } = useI18n();
const { login } = useAuth();
const router = useRouter();
const route = useRoute();

const email = ref("");
const password = ref("");
const error = ref(null);
const submitting = ref(false);

function onSubmit() {
  if (submitting.value) return;
  submitting.value = true;
  error.value = null;
  const result = login(email.value, password.value);
  submitting.value = false;
  if (!result.ok) {
    error.value = result.error === "empty" ? t.value.loginEmpty : t.value.loginInvalid;
    return;
  }
  const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/";
  router.replace(redirect.startsWith("/") ? redirect : "/");
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">EGX</div>
      <h1>{{ t.loginTitle }}</h1>
      <p class="login-lede">{{ t.loginLede }}</p>

      <form class="login-form" @submit.prevent="onSubmit">
        <label class="login-field">
          <span>{{ t.loginEmail }}</span>
          <input
            v-model="email"
            type="email"
            autocomplete="username"
            :placeholder="t.loginEmailPh"
            required
          />
        </label>
        <label class="login-field">
          <span>{{ t.loginPassword }}</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            :placeholder="t.loginPasswordPh"
            required
          />
        </label>

        <p v-if="error" class="login-error">{{ error }}</p>

        <button type="submit" class="login-submit" :disabled="submitting">
          {{ t.loginSubmit }}
        </button>
      </form>

      <div class="login-lang" role="group" aria-label="Language">
        <button type="button" :class="{ active: lang === 'ar' }" @click="setLang('ar')">عربي</button>
        <button type="button" :class="{ active: lang === 'en' }" @click="setLang('en')">English</button>
      </div>
    </div>
  </div>
</template>
