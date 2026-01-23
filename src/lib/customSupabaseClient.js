import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://fbngdxhkaueaolnyswgn.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZibmdkeGhrYXVlYW9sbnlzd2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MjQ5MTcsImV4cCI6MjA3OTQwMDkxN30.fm9MKpmmNadMpbPVekIpwyTuyW9cLO9KRyCbJIOQWSM";

// ✅ storage seguro p/ Safari (try/catch + fallback memória)
const memoryStorage = (() => {
  const mem = new Map();
  return {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => {
      mem.set(key, String(value));
    },
    removeItem: (key) => {
      mem.delete(key);
    },
  };
})();

const safeStorage = {
  getItem: (key) => {
    try {
      if (typeof window === "undefined") return memoryStorage.getItem(key);
      return window.localStorage.getItem(key);
    } catch {
      return memoryStorage.getItem(key);
    }
  },
  setItem: (key, value) => {
    try {
      if (typeof window === "undefined") return memoryStorage.setItem(key, value);
      window.localStorage.setItem(key, value);
    } catch {
      memoryStorage.setItem(key, value);
    }
  },
  removeItem: (key) => {
    try {
      if (typeof window === "undefined") return memoryStorage.removeItem(key);
      window.localStorage.removeItem(key);
    } catch {
      memoryStorage.removeItem(key);
    }
  },
};

const customSupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // ✅ mantém sessão persistida (Safari pode falhar, por isso o safeStorage)
    persistSession: true,

    // ✅ renova token automaticamente
    autoRefreshToken: true,

    // ✅ se você usa magic link / oauth com redirect, isso precisa ficar true
    detectSessionInUrl: true,

    // ✅ chave padrão do Supabase
    storageKey: "sb-auth-token",

    // ✅ MUITO importante pro Safari
    storage: safeStorage,
  },
});

export default customSupabaseClient;

export { customSupabaseClient, customSupabaseClient as supabase };
