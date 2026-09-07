import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  unlink,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "../config/firebase.js";
import { readLocalUser, writeLocalUser } from "../services/localStore.js";
import { signOutLocalUser } from "../services/localStore.js";
import i18n from "../i18n/index.js";
import { getUserFriendlyMessage, isNetworkError } from "../utils/networkErrors.js";

const AuthContext = createContext(null);

const PLACEHOLDER_NAME = "Lock-on Learner";

const FATAL_AUTH_ERRORS = new Set([
  "auth/user-token-expired",
  "auth/invalid-user-token",
  "auth/token-expired",
  "auth/user-disabled",
  "auth/refresh-token-revoked",
]);

function createUserProfile(user, name) {
  return {
    name: name || user.displayName || user.email?.split('@')[0] || PLACEHOLDER_NAME,
    email: user.email,
    username: user.email?.split('@')[0] || "learner",
    bio: "",
    avatarUrl: "",
    avatarIcon: "",
    hasCustomAvatar: false,
    isAdmin: false,
    role: "user",
    xp: 0,
    energy: 0,
    totalScore: 0,
    streak: 0,
    totalStudyHours: 0,
    completedLessons: 0,
    completedTests: [],
    completedUnits: [],
    lastTestAttempt: null,
    goals: "",
    grade: "",
    curriculum: "",
    favoriteSubjects: [],
    theme: "system",
    preferredLanguage: "en",
    activity: {},
    onboardingCompleted: false,
    referralSource: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function ensureUserDocument(user, name) {
  if (!db) return false;

  const userPath = `users/${user?.uid}`;

  try {
    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      await setDoc(userRef, createUserProfile(user, name));
      return true;
    }

    const data = snapshot.data();
    const patch = {};

    if (!data.name) patch.name = name || user.displayName || user.email?.split('@')[0] || PLACEHOLDER_NAME;
    if (!data.email) patch.email = user.email;
    if (!data.username) patch.username = user.email?.split('@')[0] || "learner";

    if (data.role === "admin" && data.isAdmin !== true) {
      patch.isAdmin = true;
    }

    if (data.name === PLACEHOLDER_NAME && data.onboardingCompleted === undefined) {
      patch.onboardingCompleted = false;
    }

    if (typeof data.xp !== "number") patch.xp = 0;
    if (typeof data.energy !== "number") patch.energy = 0;
    if (typeof data.streak !== "number") patch.streak = 0;
    if (typeof data.currentStreak !== "number") patch.currentStreak = data.streak || 0;
    if (typeof data.bestStreak !== "number") patch.bestStreak = data.streak || 0;
    if (typeof data.lastCompletedDate !== "string" && !(data.lastCompletedDate && typeof data.lastCompletedDate.toDate === "function")) patch.lastCompletedDate = null;
    if (typeof data.totalStudyHours !== "number") patch.totalStudyHours = 0;
    if (typeof data.completedLessons !== "number") patch.completedLessons = 0;
    const expectedTotal = (data.xp || 0) + (data.energy || 0) * 100;
    if (typeof data.totalScore !== "number" || data.totalScore !== expectedTotal) patch.totalScore = expectedTotal;

    if (!Array.isArray(data.completedTests)) patch.completedTests = [];
    if (!Array.isArray(data.completedUnits)) patch.completedUnits = [];
    if (!Array.isArray(data.favoriteSubjects)) patch.favoriteSubjects = [];
    if (typeof data.activity !== "object" || data.activity === null) patch.activity = {};
    if (!("lastTestAttempt" in data)) patch.lastTestAttempt = null;

    if (data.bio === undefined) patch.bio = "";
    if (data.goals === undefined) patch.goals = "";
    if (data.grade === undefined) patch.grade = "";
    if (data.curriculum === undefined) patch.curriculum = "";
    if (data.theme === undefined) patch.theme = "system";
    if (data.preferredLanguage === undefined) patch.preferredLanguage = "en";
    if (data.avatarUrl === undefined) patch.avatarUrl = "";
    if (data.avatarIcon === undefined) patch.avatarIcon = "";
    if (data.hasCustomAvatar === undefined) patch.hasCustomAvatar = false;

    if (data.onboardingCompleted === undefined) patch.onboardingCompleted = false;
    if (data.referralSource === undefined) patch.referralSource = "";

    if (Object.keys(patch).length) {
      patch.updatedAt = serverTimestamp();
      await setDoc(userRef, patch, { merge: true });
    }

    return true;
  } catch (error) {
    const friendly = getUserFriendlyMessage(error, "loading your profile");
    console.error(
      "[AuthContext] Firestore operation failed while ensuring the user document.",
      {
        uid: user?.uid,
        path: userPath,
        code: error?.code,
        message: error?.message ?? String(error),
        friendly,
        isNetwork: isNetworkError(error),
      },
    );
    return false;
  }
}

function buildGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      const localUser = readLocalUser();
      if (localUser && localUser.uid) {
        const defaultProfile = {
          uid: localUser.uid,
          name: localUser.name || "Local learner",
          email: localUser.email || "local@example.com",
          username: localUser.email?.split('@')[0] || "locallearner",
          bio: localUser.bio || "",
          avatarUrl: localUser.avatarUrl || "",
          avatarIcon: localUser.avatarIcon || "",
          hasCustomAvatar: localUser.hasCustomAvatar ?? false,
          isAdmin: localUser.isAdmin ?? false,
          xp: typeof localUser.xp === "number" ? localUser.xp : 120,
          energy: typeof localUser.energy === "number" ? localUser.energy : 85,
          totalScore: typeof localUser.totalScore === "number" ? localUser.totalScore : 12000,
          streak: typeof localUser.streak === "number" ? localUser.streak : 5,
          totalStudyHours: typeof localUser.totalStudyHours === "number" ? localUser.totalStudyHours : 8,
          completedLessons: Array.isArray(localUser.completedLessons) ? localUser.completedLessons : 14,
          completedTests: Array.isArray(localUser.completedTests) ? localUser.completedTests : [],
          completedUnits: Array.isArray(localUser.completedUnits) ? localUser.completedUnits : [],
          lastTestAttempt: localUser.lastTestAttempt || null,
          goals: localUser.goals || "Stay consistent",
          grade: localUser.grade || "11",
          curriculum: localUser.curriculum || "GCSE",
          favoriteSubjects: Array.isArray(localUser.favoriteSubjects) ? localUser.favoriteSubjects : ["Maths", "Science"],
          theme: localUser.theme || "system",
          activity: typeof localUser.activity === "object" && localUser.activity !== null ? localUser.activity : {},
          onboardingCompleted: localUser.onboardingCompleted ?? true,
          referralSource: localUser.referralSource || "local-demo",
          createdAt: localUser.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setProfile(defaultProfile);
        setUser({ uid: defaultProfile.uid, email: defaultProfile.email, displayName: defaultProfile.name });
        setLoading(false);
        return undefined;
      }

      const demoProfile = {
        uid: "local-demo-user",
        name: "Local learner",
        email: "local@example.com",
        username: "locallearner",
        bio: "",
        avatarUrl: "",
        avatarIcon: "",
        hasCustomAvatar: false,
        isAdmin: false,
        xp: 120,
        energy: 85,
        totalScore: 12000,
        streak: 5,
        totalStudyHours: 8,
        completedLessons: 14,
        completedTests: [],
        completedUnits: [],
        lastTestAttempt: null,
        goals: "Stay consistent",
        grade: "11",
        curriculum: "GCSE",
        favoriteSubjects: ["Maths", "Science"],
        theme: "system",
        activity: {},
        onboardingCompleted: true,
        referralSource: "local-demo",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeLocalUser(demoProfile);
      setProfile(demoProfile);
      setUser({ uid: demoProfile.uid, email: demoProfile.email, displayName: demoProfile.name });
      setLoading(false);
      return undefined;
    }

    return onAuthStateChanged(
      auth,
      async (firebaseUser) => {
        setAuthError("");
        setUser(firebaseUser);
        if (firebaseUser) {
          const ok = await ensureUserDocument(firebaseUser);
          if (!ok) {
            setProfileError(getUserFriendlyMessage({ code: "unavailable", message: "Could not load your profile." }, "loading your profile"));
          } else {
            setProfileError("");
          }
        } else {
          setProfile(null);
          setProfileError("");
        }
        setLoading(false);
      },
      (authErr) => {
        const friendly = getUserFriendlyMessage(authErr, "checking auth");
        console.error(
          "[AuthContext] Firebase Auth observer reported an error.",
          { code: authErr?.code, message: authErr?.message ?? String(authErr), friendly },
        );
        setAuthError(friendly);
        if (authErr?.code && FATAL_AUTH_ERRORS.has(authErr.code)) {
          signOutLocalUser();
          setUser(null);
          setProfile(null);
          auth.signOut().catch(() => {});
        }
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    if (!profile?.theme) return;
    const root = document.documentElement;
    if (profile.theme === "dark") {
      root.classList.add("dark");
    } else if (profile.theme === "light") {
      root.classList.remove("dark");
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.toggle("dark", prefersDark);
    }
  }, [profile?.theme]);

  useEffect(() => {
    if (profile?.preferredLanguage) {
      i18n.changeLanguage(profile.preferredLanguage);
    }
  }, [profile?.preferredLanguage]);

  useEffect(() => {
    if (!user || !db || loading) return undefined;
    // Clear previous error on uid change
    setProfileError("");
    const userPath = `users/${user.uid}`;
    return onSnapshot(
      doc(db, "users", user.uid),
      (snapshot) => {
        setProfileError("");
        setProfile(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (snapshotError) => {
        const friendly = getUserFriendlyMessage(snapshotError, "syncing your profile");
        console.error(
          "[AuthContext] Firestore user profile subscription failed.",
          {
            uid: user.uid,
            path: userPath,
            code: snapshotError?.code,
            message: snapshotError?.message ?? String(snapshotError),
            friendly,
            isNetwork: isNetworkError(snapshotError),
          },
        );
        setProfileError(friendly);
      },
    );
  }, [user, loading]);

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      isFirebaseConfigured,
      profileError,
      authError,
      linkedProviders: user?.providerData?.map((p) => p.providerId) || [],
      isGoogleLinked: !!user?.providerData?.some((p) => p.providerId === GoogleAuthProvider.PROVIDER_ID),
      hasPasswordProvider: !!user?.providerData?.some((p) => p.providerId === "password"),
      async login(email, password) {
        if (!auth || !isFirebaseConfigured) {
          const demoProfile = {
            uid: "local-demo-user",
            name: email?.split("@")[0] || "Local learner",
            email,
            username: email?.split("@")[0] || "locallearner",
            bio: "",
            avatarUrl: "",
            avatarIcon: "",
            hasCustomAvatar: false,
            isAdmin: false,
            xp: 120,
            energy: 85,
            totalScore: 12000,
            streak: 5,
            totalStudyHours: 8,
            completedLessons: 14,
            completedTests: [],
            completedUnits: [],
            lastTestAttempt: null,
            goals: "Stay consistent",
            grade: "11",
            curriculum: "GCSE",
            favoriteSubjects: ["Maths", "Science"],
            theme: "system",
            activity: {},
            onboardingCompleted: true,
            referralSource: "local-demo",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          writeLocalUser(demoProfile);
          setProfile(demoProfile);
          setUser({ uid: demoProfile.uid, email: demoProfile.email, displayName: demoProfile.name });
          return;
        }
        await signInWithEmailAndPassword(auth, email, password);
      },
      async register(name, email, password) {
        if (!auth || !isFirebaseConfigured) {
          const demoProfile = {
            uid: "local-demo-user",
            name: name || email?.split("@")[0] || "Local learner",
            email,
            username: email?.split("@")[0] || "locallearner",
            bio: "",
            avatarUrl: "",
            avatarIcon: "",
            hasCustomAvatar: false,
            isAdmin: false,
            xp: 120,
            energy: 85,
            totalScore: 12000,
            streak: 5,
            totalStudyHours: 8,
            completedLessons: 14,
            completedTests: [],
            completedUnits: [],
            lastTestAttempt: null,
            goals: "Stay consistent",
            grade: "11",
            curriculum: "GCSE",
            favoriteSubjects: ["Maths", "Science"],
            theme: "system",
            activity: {},
            onboardingCompleted: true,
            referralSource: "local-demo",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          writeLocalUser(demoProfile);
          setProfile(demoProfile);
          setUser({ uid: demoProfile.uid, email: demoProfile.email, displayName: demoProfile.name });
          return;
        }
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName: name });
        await ensureUserDocument(result.user, name);
      },
      async signInWithGoogle() {
        if (!auth || !isFirebaseConfigured) {
          throw new Error("Google Sign-In is not available in local demo mode. Configure Firebase.");
        }
        const provider = buildGoogleProvider();
        try {
          const result = await signInWithPopup(auth, provider);
          await ensureUserDocument(result.user);
          return result;
        } catch (error) {
          // Firebase best-practice: account-exists-with-different-credential
          if (error?.code === "auth/account-exists-with-different-credential") {
            const pendingCred = GoogleAuthProvider.credentialFromError(error);
            const email = error?.customData?.email || error?.email || "";
            // Surface to caller so it can prompt for password and link
            const linkError = new Error(
              "An account already exists with this email. Please sign in with your password to link Google."
            );
            linkError.code = "auth/account-exists-with-different-credential";
            linkError.email = email;
            linkError.credential = pendingCred;
            // Also help caller know methods
            try {
              if (email) {
                const methods = await fetchSignInMethodsForEmail(auth, email);
                linkError.methods = methods;
              }
            } catch {}
            throw linkError;
          }
          // Popup blocked / closed etc – surface friendly message
          if (error?.code === "auth/popup-blocked" || error?.code === "auth/popup-closed-by-user" || error?.code === "auth/cancelled-popup-request") {
            throw error;
          }
          // Network – give friendly hint
          if (isNetworkError(error)) {
            const friendly = getUserFriendlyMessage(error, "Google Sign-In");
            const e = new Error(friendly);
            e.code = error.code;
            e.cause = error;
            throw e;
          }
          throw error;
        }
      },
      async completeGoogleLinkWithPassword(email, password, pendingCredential) {
        // Firebase best-practice: sign into existing account first, then linkWithCredential()
        if (!auth || !isFirebaseConfigured) throw new Error("Firebase not configured.");
        // pendingCredential may be OAuthCredential from GoogleAuthProvider.credentialFromError
        let credential = pendingCredential;
        if (!credential) throw new Error("Missing Google credential. Please retry Google sign-in.");
        // Sign in with password (existing account) – preserves UID / Firestore doc
        const userCred = await signInWithEmailAndPassword(auth, email, password);
        // Link Google provider – same UID, no second Firestore doc
        await linkWithCredential(userCred.user, credential);
        await ensureUserDocument(userCred.user);
        return userCred;
      },
      async linkGoogleAccount() {
        if (!auth?.currentUser) throw new Error("Not authenticated.");
        const provider = buildGoogleProvider();
        try {
          // Firebase best-practice for linking while signed in: linkWithPopup preserves UID + all Firestore data
          const result = await linkWithPopup(auth.currentUser, provider);
          await ensureUserDocument(result.user);
          return result;
        } catch (error) {
          if (error?.code === "auth/credential-already-in-use" || error?.code === "auth/provider-already-linked") {
            throw new Error("This Google account is already linked to another user.");
          }
          if (isNetworkError(error)) {
            throw new Error(getUserFriendlyMessage(error, "linking Google"));
          }
          throw error;
        }
      },
      async linkGoogleWithCredential(googleCredential) {
        if (!auth?.currentUser) throw new Error("Not authenticated.");
        await linkWithCredential(auth.currentUser, googleCredential);
        await ensureUserDocument(auth.currentUser);
      },
      async unlinkGoogleAccount() {
        if (!auth?.currentUser) throw new Error("Not authenticated.");
        const providers = auth.currentUser.providerData.map((p) => p.providerId);
        if (!providers.includes(GoogleAuthProvider.PROVIDER_ID)) {
          throw new Error("Google is not linked.");
        }
        if (providers.length < 2) {
          throw new Error("Cannot unlink Google: it is your only sign-in method. Add a password first.");
        }
        await unlink(auth.currentUser, GoogleAuthProvider.PROVIDER_ID);
      },
      async reauthenticateWithPassword(password) {
        if (!auth?.currentUser?.email) throw new Error("Not authenticated.");
        const cred = EmailAuthProvider.credential(auth.currentUser.email, password);
        await reauthenticateWithCredential(auth.currentUser, cred);
      },
      async resetPassword(email) {
        if (!auth || !isFirebaseConfigured) {
          return;
        }
        await sendPasswordResetEmail(auth, email);
      },
      async changePassword(newPassword) {
        if (!auth || !auth.currentUser) throw new Error("Not authenticated.");
        await updatePassword(auth.currentUser, newPassword);
      },
      logout: () => {
        signOutLocalUser();
        setProfile(null);
        setUser(null);
        return auth && isFirebaseConfigured ? signOut(auth).catch(() => {}) : undefined;
      },
    }),
    [loading, profile, user, profileError, authError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
