import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db, isFirebaseConfigured } from "../config/firebase.js";
import { getLocalUser, makeId, subscribeLocalState, updateLocalUser } from "./localStore.js";
import { apiFetch } from "../utils/apiFetch.js";
import i18n from "../i18n/index.js";

const STORAGE_KEY = "lockon-timetable-preferences";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKEND = new Set(["Saturday", "Sunday"]);

// ── Local persistence ────────────────────────────────────────────────

export function savePreferencesLocally(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* noop */ }
}

export function loadPreferencesLocally() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ── Generation ───────────────────────────────────────────────────────

export async function generateTimetable(preferences) {
  const payload = {
    ...preferences,
    preferredLanguage: i18n.language,
    subjects: (preferences.subjects || []).map((s) => ({
      title: s.title,
      difficulty: s.difficulty || "medium",
      confidence: Number(s.confidence) || 5,
      currentChapter: s.currentChapter || "",
    })),
  };

  if (!isFirebaseConfigured) {
    return generateLocalFallback(payload);
  }

  try {
    const response = await apiFetch("/api/generate-timetable", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `API request failed: ${response.status}`);
    }
    return response.json();
  } catch (error) {
    console.error("Timetable API error:", error);
    return generateLocalFallback(payload);
  }
}

function generateLocalFallback(prefs) {
  const {
    subjects = [],
    dailyMinutes = 60,
    weekendMinutes,
    preferredTime = "09:00",
    durationWeeks = 4,
  } = prefs;

  const weekMinutes = dailyMinutes * 5 + (weekendMinutes ?? dailyMinutes) * 2;
  const totalMinutes = weekMinutes * durationWeeks;

  const weighted = subjects.map((s) => {
    const diff = ({ easy: 1, medium: 2, hard: 3 })[s.difficulty] || 2;
    const need = Math.max(1, 10 - (Number(s.confidence) || 5));
    return { ...s, weight: diff + need };
  });

  const totalWeight = weighted.reduce((sum, s) => sum + s.weight, 0) || 1;
  const allocated = weighted.map((s) => ({
    ...s,
    remaining: Math.round((s.weight / totalWeight) * totalMinutes),
  }));

  const startDate = new Date();
  const daysUntilMonday = (1 - startDate.getDay() + 7) % 7;
  startDate.setDate(startDate.getDate() + daysUntilMonday);
  const weeks = fillWeeks(durationWeeks, startDate, allocated, dailyMinutes, weekendMinutes, preferredTime);
  return { weeks, preferences: prefs };
}

function fillWeeks(durationWeeks, startDate, allocated, dailyMinutes, weekendMinutes, preferredTime, slotSeed) {
  let slotId = slotSeed || 0;
  const weeks = [];

  for (let w = 0; w < durationWeeks; w++) {
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const days = {};
    const preferredHour = parseInt(preferredTime.split(":")[0] || 9, 10);

    for (const day of DAYS) {
      const dayMin = WEEKEND.has(day) ? (weekendMinutes ?? dailyMinutes) : dailyMinutes;
      if (dayMin <= 0) continue;

      const slots = [];
      let used = 0;
      const sessionLen = 30;

      while (used < dayMin) {
        const available = allocated.filter((s) => s.remaining > 0);
        if (!available.length) break;

        available.sort((a, b) => b.remaining - a.remaining);
        const pick = available[0];
        const sessionMin = Math.min(sessionLen, pick.remaining, dayMin - used);

        const startH = preferredHour + Math.floor(used / 60);
        const startM = used % 60;

        slots.push({
          id: `slot-${slotId++}`,
          subject: pick.title,
          topic: pick.currentChapter || pick.title,
          duration: sessionMin,
          timeSlot: `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`,
          type: used % 60 === 0 ? "revision" : "practice",
          completed: false,
          skipped: false,
        });

        pick.remaining -= sessionMin;
        used += sessionMin;
      }

      if (slots.length > 0) days[day] = slots;
    }

    weeks.push({ weekNumber: w + 1, startDate: weekStart.toISOString().split("T")[0], days });
  }

  return weeks;
}

// ── Persistence ──────────────────────────────────────────────────────

export async function saveTimetable(uid, timetable) {
  const id = makeId("timetable");
  const now = new Date().toISOString();

  if (!isFirebaseConfigured) {
    updateLocalUser(uid, (userData) => ({
      ...userData,
      timetables: [{ id, ...timetable, createdAt: now, updatedAt: now }, ...(userData.timetables || [])],
    }));
    return id;
  }

  const batch = writeBatch(db);
  const ref = doc(collection(db, "users", uid, "timetables"));
  batch.set(ref, { ...timetable, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await batch.commit();
  return ref.id;
}

export async function updateTimetable(uid, timetableId, updatedFields) {
  if (!isFirebaseConfigured) {
    updateLocalUser(uid, (userData) => ({
      ...userData,
      timetables: (userData.timetables || []).map((t) =>
        t.id === timetableId ? { ...t, ...updatedFields, updatedAt: new Date().toISOString() } : t
      ),
    }));
    return;
  }

  const ref = doc(db, "users", uid, "timetables", timetableId);
  const batch = writeBatch(db);
  batch.update(ref, { ...updatedFields, updatedAt: serverTimestamp() });
  await batch.commit();
}

// Upsert – ensures only one active timetable; updates existing instead of creating orphaned docs
export async function upsertTimetable(uid, timetable) {
  if (!isFirebaseConfigured) {
    const existing = (getLocalUser(uid)?.timetables || [])[0];
    if (existing?.id) {
      await updateTimetable(uid, existing.id, timetable);
      // Cleanup duplicates in local store – keep only the updated one at front
      const userData = getLocalUser(uid);
      if (userData && userData.timetables && userData.timetables.length > 1) {
        const keepId = existing.id;
        updateLocalUser(uid, (ud) => ({
          ...ud,
          timetables: ud.timetables.filter((t) => t.id === keepId),
        }));
      }
      return existing.id;
    }
    return saveTimetable(uid, timetable);
  }

  // Firestore: check for existing timetables
  let existingSnap;
  try {
    existingSnap = await getDocs(query(collection(db, "users", uid, "timetables"), orderBy("updatedAt", "desc")));
  } catch (e) {
    console.warn("[timetableService] upsert: failed to query existing, falling back to save", e?.message);
    return saveTimetable(uid, timetable);
  }

  if (existingSnap && !existingSnap.empty) {
    const existingId = existingSnap.docs[0].id;
    try {
      await updateTimetable(uid, existingId, timetable);
      console.log("[timetableService] upsert: updated existing", { existingId });
    } catch (e) {
      console.error("[timetableService] upsert: update failed, creating new", e?.message);
      return saveTimetable(uid, timetable);
    }
    // Cleanup orphaned duplicates – delete all but the updated one
    const orphanIds = existingSnap.docs.slice(1).map((d) => d.id);
    if (orphanIds.length) {
      console.log("[timetableService] upsert: cleaning orphaned timetables", { orphanIds });
      for (const oid of orphanIds) {
        try {
          await deleteDoc(doc(db, "users", uid, "timetables", oid));
        } catch (e) {
          console.warn("[timetableService] upsert: failed to delete orphan", oid, e?.message);
        }
      }
    }
    return existingId;
  }

  return saveTimetable(uid, timetable);
}

export async function getTimetables(uid) {
  if (!isFirebaseConfigured) {
    return getLocalUser(uid)?.timetables || [];
  }
  const snap = await getDocs(query(collection(db, "users", uid, "timetables"), orderBy("updatedAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeTimetables(uid, callback) {
  if (!isFirebaseConfigured) {
    return subscribeLocalState(() => callback(getLocalUser(uid)?.timetables || []));
  }
  return onSnapshot(
    query(collection(db, "users", uid, "timetables"), orderBy("updatedAt", "desc")),
    (snapshot) => callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error("[timetableService] subscribeTimetables failed", err?.code, err?.message);
    },
  );
}

// ── Session mutation helpers ─────────────────────────────────────────

export function cloneTimetable(timetable) {
  return JSON.parse(JSON.stringify(timetable));
}

export function markSessionCompleted(timetable, weekIdx, day, slotId) {
  const t = cloneTimetable(timetable);
  const slots = t.weeks?.[weekIdx]?.days?.[day];
  if (!slots) return t;
  const slot = slots.find((s) => s.id === slotId);
  if (slot) { slot.completed = true; slot.skipped = false; }
  return t;
}

export function markSessionSkipped(timetable, weekIdx, day, slotId) {
  const t = cloneTimetable(timetable);
  const slots = t.weeks?.[weekIdx]?.days?.[day];
  if (!slots) return t;
  const slot = slots.find((s) => s.id === slotId);
  if (slot) { slot.skipped = true; slot.completed = false; }
  return t;
}

// ── Intelligent regeneration ─────────────────────────────────────────

export function regenerateRemaining(timetable) {
  const prefs = timetable.preferences || {};
  const { dailyMinutes = 60, weekendMinutes, preferredTime = "09:00" } = prefs;

  const now = new Date();
  const t = cloneTimetable(timetable);

  // Calculate remaining minutes per subject
  const completedMinutes = {};
  const allocatedMinutes = {};
  const weights = {};

  for (const week of t.weeks) {
    for (const day of DAYS) {
      const slots = week.days?.[day] || [];
      for (const slot of slots) {
        if (!completedMinutes[slot.subject]) completedMinutes[slot.subject] = 0;
        if (!allocatedMinutes[slot.subject]) allocatedMinutes[slot.subject] = 0;
        allocatedMinutes[slot.subject] += slot.duration || 0;
        if (slot.completed) completedMinutes[slot.subject] += slot.duration || 0;
      }
    }
  }

  // Build weight map from original preferences
  const subPrefs = {};
  for (const s of (prefs.subjects || [])) {
    const diff = ({ easy: 1, medium: 2, hard: 3 })[s.difficulty] || 2;
    const need = Math.max(1, 10 - (Number(s.confidence) || 5));
    weights[s.title] = diff + need;
    subPrefs[s.title] = s;
  }

  // Find the first uncompleted slot that is now or in the future
  let foundStart = false;
  const futureAllocated = [];

  for (let w = 0; w < t.weeks.length; w++) {
    const week = t.weeks[w];
    const weekStart = new Date(week.startDate + "T00:00:00");
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    for (const day of DAYS) {
      const slots = week.days?.[day] || [];
      if (!slots.length) continue;

      // Determine if this day is in the future
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + DAYS.indexOf(day));

      for (const slot of slots) {
        const slotDateTime = new Date(`${dayDate.toISOString().split("T")[0]}T${slot.timeSlot}:00`);

        if (slot.completed) continue;

        if (!foundStart && slotDateTime <= now) {
          // Past uncompleted (skipped) — just mark it as skipped
          slot.skipped = true;
          continue;
        }

        if (!foundStart && slotDateTime > now) {
          foundStart = true;
        }

        if (foundStart) {
          futureAllocated.push({
            subject: slot.subject,
            duration: slot.duration,
            weight: weights[slot.subject] || 5,
          });
          slot._regenerated = true; // mark for replacement
        }
      }
    }
  }

  // If nothing to regenerate, return as-is
  if (futureAllocated.length === 0) return t;

  // Rebalance: reallocate remaining minutes proportionally
  const subjectRemaining = {};
  const subjectWeight = {};
  for (const s of futureAllocated) {
    subjectRemaining[s.subject] = (subjectRemaining[s.subject] || 0) + s.duration;
    subjectWeight[s.subject] = s.weight;
  }

  // Calculate how many future weeks we have
  let futureWeeks = 0;
  let futureStartDate = null;
  let slotSeed = 0;

  for (let w = 0; w < t.weeks.length; w++) {
    const week = t.weeks[w];
    let hasFuture = false;
    for (const day of DAYS) {
      const slots = week.days?.[day] || [];
      for (const slot of slots) {
        if (slot._regenerated) { hasFuture = true; break; }
        slotSeed = Math.max(slotSeed, parseInt((slot.id || "slot-0").replace("slot-", ""), 10) + 1);
      }
      if (hasFuture) break;
    }
    if (hasFuture) {
      if (!futureStartDate) {
        futureStartDate = new Date(week.startDate + "T00:00:00");
      }
      futureWeeks++;
    }
  }

  if (!futureStartDate || futureWeeks === 0) return t;

  // Remove regenerated slots
  for (const week of t.weeks) {
    for (const day of DAYS) {
      if (week.days?.[day]) {
        week.days[day] = week.days[day].filter((s) => !s._regenerated);
        if (week.days[day].length === 0) delete week.days[day];
      }
      delete week._regenerated;
    }
  }

  // Calculate allocated for future
  const totalFutureMinutes = Object.values(subjectRemaining).reduce((sum, m) => sum + m, 0);
  const daily = dailyMinutes;
  const weekend = weekendMinutes ?? dailyMinutes;
  const weekMins = daily * 5 + weekend * 2;
  const availableFuture = weekMins * futureWeeks;

  const scale = availableFuture > 0 ? totalFutureMinutes / availableFuture : 1;

  const newAllocated = Object.entries(subjectRemaining).map(([subject, mins]) => {
    const weight = subjectWeight[subject] || 5;
    return {
      title: subject,
      difficulty: subPrefs[subject]?.difficulty || "medium",
      confidence: subPrefs[subject]?.confidence || 5,
      currentChapter: subPrefs[subject]?.currentChapter || subject,
      weight,
      remaining: Math.round(mins * Math.min(1, scale)),
    };
  });

  // Generate new weeks
  const newWeeks = fillWeeks(futureWeeks, futureStartDate, newAllocated, dailyMinutes, weekendMinutes, preferredTime, slotSeed);

  // Merge back
  let nwIdx = 0;
  for (let w = 0; w < t.weeks.length; w++) {
    if (nwIdx < newWeeks.length) {
      const existing = t.weeks[w];
      // Check if this week has been cleared (had future slots)
      const hasExistingSlots = DAYS.some((d) => existing.days?.[d]?.length > 0);
      if (!hasExistingSlots) {
        t.weeks[w] = newWeeks[nwIdx];
        t.weeks[w].weekNumber = w + 1;
        nwIdx++;
      }
    }
  }

  return t;
}

// ── Document Upload Pipeline (Smart Timetable V2) ──────────────────────
const TIMETABLE_DOCS_COLLECTION = "timetableDocuments";
const TIMETABLE_META_DOC = "timetableMetadata";

function extractMockMetadata(files) {
  // Lightweight client-side extraction fallback – real AI runs in /api/extract-timetable-docs
  // Merges multiple files, dedupes by subject+date/title
  const assessments = [];
  const syllabusTopics = new Map(); // subject -> Set(topics)
  for (const f of files) {
    const name = (f.name || "").toLowerCase();
    const isExam = /exam|assessment|schedule|test|toddle/i.test(name);
    const isSyllabus = /syllabus|planner|scheme/i.test(name);
    // Naive subject inference from filename
    const subjectGuess = (f.name.split(/[-_\.]/)[0] || "General").trim() || "General";
    if (isExam || /assessmentdetails/i.test(name)) {
      // Create a mock assessment per file if none exists – real extraction will override
      assessments.push({
        subject: subjectGuess,
        assessmentType: "exam",
        date: new Date(Date.now() + 14*864e5).toISOString().split("T")[0],
        sourceFile: f.name,
        sourceFileId: f.id,
      });
    }
    if (isSyllabus || /\.pdf$/i.test(name) || /\.docx$/i.test(name)) {
      if (!syllabusTopics.has(subjectGuess)) syllabusTopics.set(subjectGuess, new Set());
      syllabusTopics.get(subjectGuess).add(f.name.replace(/\.[^.]+$/, ""));
    }
  }
  // Dedupe assessments by subject+date
  const seen = new Set();
  const deduped = assessments.filter(a => {
    const k = `${a.subject}|${a.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const syllabus = Array.from(syllabusTopics.entries()).map(([subject, topics]) => ({
    subject,
    chapters: Array.from(topics).map(t => ({ title: t })),
  }));
  return { assessments: deduped, syllabus };
}

export async function uploadTimetableDocuments(uid, files, onProgress) {
  const uploaded = [];
  for (let i=0;i<files.length;i++) {
    const file = files[i];
    // Reuse Forge temp upload (Cloudinary) – store original for reprocessing
    let url = null, publicId = null, resourceType = "raw";
    try {
      const { uploadTempFile } = await import("../utils/storage.js");
      const res = await uploadTempFile(uid, file);
      url = res.url; publicId = res.publicId; resourceType = res.resourceType;
    } catch (e) {
      // Cloudinary not configured or image type – keep as local placeholder, still persist metadata
      console.warn("[timetable] uploadTempFile fallback", e.message);
    }
    // For text-like files, also capture preview for reprocessing without re-download
    let preview = "";
    if (/\.(txt|md|csv)$/i.test(file.name)) {
      try { preview = (await file.text()).slice(0, 8000); } catch {}
    }
    const docData = {
      name: file.name,
      originalName: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      url, publicId, resourceType,
      preview,
      status: "uploaded",
      processingStatus: "pending",
      extraction: null,
      createdAt: isFirebaseConfigured ? serverTimestamp() : new Date().toISOString(),
      updatedAt: isFirebaseConfigured ? serverTimestamp() : new Date().toISOString(),
    };
    if (!isFirebaseConfigured) {
      const id = `timetableDoc-${Date.now()}-${i}`;
      updateLocalUser(uid, ud => ({
        ...ud,
        timetableDocuments: [{ id, ...docData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, ...(ud.timetableDocuments||[])],
      }));
      uploaded.push({ id, ...docData });
    } else {
      const ref = await addDoc(collection(db, "users", uid, TIMETABLE_DOCS_COLLECTION), docData);
      uploaded.push({ id: ref.id, ...docData });
    }
    onProgress?.(Math.round(((i+1)/files.length)*100));
  }
  return uploaded;
}

export function subscribeTimetableDocuments(uid, callback) {
  if (!isFirebaseConfigured) {
    return subscribeLocalState(()=> callback(getLocalUser(uid)?.timetableDocuments || []));
  }
  return onSnapshot(
    query(collection(db, "users", uid, TIMETABLE_DOCS_COLLECTION), orderBy("createdAt", "desc")),
    snap => callback(snap.docs.map(d=>({id:d.id, ...d.data()}))),
    err => console.error("[timetable] subscribeTimetableDocuments failed", err.code),
  );
}

export async function deleteTimetableDocument(uid, docId, publicId, resourceType) {
  if (!isFirebaseConfigured) {
    updateLocalUser(uid, ud=> ({...ud, timetableDocuments: (ud.timetableDocuments||[]).filter(d=>d.id!==docId)}));
    return;
  }
  if (publicId) {
    try { const { deleteStorageFile } = await import("../utils/storage.js"); await deleteStorageFile(publicId, resourceType); } catch {}
  }
  await deleteDoc(doc(db, "users", uid, TIMETABLE_DOCS_COLLECTION, docId));
}

export async function renameTimetableDocument(uid, docId, newName) {
  if (!isFirebaseConfigured) {
    updateLocalUser(uid, ud=> ({...ud, timetableDocuments: (ud.timetableDocuments||[]).map(d=> d.id===docId ? {...d, name:newName, updatedAt:new Date().toISOString()} : d)}));
    return;
  }
  await updateDoc(doc(db, "users", uid, TIMETABLE_DOCS_COLLECTION, docId), { name: newName, updatedAt: serverTimestamp() });
}

export async function reprocessTimetableDocuments(uid, timetableId, inlineFiles = []) {
  // inlineFiles: [{name, type, contentBase64}] – original bytes from this session, bypasses Cloudinary delivery 401
  // Fetch all docs + existing timetable to merge without losing completed sessions
  let docs = [];
  let currentTimetable = null;
  if (!isFirebaseConfigured) {
    docs = getLocalUser(uid)?.timetableDocuments || [];
    currentTimetable = (getLocalUser(uid)?.timetables||[]).find(t=>t.id===timetableId) || (getLocalUser(uid)?.timetables||[])[0] || null;
  } else {
    const snap = await getDocs(collection(db, "users", uid, TIMETABLE_DOCS_COLLECTION));
    docs = snap.docs.map(d=>({id:d.id, ...d.data()}));
    if (timetableId) {
      const { getDoc } = await import("firebase/firestore");
      const tSnap = await getDoc(doc(db,"users",uid,"timetables",timetableId));
      if (tSnap.exists()) currentTimetable = {id:tSnap.id, ...tSnap.data()};
    }
    // Fallback: if no timetableId (stale Dashboard card) or not found, fetch latest from Firestore
    if (!currentTimetable) {
      try {
        const latest = await getDocs(query(collection(db, "users", uid, "timetables"), orderBy("updatedAt", "desc")));
        if (!latest.empty) {
          currentTimetable = { id: latest.docs[0].id, ...latest.docs[0].data() };
          console.log("[timetable] reprocess: resolved currentTimetable via latest query", { id: currentTimetable.id });
        }
      } catch (e) {
        console.warn("[timetable] reprocess: failed to resolve latest timetable", e?.message);
      }
    }
  }
  // Attach inline bytes by filename match so backend prefers direct ingest over Cloudinary URL
  const inlineByName = new Map((inlineFiles||[]).map(f=> [f.name, f]));
  const filesForApi = docs.map(d=> {
    const inline = inlineByName.get(d.name);
    return {
      url:d.url, name:d.name, type:d.type, publicId:d.publicId, resourceType:d.resourceType,
      ...(inline?.contentBase64 ? { contentBase64: inline.contentBase64 } : {}),
    };
  });
  console.log(`[timetable] reprocess: docs=${docs.length} inline=${inlineFiles.length} (bypass Cloudinary 401)`);
  // Gemini responsibility: ONLY analyse documents → structured JSON. Engine does scheduling.
  let extracted = null;
  let extractionErrors = [];
  try {
    const res = await apiFetch("/api/extract-timetable-docs", {
      method: "POST",
      body: JSON.stringify({ files: filesForApi, preferredLanguage: i18n.language }),
    });
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) {
      // Per spec: explain which file failed and why, never generate from guessed data
      const reason = data.error || data.details || `Extraction failed (${res.status})`;
      extractionErrors = data.errors || docs.map(d=> ({ file: d.name, reason }));
      throw new Error(reason);
    }
    if (data.errors?.length) extractionErrors = data.errors;
    if (data.subjects || data.assessments || data.syllabus) {
      extracted = data;
    }
  } catch (e) {
    if (!extracted) {
      // Only fallback to mock if API unavailable (e.g., local dev without key); otherwise propagate error
      const isConfigError = /GEMINI_API|503/i.test(e.message);
      if (isConfigError) {
        console.warn("[timetable] extraction API unavailable, using mock fallback", e.message);
        extracted = extractMockMetadata(docs);
      } else {
        // Mark docs as failed per file
        const failedPayload = (docId, reason) => ({
          processingStatus: "failed",
          processingError: String(reason).slice(0,500),
          updatedAt: isFirebaseConfigured ? serverTimestamp() : new Date().toISOString(),
        });
        for (const err of (extractionErrors.length ? extractionErrors : [{file:"unknown", reason:e.message}])) {
          const target = docs.find(d=> d.name===err.file) || docs[0];
          if (!target) continue;
          const payload = failedPayload(target.id, err.reason || e.message);
          if (!isFirebaseConfigured) {
            updateLocalUser(uid, ud=> ({...ud, timetableDocuments: (ud.timetableDocuments||[]).map(x=> x.id===target.id ? {...x, ...payload, updatedAt:new Date().toISOString()} : x)}));
          } else {
            await updateDoc(doc(db,"users",uid,TIMETABLE_DOCS_COLLECTION,target.id), payload);
          }
        }
        throw new Error(extractionErrors[0]?.reason || e.message);
      }
    }
  }
  if (!extracted) extracted = extractMockMetadata(docs);
  // Mark docs as processed – success only if we have structured data
  const isSuccess = (extracted.subjects?.length || extracted.syllabus?.length || extracted.assessments?.length);
  for (const d of docs) {
    const payload = {
      processingStatus: isSuccess ? "success" : "failed",
      processingError: isSuccess ? null : "Could not extract subjects/assessments – poor scan quality or insufficient text",
      extraction: extracted,
      updatedAt: isFirebaseConfigured ? serverTimestamp() : new Date().toISOString()
    };
    if (!isFirebaseConfigured) {
      updateLocalUser(uid, ud=> ({...ud, timetableDocuments: (ud.timetableDocuments||[]).map(x=> x.id===d.id ? {...x, ...payload, updatedAt:new Date().toISOString()} : x)}));
    } else {
      await updateDoc(doc(db,"users",uid,TIMETABLE_DOCS_COLLECTION,d.id), payload);
    }
  }
  // Persist merged metadata for version history (optional)
  const meta = { extracted, processedAt: isFirebaseConfigured ? serverTimestamp() : new Date().toISOString(), sourceDocIds: docs.map(d=>d.id) };
  if (!isFirebaseConfigured) {
    updateLocalUser(uid, ud=> ({...ud, timetableMetadataHistory: [...(ud.timetableMetadataHistory||[]), {...meta, id:`meta-${Date.now()}` }]}));
  } else {
    await addDoc(collection(db,"users",uid,"timetableMetadataHistory"), meta);
    await updateDoc(doc(db,"users",uid,TIMETABLE_META_DOC, "current"), meta).catch(async()=> {
      await writeBatch(db).set(doc(db,"users",uid,TIMETABLE_META_DOC,"current"), meta).commit();
    });
  }
  // Merge timetable: preserve completed sessions, rebalance only future
  if (!extracted.assessments?.length && !extracted.syllabus?.length) {
    // No new data – keep current, just mark reprocessed
    return { extracted, timetable: currentTimetable };
  }
  // Build subjects from syllabus + assessments (dedupe)
  const subjectMap = new Map();
  for (const s of extracted.syllabus || []) {
    const title = s.subject || s.title;
    if (!title) continue;
    if (!subjectMap.has(title)) subjectMap.set(title, { title, difficulty:"medium", confidence:5, currentChapter: (s.chapters?.[0]?.title||"") });
  }
  for (const a of extracted.assessments || []) {
    const title = a.subject;
    if (!title) continue;
    if (!subjectMap.has(title)) subjectMap.set(title, { title, difficulty:"medium", confidence:5, currentChapter: "" });
  }
  // Also keep existing timetable subjects not in new extraction (don't delete)
  for (const s of (currentTimetable?.preferences?.subjects || [])) {
    if (!subjectMap.has(s.title)) subjectMap.set(s.title, s);
  }
  const mergedSubjects = Array.from(subjectMap.values());
  // Infer examDates for timetable generation from assessments
  const examDates = (extracted.assessments||[]).map(a=> ({subject:a.subject, date:a.date})).filter(e=>e.subject&&e.date);
  const prefs = {
    ...(currentTimetable?.preferences||{}),
    subjects: mergedSubjects,
    examDates: [...(currentTimetable?.preferences?.examDates||[]), ...examDates].filter((v,i,a)=> a.findIndex(x=>x.subject===v.subject&&x.date===v.date)===i),
    dailyMinutes: currentTimetable?.preferences?.dailyMinutes || 60,
    weekendMinutes: currentTimetable?.preferences?.weekendMinutes || 60,
    preferredTime: currentTimetable?.preferences?.preferredTime || "09:00",
    durationWeeks: currentTimetable?.preferences?.durationWeeks || 4,
  };
  let newTimetable;
  if (!currentTimetable) {
    newTimetable = await generateTimetable(prefs);
  } else {
    // Generate fresh weeks then merge completed sessions from current
    const fresh = await generateTimetable(prefs);
    // Preserve completed/skipped flags by subject+timeSlot matching
    const completedKeys = new Set();
    for (const w of currentTimetable.weeks||[]) for (const day of Object.keys(w.days||{})) for (const s of (w.days[day]||[])) if(s.completed) completedKeys.add(`${s.subject}|${s.topic}|${s.timeSlot}`);
    // Actually we want to keep completed sessions in place and only rebalance future – reuse regenerateRemaining pattern:
    // Start from fresh, then re-apply completed flags where match exists
    for (const w of fresh.weeks) for (const day of Object.keys(w.days||{})) for (const s of (w.days[day]||[])) if(completedKeys.has(`${s.subject}|${s.topic}|${s.timeSlot}`)) s.completed=true;
    newTimetable = { ...fresh, id: currentTimetable.id, preferences: prefs };
    // For Firestore update, keep same id
    if (isFirebaseConfigured) {
      await updateTimetable(uid, currentTimetable.id, { weeks: newTimetable.weeks, preferences: prefs, extracted, updatedAt: serverTimestamp() });
    } else {
      updateLocalUser(uid, ud=> ({...ud, timetables: (ud.timetables||[]).map(t=> t.id===currentTimetable.id ? {...t, weeks:newTimetable.weeks, preferences: prefs, extracted} : t)}));
    }
    return { extracted, timetable: newTimetable };
  }
  // No existing timetable – save new via upsert to prevent duplicate race
  const savedId = await upsertTimetable(uid, { ...newTimetable, extracted, preferences: prefs });
  newTimetable.id = savedId;
  return { extracted, timetable: newTimetable };
}

// ── Dashboard helpers ────────────────────────────────────────────────

export function getTodaySessions(timetable) {
  if (!timetable?.weeks) return [];
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  for (const week of timetable.weeks) {
    const weekStart = week.startDate;
    const weekEnd = new Date(weekStart + "T00:00:00");
    weekEnd.setDate(weekEnd.getDate() + 7);
    const today = new Date(todayStr + "T00:00:00");

    if (today >= new Date(weekStart + "T00:00:00") && today < weekEnd) {
      const dayName = DAYS[(today.getDay() + 6) % 7];
      const slots = week.days?.[dayName] || [];
      return slots.filter((s) => !s.completed && !s.skipped);
    }
  }
  return [];
}

export function getUpcomingLessons(timetable, limitCount = 5) {
  if (!timetable?.weeks) return [];
  const now = new Date();
  const upcoming = [];

  for (const week of timetable.weeks) {
    const weekStart = new Date(week.startDate + "T00:00:00");
    for (const day of DAYS) {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + DAYS.indexOf(day));
      const slots = week.days?.[day] || [];

      for (const slot of slots) {
        if (slot.completed || slot.skipped) continue;
        const slotDate = new Date(`${dayDate.toISOString().split("T")[0]}T${slot.timeSlot}:00`);
        if (slotDate > now) {
          upcoming.push({ ...slot, date: dayDate.toISOString().split("T")[0] });
          if (upcoming.length >= limitCount) return upcoming;
        }
      }
    }
  }
  return upcoming;
}

export function getWeeklyCompletion(timetable) {
  if (!timetable?.weeks) return { completed: 0, total: 0, percent: 0 };

  const now = new Date();
  let completed = 0;
  let total = 0;

  for (const week of timetable.weeks) {
    const weekStart = new Date(week.startDate + "T00:00:00");
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    if (now >= weekEnd) continue; // past weeks — skip or count fully?

    for (const day of DAYS) {
      const slots = week.days?.[day] || [];
      for (const slot of slots) {
        total++;
        if (slot.completed) completed++;
      }
    }
    break; // only current week
  }

  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export function getRemainingWorkload(timetable) {
  if (!timetable?.weeks) return { totalMinutes: 0, bySubject: [] };

  const now = new Date();
  const bySubject = {};
  let totalMinutes = 0;

  for (const week of timetable.weeks) {
    const weekStart = new Date(week.startDate + "T00:00:00");
    for (const day of DAYS) {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + DAYS.indexOf(day));
      const slots = week.days?.[day] || [];

      for (const slot of slots) {
        if (slot.completed) continue;
        const slotDate = new Date(`${dayDate.toISOString().split("T")[0]}T${slot.timeSlot}:00`);
        if (!slot.skipped && slotDate > now) {
          const mins = slot.duration || 0;
          totalMinutes += mins;
          bySubject[slot.subject] = (bySubject[slot.subject] || 0) + mins;
        }
      }
    }
  }

  return {
    totalMinutes,
    bySubject: Object.entries(bySubject)
      .map(([subject, minutes]) => ({ subject, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

// ── Dashboard-specific helpers ─────────────────────────────────────
export function getNextExam(timetable) {
  if (!timetable?.preferences?.examDates?.length && !timetable?.extracted?.assessments?.length) return null;
  const examDates = timetable.preferences?.examDates || [];
  const assessments = timetable.extracted?.assessments || [];
  const all = [
    ...examDates.map((e) => ({ subject: e.subject, date: e.date, type: e.type || "exam", source: "examDates" })),
    ...assessments.map((a) => ({ subject: a.subject, date: a.date, type: a.assessmentType || a.type || "assessment", source: "assessment" })),
  ].filter((e) => e.date);
  // Dedupe by subject|date
  const seen = new Set();
  const deduped = all.filter((e) => {
    const k = `${e.subject}|${e.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const upcoming = deduped
    .map((e) => {
      const d = new Date(e.date + "T00:00:00");
      const diffMs = d - now;
      const diffDays = Math.ceil(diffMs / 86400000);
      return { ...e, diffDays, dateObj: d };
    })
    .filter((e) => e.diffDays >= 0)
    .sort((a, b) => a.diffDays - b.diffDays);
  return upcoming[0] || null;
}

export function getUpcomingDeadlines(timetable, limit = 4) {
  if (!timetable?.preferences?.examDates?.length && !timetable?.extracted?.assessments?.length) return [];
  const examDates = timetable.preferences?.examDates || [];
  const assessments = timetable.extracted?.assessments || [];
  const all = [
    ...examDates.map((e) => ({ subject: e.subject, date: e.date, type: e.type || "exam" })),
    ...assessments.map((a) => ({ subject: a.subject, date: a.date, type: a.assessmentType || a.type || "assessment" })),
  ].filter((e) => e.date);
  const seen = new Set();
  const deduped = all.filter((e) => {
    const k = `${e.subject}|${e.date}|${e.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return deduped
    .map((e) => {
      const d = new Date(e.date + "T00:00:00");
      const diffDays = Math.ceil((d - now) / 86400000);
      return { ...e, diffDays, dateObj: d };
    })
    .filter((e) => e.diffDays >= 0)
    .sort((a, b) => a.diffDays - b.diffDays)
    .slice(0, limit);
}

export function getSyllabusProgress(timetable) {
  // Prefer extracted syllabus, fallback to preferences subjects
  const syllabus = timetable?.extracted?.syllabus || [];
  const preferences = timetable?.preferences?.subjects || [];
  if (syllabus.length) {
    const totalChapters = syllabus.reduce((sum, s) => sum + (s.chapters?.length || 0), 0);
    // Estimate completed by counting completed sessions vs total scheduled per subject
    const workload = getRemainingWorkload(timetable);
    const totalMinutes = Object.values(workload.bySubject).reduce((sum, v) => sum + 0, 0) + (getWeeklyCompletion(timetable).total * 30);
    // Simpler: use weeklyCompletion as proxy
    const wc = getWeeklyCompletion(timetable);
    const overall = wc.total ? wc.percent : 0;
    // Build per-subject syllabus progress
    const bySubject = syllabus.map((s) => {
      const chapters = s.chapters || [];
      const subject = s.subject || s.title;
      const subjectSlots = (timetable.weeks || []).flatMap((w) => Object.values(w.days || {}).flat()).filter((sl) => sl.subject === subject);
      const completed = subjectSlots.filter((sl) => sl.completed).length;
      const total = subjectSlots.length || chapters.length || 1;
      return {
        subject,
        chapters: chapters.length,
        completed,
        total,
        percent: Math.round((completed / total) * 100),
      };
    });
    const totalCompleted = bySubject.reduce((sum, b) => sum + b.completed, 0);
    const totalAll = bySubject.reduce((sum, b) => sum + b.total, 0) || totalChapters || 1;
    return {
      totalChapters,
      completed: totalCompleted,
      total: totalAll,
      percent: totalAll ? Math.round((totalCompleted / totalAll) * 100) : overall,
      bySubject,
    };
  }
  // Fallback: use preferences subjects + weekly completion
  const wc = getWeeklyCompletion(timetable);
  const bySubject = preferences.map((s) => {
    const subjectSlots = (timetable.weeks || []).flatMap((w) => Object.values(w.days || {}).flat()).filter((sl) => sl.subject === s.title);
    const completed = subjectSlots.filter((sl) => sl.completed).length;
    const total = subjectSlots.length || 1;
    return {
      subject: s.title,
      chapters: 0,
      completed,
      total,
      percent: Math.round((completed / total) * 100),
    };
  });
  return {
    totalChapters: bySubject.length,
    completed: bySubject.reduce((sum, b) => sum + b.completed, 0),
    total: bySubject.reduce((sum, b) => sum + b.total, 0),
    percent: wc.percent,
    bySubject,
  };
}

export function getLastUpdatedTimestamp(timetable) {
  if (!timetable) return null;
  const raw = timetable.updatedAt || timetable.createdAt;
  if (!raw) return null;
  try {
    if (typeof raw.toDate === "function") return raw.toDate().toISOString();
    if (typeof raw === "string") return raw;
    if (raw.seconds) return new Date(raw.seconds * 1000).toISOString();
  } catch {}
  return String(raw);
}
