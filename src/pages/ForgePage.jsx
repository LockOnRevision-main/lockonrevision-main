import { BookOpen, FileUp, RefreshCw, Trophy, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext.jsx";
import {
  cleanupUploadedFiles,
  generateForgeStructure,
  subscribeForgeSubjects,
  subscribeForgeLessons,
  uploadForgeFiles,
} from "../services/forgeService.js";
import { useStagedProgress } from "../hooks/useStagedProgress.js";
import { LoadingOverlay } from "../components/LoadingOverlay.jsx";

export function ForgePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [subjects, setSubjects] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [pastedNotes, setPastedNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState("");
  const loader = useStagedProgress({ busy, minDuration: 1000 });
  const progress = loader.progress;
  // Derive display stage: prefer explicit status if set, otherwise loader stage
  const displayStage = status || loader.stage;

  useEffect(() => {
    if (!user?.uid) {
      console.log("[ForgePage] skip subscribe – no uid", { user, auth: !!user });
      return;
    }
    console.log("[ForgePage] subscribe START", { uid: user.uid, isFirebaseConfigured: !!user });
    setLoadError("");
    const onErr = (err) => {
      console.error("[ForgePage] load failed", { code: err?.code, message: err?.message });
      const msg = err?.message || "Failed to load subjects.";
      const isBlocked = (err?.code === "unavailable" || String(msg).toLowerCase().includes("failed to fetch"));
      setLoadError(isBlocked ? "Could not load subjects. Your network or DNS filter (NextDNS/AdGuard/Pi-hole) may be blocking firestore.googleapis.com. Please allow it and retry." : msg);
    };
    const unsub1 = subscribeForgeSubjects(user.uid, (items)=>{
      console.log("[ForgePage] subjects loaded", { count: items.length, ids: items.map(s=>s.id) });
      if (items.length===0) {
        console.warn("[ForgePage] EMPTY state – reason: no forge docs for this uid. Check Firestore write path users/"+user.uid+"/subjects, read permission, or blocked endpoint");
      }
      setSubjects(items);
    }, onErr);
    const unsub2 = subscribeForgeLessons(user.uid, (items)=>{
      console.log("[ForgePage] lessons loaded", { count: items.length });
      setLessons(items);
    }, onErr);
    return () => { unsub1(); unsub2(); };
  }, [user?.uid]);

  const handleContinueLearning = useCallback(() => {
    if (subjects.length > 0) {
      navigate(`/forge/subject/${subjects[0].id}`);
    }
  }, [subjects, navigate]);

  async function handleUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    // Prevent duplicate uploads
    if (busy) {
      setStatus(t('forge_page.upload_in_progress'));
      return;
    }

    let uploaded = [];

    setBusy(true);
    setStatus(t('forge_page.uploading_files'));
    loader.setStage(0);

    try {
      const result = await uploadForgeFiles(user.uid, files, (p) => {
        // Map file upload 0-100% → 0-20% real progress
        loader.setProgress(Math.round((p / 100) * 20));
      });
      uploaded = result.uploaded;
      loader.setStage(1);
      loader.setProgress(30);
      const combinedText = result.combinedText;
      const sourceText = [pastedNotes.trim(), combinedText].filter(Boolean).join("\n\n---\n\n");
      if (!sourceText.trim()) throw new Error(t('forge_page.no_readable_content'));

      loader.setStage(2);
      setStatus(t('forge_page.generating_structure'));
      loader.setProgress(55);
      const generated = await generateForgeStructure(user.uid, sourceText, uploaded.map((item) => item.id), uploaded);
      loader.setStage(4);
      loader.setProgress(90);
      await cleanupUploadedFiles(uploaded);
      loader.setStage(5);
      // Ensure at least minDuration and smooth 100% before navigation
      await new Promise((r) => setTimeout(r, 420));
      navigate(`/forge/subject/${generated.id}`);
      setPastedNotes("");
      setStatus("Learning path generated successfully.");
    } catch (error) {
      await cleanupUploadedFiles(uploaded).catch(() => {});
      setStatus(error.message || t('forge_page.upload_failed'));
    } finally {
      // Let loader handle minDuration → 100% → hide
      setBusy(false);
      // Clear status message after a delay so overlay shows final stage before hiding
      const start = Date.now();
      const check = () => {
        if (!loader.visible) setStatus("");
        else if (Date.now() - start < 3000) setTimeout(check, 300);
      };
      setTimeout(check, 1100);
      event.target.value = "";
    }
  }

  async function handleGenerateFromPaste() {
    if (!pastedNotes.trim()) {
      setStatus(t('forge_page.paste_or_upload_first'));
      return;
    }

    setBusy(true);
    loader.setStage(2);
    setStatus(t('forge_page.generating_structure'));

    try {
      loader.setProgress(45);
      const generated = await generateForgeStructure(user.uid, pastedNotes.trim(), []);
      loader.setStage(4);
      loader.setProgress(90);
      await new Promise((r) => setTimeout(r, 300));
      loader.setStage(5);
      navigate(`/forge/subject/${generated.id}`);
      setPastedNotes("");
      setStatus(t('forge_page.generated_success'));
    } catch (error) {
      setStatus(error.message || t('forge_page.upload_failed'));
    } finally {
      setBusy(false);
    }
  }

  const totalLessons = lessons.length;
  const completedLessons = lessons.filter((l) => l.completed).length;
  const totalXp = lessons.reduce((sum, l) => sum + (l.xpEarned || 0), 0);
  const hasSubjects = subjects.length > 0;

  return (
    <div className="relative space-y-6">
      <LoadingOverlay progress={progress} stage={displayStage || t("common.processing")} visible={loader.visible} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 space-y-6">
        {loadError ? (
          <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-warning">{loadError}</p>
            <button onClick={() => window.location.reload()} className="shrink-0 rounded-xl bg-warning px-4 py-2 text-sm font-black text-white">Retry</button>
          </div>
        ) : null}
        {!loadError && subjects.length === 0 && lessons.length === 0 ? (
          <p className="text-sm text-text-muted text-center">No subjects yet — or Firestore is unreachable due to network filtering (check browser console for [forgeService] errors).</p>
        ) : null}
        {/* Generate New Subject */}
        <section className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
          <p className="text-sm font-bold uppercase tracking-widest text-text-secondary">{t("forge.new_label")}</p>
          <h2 className="mt-1 text-2xl font-black text-text-primary">{t("forge.generate_subject")}</h2>

          <label className="mt-4 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-border bg-background p-8 text-center transition hover:border-primary focus-within:ring-2 focus-within:ring-primary/50">
            <FileUp size={32} className="text-primary" />
            <strong className="mt-3 text-text-primary">{t("forge.upload_notes")}</strong>
            <span className="mt-1 text-sm text-text-secondary">{t("forge.upload_hint")}</span>
            <input
              className="hidden"
              type="file"
              multiple
              accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.svg,.docx,.pptx"
              onChange={handleUpload}
              disabled={busy}
            />
          </label>

          <textarea
            value={pastedNotes}
            onChange={(event) => setPastedNotes(event.target.value)}
            className="mt-4 min-h-40 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 text-text-primary outline-none focus:border-primary transition-colors placeholder:text-text-muted"
            placeholder={t("forge.paste_placeholder")}
            disabled={busy}
          />

          <button
            type="button"
            disabled={busy || !pastedNotes.trim()}
            onClick={handleGenerateFromPaste}
            className="mt-3 w-full rounded-xl bg-secondary px-4 py-3 font-black text-white disabled:bg-text-muted disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors hover:bg-secondary-hover"
          >
            {t("forge.generate_from_paste")}
          </button>
        </section>

        {/* Continue Previous Learning */}
        {hasSubjects && (
          <button
            onClick={handleContinueLearning}
            className="w-full rounded-3xl border border-border bg-surface p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 text-left group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-secondary/10 flex items-center justify-center shrink-0">
                  <BookOpen size={24} className="text-secondary" />
                </div>
                <div>
                  <p className="text-lg font-black text-text-primary group-hover:text-primary transition-colors">{t("forge.continue_learning")}</p>
                  <p className="text-sm text-text-secondary mt-0.5">
                    {t("forge.resume", { title: subjects[0]?.title, count: subjects.length })}
                  </p>
                </div>
              </div>
              <span className="text-xl text-text-muted group-hover:text-primary transition-colors">&rarr;</span>
            </div>
          </button>
        )}

        {/* Recent Progress Summary */}
        {hasSubjects && (
          <section className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={20} className="text-primary" />
              <h2 className="text-lg font-black text-text-primary">{t("forge.recent_progress")}</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-background border border-border text-center">
                <p className="text-2xl font-black text-text-primary">{subjects.length}</p>
                <p className="text-xs font-bold uppercase tracking-widest text-text-muted mt-1">{t("forge.subjects_stat")}</p>
              </div>
              <div className="p-4 rounded-2xl bg-background border border-border text-center">
                <p className="text-2xl font-black text-text-primary">{completedLessons}/{totalLessons}</p>
                <p className="text-xs font-bold uppercase tracking-widest text-text-muted mt-1">{t("forge.lessons_stat")}</p>
              </div>
              <div className="p-4 rounded-2xl bg-background border border-border text-center">
                <p className="text-2xl font-black text-text-primary">
                  {totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0}%
                </p>
                <p className="text-xs font-bold uppercase tracking-widest text-text-muted mt-1">{t("forge.complete_stat")}</p>
              </div>
              <div className="p-4 rounded-2xl bg-background border border-border text-center">
                <p className="text-2xl font-black text-text-primary">
                  <span className="flex items-center justify-center gap-1">
                    {totalXp} <Trophy size={16} className="text-warning" />
                  </span>
                </p>
                <p className="text-xs font-bold uppercase tracking-widest text-text-muted mt-1">{t("forge.xp_earned_stat")}</p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
