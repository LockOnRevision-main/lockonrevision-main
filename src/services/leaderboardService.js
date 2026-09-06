import { calculateTotalScore } from "./userService.js";
import { db, isFirebaseConfigured } from "../config/firebase.js";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { subscribeLocalState } from "./localStore.js";
import { onLessonCompleted, onSessionCompleted, onScoreChanged } from "./forgeEvents.js";

const PAGE_SIZE = 20;

const ADMIN_FIELDS = new Set(["isAdmin", "role"]);

function stripAdminFields(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const cleaned = { ...obj };
  for (const key of ADMIN_FIELDS) delete cleaned[key];
  return cleaned;
}

function calcTotal(user) {
  const score = Number(user.totalScore);
  if (Number.isFinite(score) && score !== 0) return score;
  return calculateTotalScore(user);
}

export function applyCompetitionRanking(users) {
  // 1) Deduplicate by UID/id — one row per UID (keep highest _score if duplicate docs)
  const deduped = new Map();
  for (const user of users || []) {
    const uid = user?.id || user?.uid;
    if (!uid) continue;
    const scoredUser = { ...user, _score: calcTotal(user) };
    const existing = deduped.get(uid);
    if (!existing || scoredUser._score > existing._score) {
      deduped.set(uid, scoredUser);
    }
  }

  const scored = Array.from(deduped.values()).sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    const nameA = (a.name || a.displayName || a.username || "").toLowerCase();
    const nameB = (b.name || b.displayName || b.username || "").toLowerCase();
    const nameCmp = nameA.localeCompare(nameB);
    if (nameCmp !== 0) return nameCmp;
    // Final deterministic tie-breaker
    return String(a.id || a.uid || "").localeCompare(String(b.id || b.uid || ""));
  });

  // 2) Sequential ranking AFTER sorting — guarantees continuous 1..N, no gaps/undefined
  const ranked = scored.map((user, index) => ({ ...user, _rank: index + 1 }));

  // Debug pipeline logs (per investigation spec)
  if (typeof console !== "undefined" && ranked.length) {
    // Uncomment for manual verification: console.table(ranked.map(u=>({rank:u._rank, uid:u.id||u.uid, displayName:u.displayName||u.name, xp:u.xp, energy:u.energy, score:u._score, createdAt:u.createdAt})))
  }

  return ranked;
}

export function searchFilter(users, term) {
  if (!term || !term.trim()) return users;
  const q = term.trim().toLowerCase();
  return users.filter(
    (u) =>
      (u.name || "").toLowerCase().includes(q) ||
      (u.displayName || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.username || "").toLowerCase().includes(q)
  );
}

function paginate(users, page, pageSize) {
  const start = (page - 1) * pageSize;
  return {
    items: users.slice(start, start + pageSize),
    total: users.length,
    page,
    totalPages: Math.max(1, Math.ceil(users.length / pageSize)),
  };
}

export async function getTopLeaderboardUsers() {
  const raw = await fetchAllUsers();
  return applyCompetitionRanking(raw);
}

export async function getLeaderboardUsers({ page = 1, pageSize = PAGE_SIZE, search = "" } = {}) {
  const raw = await fetchAllUsers();
  const ranked = applyCompetitionRanking(raw);
  const filtered = searchFilter(ranked, search);
  return paginate(filtered, page, pageSize);
}

function normalizeUserDoc(id, data) {
  const d = stripAdminFields({ id, ...data });
  // Ensure name/displayName alias so UI fallback doesn't produce duplicate "LockOn Learner" incorrectly
  if (!d.name && d.displayName) d.name = d.displayName;
  if (!d.displayName && d.name) d.displayName = d.name;
  d.xp = Number(d.xp ?? 0);
  d.energy = Number(d.energy ?? 0);
  d.totalScore = Number(d.totalScore ?? calcTotal(d));
  return d;
}

async function fetchAllUsers() {
  if (!isFirebaseConfigured) {
    const { readLocalState } = await import("./localStore.js");
    const state = readLocalState();
    return Object.entries(state.users || {}).map(([uid, data]) => normalizeUserDoc(uid, {
      ...data.profile,
      xp: data.xp ?? data.profile?.xp ?? 0,
      energy: data.energy ?? data.profile?.energy ?? 0,
      totalScore: data.totalScore ?? data.profile?.totalScore ?? 0,
      uid,
      displayName: data.profile?.displayName,
      name: data.profile?.displayName || data.profile?.name,
      username: data.profile?.username,
      createdAt: data.profile?.createdAt,
    }));
  }
  if (!db) throw new Error("Firebase is not configured.");
  const usersSnap = await getDocs(
    query(collection(db, "users"), orderBy("totalScore", "desc"), limit(5000))
  );
  // Log raw Firestore pipeline per investigation spec
  // console.table(usersSnap.docs.map(d=>({uid:d.id, displayName:d.data().displayName, username:d.data().username, XP:d.data().xp, Energy:d.data().energy, createdAt:d.data().createdAt})))
  return usersSnap.docs.map((doc) => normalizeUserDoc(doc.id, doc.data()));
}

export function mapUserData(doc) {
  return stripAdminFields({
    id: doc.id,
    ...doc.data(),
    xp: doc.data().xp ?? 0,
    energy: doc.data().energy ?? 0,
    totalScore: doc.data().totalScore ?? 0,
  });
}

export async function findUserPage(uid, search = "", pageSize = PAGE_SIZE) {
  const raw = await fetchAllUsers();
  const ranked = applyCompetitionRanking(raw);
  const filtered = searchFilter(ranked, search);
  const idx = filtered.findIndex((u) => u.id === uid);
  if (idx === -1) return null;
  return Math.floor(idx / pageSize) + 1;
}

export function subscribeToLeaderboard(onChange) {
  const cleanups = [];

  const handler = () => onChange();

  if (!isFirebaseConfigured) {
    cleanups.push(subscribeLocalState(handler));
  }

  cleanups.push(onScoreChanged(handler));
  cleanups.push(onLessonCompleted(handler));
  cleanups.push(onSessionCompleted(handler));

  return () => cleanups.forEach((fn) => fn());
}

export { PAGE_SIZE };

export function buildLeaderboardResult(rawUsers, page = 1, pageSize = PAGE_SIZE, search = "") {
  const ranked = applyCompetitionRanking(rawUsers);
  const filtered = searchFilter(ranked, search);
  return paginate(filtered, page, pageSize);
}
