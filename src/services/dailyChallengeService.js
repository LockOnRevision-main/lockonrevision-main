import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db, isFirebaseConfigured } from "../config/firebase.js";
import { getLocalUser, makeId, subscribeLocalState, updateLocalUser } from "./localStore.js";
import { apiFetch } from "../utils/apiFetch.js";
import { clampEnergy } from "./energyService.js";

export const CHALLENGE_TEMPLATES = [
  { id: "mixedQuiz", label: "Mixed Quiz", icon: "🧩" },
  { id: "weakTopicRecovery", label: "Weak Topic Recovery", icon: "🩹" },
  { id: "explainConcept", label: "Explain a Concept", icon: "💡" },
  { id: "matchFollowing", label: "Match the Following", icon: "🔗" },
  { id: "caseStudy", label: "Case Study", icon: "📋" },
  { id: "diagramLabeling", label: "Diagram Labeling", icon: "🏷️" },
  { id: "realLifeApplication", label: "Real-life Application", icon: "🌍" },
  { id: "timedRecall", label: "Timed Recall", icon: "⏱️" },
  { id: "multiStepReasoning", label: "Multi-step Reasoning", icon: "🧠" },
  { id: "examSprint", label: "Exam Sprint", icon: "🎯" },
];

export const CHALLENGE_DIFFICULTIES = ["easy", "medium", "hard", "mixed"];

export function getTodayDateString(date = new Date()) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getYesterdayDateString(date = new Date()) {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return getTodayDateString(d);
}

export function computeDifficulty({ xp = 0, completionPercent = 0, accuracy = 0, streak = 0 }) {
  // Weighted score 0-100
  const xpNorm = Math.min(xp / 2000, 1) * 40;
  const compNorm = (completionPercent / 100) * 30;
  const accNorm = (accuracy / 100) * 20;
  const streakNorm = Math.min(streak / 30, 1) * 10;
  const score = xpNorm + compNorm + accNorm + streakNorm;
  if (score < 25) return "easy";
  if (score < 55) return "medium";
  if (score < 80) return "hard";
  return "mixed";
  // Note: caller may occasionally reinforce fundamentals by randomly downgrading
}

export function selectTemplate(previousTemplateId) {
  const pool = CHALLENGE_TEMPLATES.filter((t) => t.id !== previousTemplateId);
  // Random but weighted to ensure variety
  const candidates = pool.length ? pool : CHALLENGE_TEMPLATES;
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

export function buildPersonalizationContext({
  subjects = [],
  lessons = [],
  answers = [],
  exerciseAnswers = [],
  timetables = [],
  examDates = [],
  profile = {},
}) {
  // Wrong answers -> weak topics
  const incorrectAnswers = answers.filter((a) => !a.isCorrect).slice(0, 15);
  const weakFromAnswers = incorrectAnswers.map((a) => ({
    prompt: a.prompt,
    selectedAnswer: a.selectedAnswer,
    correctAnswer: a.correctAnswer,
    subjectId: a.subjectId,
    lessonId: a.lessonId,
  }));

  const incorrectExercises = exerciseAnswers.filter((a) => !a.isCorrect).slice(0, 15);

  // Recently studied chapters: lessons completed in last 7 days
  const recentLessons = [...lessons]
    .filter((l) => l.completedAt || l.updatedAt)
    .sort((a, b) => new Date(b.completedAt || b.updatedAt) - new Date(a.completedAt || a.updatedAt))
    .slice(0, 8)
    .map((l) => ({ title: l.title, subjectName: l.subjectName, completed: l.completed }));

  // Completion per subject
  const progressBySubject = subjects.map((s) => {
    const subjLessons = lessons.filter((l) => l.subjectId === s.id);
    const done = subjLessons.filter((l) => l.completed).length;
    const total = subjLessons.length;
    return {
      subject: s.title,
      description: s.description,
      completed: done,
      total,
      percent: total ? Math.round((done / total) * 100) : 0,
    };
  });

  // Long-unpracticed: subjects with oldest last activity
  const lastActivityBySubject = progressBySubject
    .map((p) => {
      const subjLessons = lessons
        .filter((l) => l.subjectName === p.subject || l.subjectId === subjects.find((s) => s.title === p.subject)?.id)
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      const last = subjLessons[0]?.updatedAt || subjLessons[0]?.completedAt || null;
      return { subject: p.subject, lastActivity: last, percent: p.percent };
    })
    .sort((a, b) => new Date(a.lastActivity || 0) - new Date(b.lastActivity || 0));

  // Upcoming exams / timetable priorities
  const upcomingSessions = (() => {
    if (!timetables.length) return [];
    const tt = timetables[0];
    const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const now = new Date();
    const upcoming = [];
    for (const week of tt.weeks || []) {
      const weekStart = new Date(week.startDate + "T00:00:00");
      for (const day of DAYS) {
        const slots = week.days?.[day] || [];
        for (const slot of slots) {
          if (slot.completed || slot.skipped) continue;
          const dayDate = new Date(weekStart);
          dayDate.setDate(dayDate.getDate() + DAYS.indexOf(day));
          const slotDate = new Date(`${dayDate.toISOString().split("T")[0]}T${slot.timeSlot}:00`);
          if (slotDate > now) {
            upcoming.push({ ...slot, date: dayDate.toISOString().split("T")[0], day });
            if (upcoming.length >= 6) return upcoming;
          }
        }
      }
    }
    return upcoming;
  })();

  // Accuracy
  const totalAnswers = answers.length;
  const correctAnswers = answers.filter((a) => a.isCorrect).length;
  const accuracy = totalAnswers ? Math.round((correctAnswers / totalAnswers) * 100) : 0;

  const completionPercent = lessons.length ? Math.round((lessons.filter((l) => l.completed).length / lessons.length) * 100) : 0;

  return {
    subjects: subjects.map((s) => s.title),
    progressBySubject,
    weakFromAnswers,
    weakFromExercises: incorrectExercises,
    recentLessons,
    lastActivityBySubject,
    upcomingSessions,
    examDates: examDates.slice(0, 8),
    stats: {
      xp: Number(profile?.xp || 0),
      streak: Number(profile?.streak || 0),
      accuracy,
      completionPercent,
      totalLessons: lessons.length,
      completedLessons: lessons.filter((l) => l.completed).length,
    },
  };
}

async function fetchDailyChallengeContext(uid, profile) {
  if (!isFirebaseConfigured) {
    const local = getLocalUser(uid) || {};
    const subjects = local.subjects || [];
    const lessons = local.lessons || [];
    const answers = local.answers || [];
    const exerciseAnswers = local.exerciseAnswers || [];
    const timetables = local.timetables || [];
    const ttMeta = local.timetableMetadataHistory || [];
    const examDates = [];
    // Try to infer examDates from preferences
    for (const tt of timetables) {
      if (tt.preferences?.examDates) examDates.push(...tt.preferences.examDates);
    }
    return buildPersonalizationContext({
      subjects: subjects.map((s) => ({ id: s.id, title: s.title, description: s.description })),
      lessons,
      answers,
      exerciseAnswers,
      timetables,
      examDates,
      profile: profile || local.profile || {},
    });
  }

  const [subjectsSnap, lessonsSnap, answersSnap, exerciseAnswersSnap, timetablesSnap] = await Promise.all([
    getDocs(collection(db, "users", uid, "subjects")).catch(() => ({ docs: [] })),
    getDocs(collection(db, "users", uid, "lessons")).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, "users", uid, "answers"))).catch(() => ({ docs: [] })),
    getDocs(collection(db, "users", uid, "exerciseAnswers")).catch(() => ({ docs: [] })),
    getDocs(collection(db, "users", uid, "timetables")).catch(() => ({ docs: [] })),
  ]);

  const subjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lessons = lessonsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const answers = answersSnap.docs.map((d) => ({ id: d.id, ...d.data() })).slice(0, 30);
  const exerciseAnswers = exerciseAnswersSnap.docs.map((d) => ({ id: d.id, ...d.data() })).slice(0, 30);
  const timetables = timetablesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const examDates = [];
  for (const tt of timetables) {
    if (tt.preferences?.examDates) examDates.push(...tt.preferences.examDates);
  }
  // Also check forgeSources for weak topics? fallback uses lessons
  // Check timetableDocuments extraction for syllabus
  try {
    const metaSnap = await getDocs(collection(db, "users", uid, "timetableDocuments")).catch(() => ({ docs: [] }));
    // not needed for examDates
  } catch {}

  return buildPersonalizationContext({
    subjects: subjects.map((s) => ({ id: s.id, title: s.title, description: s.description })),
    lessons,
    answers,
    exerciseAnswers,
    timetables,
    examDates,
    profile: profile || {},
  });
}

function localDailyChallengeDoc(uid) {
  const local = getLocalUser(uid);
  if (!local) return null;
  return local.dailyChallenge?.current || null;
}

function setLocalDailyChallenge(uid, challenge) {
  updateLocalUser(uid, (ud) => ({
    ...ud,
    dailyChallenge: { ...(ud.dailyChallenge || {}), current: challenge, history: [...(ud.dailyChallenge?.history || []), challenge].slice(-30) },
  }));
}

export async function getDailyChallengeDoc(uid) {
  if (!isFirebaseConfigured) {
    return localDailyChallengeDoc(uid);
  }
  const ref = doc(db, "users", uid, "dailyChallenge", "current");
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeDailyChallenge(uid, callback, onError) {
  if (!isFirebaseConfigured) {
    return subscribeLocalState(() => {
      const doc = localDailyChallengeDoc(uid);
      callback(doc);
    });
  }
  const ref = doc(db, "users", uid, "dailyChallenge", "current");
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) callback({ id: snap.id, ...snap.data() });
      else callback(null);
    },
    (err) => onError?.(err),
  );
}

export async function ensureDailyChallenge(uid, profile) {
  const today = getTodayDateString();
  let existing = await getDailyChallengeDoc(uid);

  // Handle Firestore Timestamp vs string for date
  const existingDate = existing?.date
    ? (existing.date?.toDate ? getTodayDateString(existing.date.toDate()) : String(existing.date))
    : null;

  if (existing && existingDate === today) {
    return existing;
  }

  // Need to generate new challenge
  const context = await fetchDailyChallengeContext(uid, profile);
  const previousTemplate = existing?.challengeData?.templateId || existing?.templateId || null;
  let templateId = selectTemplate(previousTemplate);
  // Validate template still valid
  if (!CHALLENGE_TEMPLATES.find((t) => t.id === templateId)) templateId = selectTemplate(null);

  let difficulty = computeDifficulty(context.stats);
  // Sometimes reinforce fundamentals: 20% chance downgrade if hard/mixed
  if ((difficulty === "hard" || difficulty === "mixed") && Math.random() < 0.2) {
    difficulty = "medium";
  } else if (difficulty === "medium" && Math.random() < 0.15) {
    difficulty = "easy";
  }

  // Personalization weighting emphasis: pick subject focus
  const weakSubjects = context.progressBySubject
    .filter((p) => p.percent < 60 && p.total > 0)
    .sort((a, b) => a.percent - b.percent)
    .map((p) => p.subject);
  const longUnpracticed = context.lastActivityBySubject.slice(0, 2).map((p) => p.subject);
  const upcomingSubjects = context.upcomingSessions.slice(0, 3).map((s) => s.subject);
  const examSubjects = context.examDates.slice(0, 3).map((e) => e.subject);

  const candidateSubjects = [...new Set([...weakSubjects, ...upcomingSubjects, ...examSubjects, ...longUnpracticed])];
  const focusSubject = candidateSubjects[0] || context.subjects[0] || "General";

  const weakConcepts = context.weakFromAnswers.slice(0, 5).map((w) => w.prompt).join("; ").slice(0, 1000);

  // Call backend
  let generated = null;
  try {
    const res = await apiFetch("/api/generate-daily-challenge", {
      method: "POST",
      body: JSON.stringify({
        date: today,
        templateId,
        previousTemplateId: previousTemplate,
        difficulty,
        focusSubject,
        candidateSubjects,
        weakConcepts,
        weakTopics: context.weakFromAnswers.slice(0, 5),
        recentLessons: context.recentLessons.slice(0, 5),
        upcomingSessions: context.upcomingSessions.slice(0, 4),
        examDates: context.examDates.slice(0, 4),
        progressBySubject: context.progressBySubject.slice(0, 10),
        stats: context.stats,
        profile: {
          xp: context.stats.xp,
          streak: context.stats.streak,
          grade: profile?.grade || "",
          curriculum: profile?.curriculum || "",
          preferredLanguage: profile?.preferredLanguage || "en",
        },
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `API ${res.status}`);
    }
    generated = await res.json();
  } catch (e) {
    console.warn("[dailyChallenge] generate failed, using fallback", e.message);
    generated = fallbackChallenge({ templateId, difficulty, focusSubject, today });
  }

  const challengeId = makeId("dailyChallenge");
  const xpReward = generated.xpReward ?? difficultyXp(difficulty);
  const energyReward = generated.energyReward ?? difficultyEnergy(difficulty);
  const estimatedTime = generated.estimatedTime ?? estimateTime(templateId, difficulty);

  const challengeDoc = {
    date: today,
    challengeId,
    title: generated.title || `${CHALLENGE_TEMPLATES.find((t) => t.id === templateId)?.label || "Daily Challenge"}: ${focusSubject}`,
    description: generated.description || `Personalized ${difficulty} challenge focused on ${focusSubject}`,
    subject: generated.subject || focusSubject,
    difficulty,
    templateId,
    estimatedTime,
    xpReward,
    energyReward,
    challengeData: {
      templateId,
      ...generated.challengeData,
      // Ensure templateId persisted for next day avoidance
      generatedAt: new Date().toISOString(),
    },
    completed: false,
    completedAt: null,
    generatedAt: new Date().toISOString(),
    version: 1,
  };

  if (!isFirebaseConfigured) {
    setLocalDailyChallenge(uid, challengeDoc);
    return challengeDoc;
  }

  const ref = doc(db, "users", uid, "dailyChallenge", "current");
  // Also store history
  const historyRef = doc(collection(db, "users", uid, "dailyChallengeHistory"));
  const batch = writeBatch(db);
  batch.set(ref, { ...challengeDoc, generatedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  batch.set(historyRef, { ...challengeDoc, archivedAt: serverTimestamp() });
  await batch.commit();
  // Re-read to get server timestamp normalized
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data(), date: today } : challengeDoc;
}

function difficultyXp(difficulty) {
  if (difficulty === "easy") return 25;
  if (difficulty === "medium") return 40;
  if (difficulty === "hard") return 60;
  return 50;
}
function difficultyEnergy(difficulty) {
  if (difficulty === "easy") return 2;
  if (difficulty === "medium") return 3;
  if (difficulty === "hard") return 5;
  return 4;
}
function estimateTime(templateId, difficulty) {
  const base = {
    mixedQuiz: 10,
    weakTopicRecovery: 12,
    explainConcept: 8,
    matchFollowing: 7,
    caseStudy: 15,
    diagramLabeling: 10,
    realLifeApplication: 12,
    timedRecall: 5,
    multiStepReasoning: 15,
    examSprint: 12,
  }[templateId] || 10;
  if (difficulty === "hard") return base + 5;
  if (difficulty === "easy") return Math.max(5, base - 3);
  return base;
}

function fallbackChallenge({ templateId, difficulty, focusSubject, today }) {
  const templates = {
    mixedQuiz: {
      title: `Daily Quiz: ${focusSubject}`,
      description: `Mixed quiz reinforcing ${focusSubject} • ${difficulty}`,
      challengeData: {
        templateId,
        type: "mixedQuiz",
        instructions: `Answer the following questions about ${focusSubject}.`,
        questions: [
          { question: `Explain a core concept in ${focusSubject} and why it matters.`, options: ["Option A", "Option B", "Option C", "Option D"], correctAnswer: "Option A", explanation: "Review fundamentals." },
          { question: `Which statement best describes ${focusSubject}?`, options: ["True concept", "Misconception 1", "Misconception 2", "Misconception 3"], correctAnswer: "True concept", explanation: "Core idea reinforced." },
          { question: `Apply ${focusSubject} to a real scenario: what would you do?`, options: ["Best answer", "Partial", "Incorrect", "Off-topic"], correctAnswer: "Best answer", explanation: "Application tested." },
        ],
      },
    },
    weakTopicRecovery: {
      title: `Recover: ${focusSubject}`,
      description: `Recover weak topics in ${focusSubject}`,
      challengeData: {
        templateId,
        type: "weakTopicRecovery",
        instructions: `Revisit weak concepts in ${focusSubject}.`,
        questions: [
          { question: `Retry a previously missed concept in ${focusSubject}.`, options: ["Correct", "Wrong 1", "Wrong 2", "Wrong 3"], correctAnswer: "Correct", explanation: "Re-explained weak spot." },
        ],
      },
    },
  };
  const base = templates[templateId] || templates.mixedQuiz;
  return {
    ...base,
    subject: focusSubject,
    difficulty,
    date: today,
    challengeData: { ...base.challengeData, fallback: true },
  };
}

export async function completeDailyChallenge(uid, challenge, score = null, perfect = false) {
  if (!challenge) throw new Error("No challenge");
  if (challenge.completed) {
    return { success: false, reason: "already-completed" };
  }
  const today = getTodayDateString();
  const challengeDate = challenge.date?.toDate ? getTodayDateString(challenge.date.toDate()) : String(challenge.date);

  // Determine rewards
  let xpReward = Number(challenge.xpReward || 40);
  let energyReward = Number(challenge.energyReward || 3);
  const isPerfect = perfect || (score != null && score >= 100) || score === "perfect";
  if (isPerfect) {
    xpReward += 15;
    energyReward += 1;
  }

  const nowIso = new Date().toISOString();

  if (!isFirebaseConfigured) {
    const local = getLocalUser(uid);
    const cur = local?.dailyChallenge?.current;
    if (!cur || cur.challengeId !== challenge.challengeId) throw new Error("Challenge mismatch");
    if (cur.completed) return { success: false, reason: "already-completed" };
    // Update dailyChallenge
    updateLocalUser(uid, (ud) => {
      const activity = ud.activity || {};
      const todayKey = today;
      // Streak logic
      const lastCompletedDate = ud.profile?.lastCompletedDate || ud.lastCompletedDate || null;
      let currentStreak = Number(ud.profile?.currentStreak ?? ud.streak ?? 0);
      let bestStreak = Number(ud.profile?.bestStreak ?? 0);
      const yesterday = getYesterdayDateString();
      if (lastCompletedDate === today) {
        // already today - keep
      } else if (lastCompletedDate === yesterday) {
        currentStreak += 1;
      } else if (!lastCompletedDate) {
        currentStreak = 1;
      } else {
        // check if gap >1 day
        const last = new Date(lastCompletedDate);
        const diffDays = Math.floor((new Date(today) - last) / 86400000);
        if (diffDays === 1) currentStreak += 1;
        else if (diffDays > 1) currentStreak = 1;
        else currentStreak = 1;
      }
      if (currentStreak > bestStreak) bestStreak = currentStreak;
      const curEnergy = Number(ud.energy ?? ud.profile?.energy ?? 50);
      const newEnergy = clampEnergy(curEnergy + energyReward);
      const curXp = Number(ud.xp ?? ud.profile?.xp ?? 0);
      const newXp = curXp + xpReward;
      const newTotalScore = newXp + newEnergy * 100;
      return {
        ...ud,
        profile: {
          ...ud.profile,
          xp: newXp,
          energy: newEnergy,
          totalScore: newTotalScore,
          streak: currentStreak,
          currentStreak,
          bestStreak,
          lastCompletedDate: today,
          completedLessons: (ud.profile?.completedLessons || 0) + 1,
          updatedAt: nowIso,
        },
        xp: newXp,
        energy: newEnergy,
        totalScore: newTotalScore,
        streak: currentStreak,
        currentStreak,
        bestStreak,
        lastCompletedDate: today,
        activity: { ...activity, [todayKey]: (activity[todayKey] || 0) + 0.25 },
        dailyChallenge: {
          ...ud.dailyChallenge,
          current: { ...cur, completed: true, completedAt: nowIso, score, perfect: isPerfect, xpAwarded: xpReward, energyAwarded: energyReward },
        },
      };
    });
    return { success: true, xpReward, energyReward, isPerfect };
  }

  const ref = doc(db, "users", uid, "dailyChallenge", "current");
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Challenge not found");
  const data = snap.data();
  if (data.completed) return { success: false, reason: "already-completed" };
  if (data.challengeId !== challenge.challengeId) throw new Error("Challenge ID mismatch");

  // Fetch user for streak
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.exists() ? userSnap.data() : {};
  const lastCompletedDate = userData.lastCompletedDate || userData.currentStreakLastDate || null;
  // lastCompletedDate may be Timestamp
  const lastDateStr = lastCompletedDate?.toDate ? getTodayDateString(lastCompletedDate.toDate()) : (lastCompletedDate ? String(lastCompletedDate) : null);
  let currentStreak = Number(userData.currentStreak ?? userData.streak ?? 0);
  let bestStreak = Number(userData.bestStreak ?? 0);
  const yesterday = getYesterdayDateString(new Date(today + "T00:00:00"));
  if (lastDateStr === today) {
    // already counted today - don't increment again (should not happen as we check completed)
  } else if (lastDateStr === yesterday) {
    currentStreak += 1;
  } else if (!lastDateStr) {
    currentStreak = 1;
  } else {
    const last = new Date(lastDateStr + "T00:00:00");
    const cur = new Date(today + "T00:00:00");
    const diff = Math.round((cur - last) / 86400000);
    if (diff === 1) currentStreak += 1;
    else if (diff > 1) currentStreak = 1;
    else currentStreak = Math.max(1, currentStreak);
  }
  if (currentStreak > bestStreak) bestStreak = currentStreak;

  const curEnergy = Number(userData.energy ?? 50);
  const newEnergy = clampEnergy(curEnergy + energyReward);
  const batch = writeBatch(db);
  batch.update(ref, {
    completed: true,
    completedAt: serverTimestamp(),
    score: score ?? null,
    perfect: isPerfect,
    xpAwarded: xpReward,
    energyAwarded: energyReward,
    updatedAt: serverTimestamp(),
  });
  // Update user
  batch.update(userRef, {
    xp: increment(xpReward),
    energy: newEnergy,
    totalScore: (Number(userData.xp || 0) + xpReward) + newEnergy * 100,
    streak: currentStreak,
    currentStreak,
    bestStreak,
    lastCompletedDate: today,
    completedLessons: increment(1),
    [`activity.${today}`]: increment(0.25),
    updatedAt: serverTimestamp(),
  });
  // Also store history completed entry
  const histRef = doc(collection(db, "users", uid, "dailyChallengeHistory"));
  batch.set(histRef, {
    ...data,
    completed: true,
    completedAt: serverTimestamp(),
    score: score ?? null,
    perfect: isPerfect,
    xpAwarded: xpReward,
    energyAwarded: energyReward,
    date: challengeDate,
  });
  await batch.commit();
  return { success: true, xpReward, energyReward, isPerfect, currentStreak, bestStreak };
}

// For testing: allow manual re-generation override (admin/debug)
export async function forceRegenerateDailyChallenge(uid, profile, opts = {}) {
  const today = getTodayDateString();
  // Delete current and regenerate with optional template override
  if (!isFirebaseConfigured) {
    const local = getLocalUser(uid);
    if (local?.dailyChallenge?.current) {
      updateLocalUser(uid, (ud) => ({ ...ud, dailyChallenge: { ...ud.dailyChallenge, current: null } }));
    }
    return ensureDailyChallenge(uid, profile);
  }
  const ref = doc(db, "users", uid, "dailyChallenge", "current");
  // keep history
  return ensureDailyChallenge(uid, profile);
}
