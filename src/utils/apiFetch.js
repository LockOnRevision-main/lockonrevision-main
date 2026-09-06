import { auth } from "../config/firebase.js";

const LOCAL_API_BASES = ["http://127.0.0.1:3000", "http://localhost:3000"];
const VERCEL_API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

function resolveUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/")) {
    if (import.meta.env.DEV) {
      return `${LOCAL_API_BASES[0]}${url}`;
    }
    return `${VERCEL_API_BASE}${url.replace("/api", "")}`;
  }
  return url;
}

export async function apiFetch(url, options = {}) {
  const headers = { ...options.headers };
  if (!headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  // Ensure Firebase auth is ready before attempting to attach token – prevents race where currentUser is null on page reload
  // Mirrors working Forge endpoints (identical implementation)
  if (auth) {
    try {
      // Wait for auth state to be ready (no-op if already ready) – avoids missing Bearer on first call after refresh
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }
      const current = auth.currentUser;
      if (current) {
        const token = await current.getIdToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      } else if (!headers["Authorization"]) {
        // No user yet – still proceed; server will return 401 with clear message (not 500)
        console.warn(`[apiFetch] No Firebase user for ${url} – request will be unauthenticated`);
      }
    } catch (e) {
      console.warn(`[apiFetch] Failed to get ID token for ${url}`, e?.message);
    }
  }
  const response = await fetch(resolveUrl(url), { ...options, headers });
  return response;
}
