import { CalendarDays, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext.jsx";
import { TimetableDisplay } from "../components/TimetableDisplay.jsx";
import { TimetableForm } from "../components/TimetableForm.jsx";
import { TimetableUploadCard } from "../components/TimetableUploadCard.jsx";

import { generateTimetable, savePreferencesLocally, saveTimetable, subscribeTimetables, updateTimetable, upsertTimetable } from "../services/timetableService.js";
import { setupTimetableIntegration } from "../services/timetableIntegration.js";
import { useStagedProgress } from "../hooks/useStagedProgress.js";

export function TimetablePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [timetable, setTimetable] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const timetableRef = useRef(null);
  const loader = useStagedProgress({ busy, minDuration: 1000 });

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeTimetables(user.uid, (data) => {
      if (data.length > 0) {
        // Always use latest Firestore data – ensures dashboard sync after upload
        setTimetable(data[0]);
      } else {
        setTimetable(null);
      }
    });
    return unsub;
  }, [user?.uid]);

  // Wire up timetable-forge integration
  useEffect(() => {
    if (!user?.uid || !timetable?.id) return;
    timetableRef.current = timetable;
    const cleanup = setupTimetableIntegration(user.uid, timetable.id, timetableRef);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, timetable?.id]);

  const handleGenerate = async (preferences) => {
    setBusy(true);
    setError("");
    setSaved(false);
    loader.setStage(3);
    try {
      // Stage: Upload (preferences)
      try {
        savePreferencesLocally(preferences);
      } catch (e) {
        console.error("[TimetablePage] Stage Upload failed", e);
        throw new Error(`Upload stage failed: ${e.message}`);
      }
      loader.setProgress(45);
      // Stage: Timetable generation
      let result;
      try {
        result = await generateTimetable(preferences);
      } catch (e) {
        console.error("[TimetablePage] Stage Timetable generation failed", e);
        throw new Error(`Timetable generation failed: ${e.message}`);
      }
      if (!result?.weeks) {
        console.error("[TimetablePage] Stage Generation returned invalid structure", result);
        throw new Error("Timetable generation returned invalid data");
      }
      loader.setStage(4);
      loader.setProgress(88);
      // Stage: Firestore write – upsert to avoid orphaned duplicates
      try {
        const savedId = await upsertTimetable(user.uid, result);
        console.log("[TimetablePage] Stage Firestore write succeeded", { savedId });
        // Do not set local state manually – subscription will deliver canonical Firestore doc
        // This ensures dashboard and all subscribers update from source of truth
      } catch (e) {
        console.error("[TimetablePage] Stage Firestore write failed", e);
        throw new Error(`Firestore write failed: ${e.message}`);
      }
      loader.setStage(5);
      loader.setProgress(98);
      setSaved(true);
    } catch (err) {
      console.error("[TimetablePage] handleGenerate pipeline failed", { stage: loader.stage, error: err.message });
      setError(err.message || t("timetable_page.failed_generate"));
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = () => {
    setTimetable(null);
  };

  return (
    <div className="grid gap-8">
      {/* Page header */}
      <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
        <div className="bg-gradient-to-r from-secondary to-primary p-10 text-text-primary">
          <div className="flex items-center gap-3">
            <CalendarDays size={28} className="text-white/90" />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t("timetable.planning")}</p>
              <h1 className="text-4xl font-black tracking-tight text-text-primary">{t("timetable.study_timetable")}</h1>
            </div>
          </div>
          <p className="mt-4 max-w-2xl text-lg text-text-primary/85">
            {t("timetable.description")}
          </p>
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-status-error/20 bg-status-error/10 px-4 py-3 text-sm font-bold text-status-error">
          {error}
        </p>
      ) : null}

      {saved ? (
        <p className="rounded-xl border border-status-success/20 bg-status-success/10 px-4 py-3 text-sm font-bold text-status-success">
          {t("timetable_page.saved")}
        </p>
      ) : null}

      {/* Upload Documents – always visible, fulfills Pipeline Exists, UI Missing */}
      <TimetableUploadCard timetableId={timetable?.id} />

      {timetable ? (
        <>
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-5 py-3 text-sm text-text-secondary shadow-sm">
            <RefreshCw size={16} className="text-primary" />
            {t("timetable.change_subjects")}
            <button
              type="button"
              onClick={handleRegenerate}
              className="ml-1 font-bold text-primary underline underline-offset-2 hover:text-secondary"
            >
              {t("timetable.start_over")}
            </button>
          </div>
          <TimetableDisplay timetable={timetable} onRegenerate={handleRegenerate} />
        </>
      ) : (
        <>
          {loader.visible ? (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-border bg-surface p-10 sm:p-16 shadow-sm text-center">
              <RefreshCw size={40} className="animate-spin-slow text-primary" style={{ width: "clamp(2rem, 8vw, 2.5rem)", height: "clamp(2rem, 8vw, 2.5rem)" }} />
              <p className="mt-6 text-lg font-black tracking-tight text-text-primary">{loader.stage}</p>
              <p className="mt-2 text-sm text-text-secondary">{t("timetable.balancing_text")}</p>
              <div className="loading-progress-track mt-5 bg-background rounded-full overflow-hidden border border-border/50">
                <div className="h-full bg-primary transition-all duration-500 ease-out" style={{ width: `${loader.progress}%` }} />
              </div>
              <p className="mt-2 text-xs font-bold tabular-nums text-text-muted">{Math.round(loader.progress)}%</p>
            </div>
          ) : (
            <TimetableForm onGenerate={handleGenerate} busy={busy} />
          )}
        </>
      )}
    </div>
  );
}
