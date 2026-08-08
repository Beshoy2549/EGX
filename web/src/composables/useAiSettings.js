import { computed, reactive, watch } from "vue";

const STORAGE_KEY = "egx-ai-settings";

const DEFAULTS = {
  provider: "cursor", // "cursor" | "openai"
  cursorKey: "",
  openaiKey: "",
  openaiModel: "gpt-4o-mini",
};

// Reversible obfuscation for keys at rest — this is NOT real security (the XOR
// secret lives in client source), it only avoids storing keys as plaintext.
const ENC_PREFIX = "enc:v1:";
const XOR_SECRET = "egx-ai-settings-2026";

function xorCode(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode(str.charCodeAt(i) ^ XOR_SECRET.charCodeAt(i % XOR_SECRET.length));
  }
  return out;
}

function encodeKey(plain) {
  if (!plain) return "";
  // encodeURIComponent + unescape keeps btoa unicode-safe.
  return ENC_PREFIX + btoa(unescape(encodeURIComponent(xorCode(plain))));
}

function decodeKey(stored) {
  if (!stored) return "";
  if (!stored.startsWith(ENC_PREFIX)) return stored; // migrate old plaintext
  try {
    return xorCode(decodeURIComponent(escape(atob(stored.slice(ENC_PREFIX.length)))));
  } catch {
    return "";
  }
}

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
    // Keys are stored obfuscated — decode into plaintext for in-memory use.
    merged.cursorKey = decodeKey(merged.cursorKey);
    merged.openaiKey = decodeKey(merged.openaiKey);
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

// Module-level singleton so every component shares (and reacts to) the same
// settings, and the values are cached in localStorage across reloads.
const state = reactive(loadInitial());

watch(
  () => ({ ...state }),
  (value) => {
    try {
      // Persist keys obfuscated, everything else as-is.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...value,
          cursorKey: encodeKey(value.cursorKey),
          openaiKey: encodeKey(value.openaiKey),
        })
      );
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  },
  { deep: true }
);

export function useAiSettings() {
  const provider = computed(() => state.provider);

  const activeKey = computed(() =>
    state.provider === "openai" ? state.openaiKey.trim() : state.cursorKey.trim()
  );

  // Whether the selected provider has a usable key on the client. Cursor can
  // still fall back to a server-side .env key, so it's considered "ready".
  const isConfigured = computed(() =>
    state.provider === "openai" ? Boolean(state.openaiKey.trim()) : true
  );

  /** Headers to attach to every AI request so the server uses the chosen provider. */
  function aiHeaders() {
    const headers = { "x-ai-provider": state.provider };
    if (state.provider === "openai") {
      if (state.openaiKey.trim()) headers["x-ai-key"] = state.openaiKey.trim();
      if (state.openaiModel.trim()) headers["x-ai-model"] = state.openaiModel.trim();
    } else if (state.cursorKey.trim()) {
      headers["x-ai-key"] = state.cursorKey.trim();
    }
    return headers;
  }

  function setProvider(next) {
    state.provider = next === "openai" ? "openai" : "cursor";
  }

  function clearKeys() {
    state.cursorKey = "";
    state.openaiKey = "";
  }

  return { state, provider, activeKey, isConfigured, aiHeaders, setProvider, clearKeys };
}
