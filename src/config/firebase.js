import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const REQUIRED_KEYS = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

const missingKeys = REQUIRED_KEYS.filter((key) => !firebaseConfig[key]);

export const isFirebaseConfigured = missingKeys.length === 0;

if (typeof window !== "undefined" && !isFirebaseConfigured) {
  console.warn(
    "[firebase] Firebase is NOT fully configured. Missing environment variables: " +
      missingKeys.join(", ") +
      ". Set VITE_FIREBASE_* in your .env file. The app will run in local demo mode.",
  );
}

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
// Explicit region must match deployed function region (us-central1).
// onCall functions handle CORS automatically; frontend MUST use httpsCallable (not fetch)
// to avoid preflight failures against the callable endpoint.
export const functions = app ? getFunctions(app, "us-central1") : null;
export const storage = app ? getStorage(app) : null;
