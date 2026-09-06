import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ForgeCurriculumView } from "../components/ForgeCurriculumView.jsx";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext.jsx";
import { useStagedProgress } from "../hooks/useStagedProgress.js";
import { LoadingOverlay } from "../components/LoadingOverlay.jsx";
import {
  getForgeContext,
  regenerateForgeStructure,
  subscribeForgeSubjects,
  subscribeForgeUnits,
  subscribeForgeSubUnits,
  subscribeForgeLessons,
} from "../services/forgeService.js";

export function ForgeSubjectPage() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [subjects, setSubjects] = useState([]);
  const [units, setUnits] = useState([]);
  const [subUnits, setSubUnits] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState("");
  const loader = useStagedProgress({ busy, minDuration: 1000 });

  useEffect(() => {
    if (!user?.uid) return;
    const onErr = (err) => setLoadError(err?.message?.includes("Failed to fetch") ? "Network blocked — check DNS/ad-blocker for firestore.googleapis.com" : (err?.message || "Failed to sync subject."));
    const unsub1 = subscribeForgeSubjects(user.uid, setSubjects, onErr);
    const unsub2 = subscribeForgeUnits(user.uid, setUnits, onErr);
    const unsub3 = subscribeForgeSubUnits(user.uid, setSubUnits, onErr);
    const unsub4 = subscribeForgeLessons(user.uid, setLessons, onErr);
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [user?.uid]);

  useEffect(() => {
    const selected = subjects.find((item) => item.id === subjectId);
    setDraft(selected ? JSON.parse(JSON.stringify(selected)) : null);
  }, [subjects, subjectId]);

  const handleBackToSubjects = useCallback(() => {
    navigate("/forge");
  }, [navigate]);

  const handleStartLesson = (lesson) => {
    navigate(`/forge/lesson/${lesson.subjectId}/${lesson.id}`);
  };

  async function handleRegenerate() {
    if (!draft) return;

    setBusy(true);
    loader.setStage(2);
    setStatus(t('forge_subject.regenerating'));
    try {
      loader.setProgress(40);
      const context = await getForgeContext(user.uid);
      const sourceText = context.sourceText || "";
      if (!sourceText) throw new Error(t('forge_subject.no_source'));
      loader.setStage(3);
      await regenerateForgeStructure(user.uid, draft.id, sourceText);
      loader.setStage(4);
      loader.setProgress(90);
      await new Promise((r) => setTimeout(r, 300));
      loader.setStage(5);
      setStatus(t('forge_subject.regenerated'));
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const subjectUnits = units.filter((u) => u.subjectId === subjectId);
  const subjectSubUnits = subUnits.filter((su) => subjectUnits.some((u) => u.id === su.unitId));
  const subjectLessons = lessons.filter((l) => l.subjectId === subjectId);

  if (!selectedSubject) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6 text-center">
        <p className="text-lg font-bold text-text-primary mb-4">{t("forge.subject_not_found")}</p>
        <button
          onClick={handleBackToSubjects}
          className="px-6 py-3 bg-primary text-white rounded-xl font-black"
        >
          {t("forge.back_to_forge")}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <LoadingOverlay progress={loader.progress} stage={status || loader.stage} visible={loader.visible} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6">
        {loadError ? (
          <div className="mb-4 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-sm font-bold text-warning">
            {loadError} — if you use NextDNS/AdGuard/Pi-hole, allow firestore.googleapis.com and refresh.
          </div>
        ) : null}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={handleBackToSubjects}
            className="inline-flex items-center gap-2 text-sm font-bold text-text-secondary hover:text-text-primary transition-colors"
          >
            {t("forge.all_subjects")}
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleRegenerate}
              disabled={busy || !draft}
              className="flex items-center gap-2 px-4 py-2 bg-background border border-border text-text-secondary rounded-xl text-sm font-bold hover:bg-surface transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin-slow" : ""}`} />
              {t("forge.regenerate")}
            </button>
          </div>
        </div>
      </div>
      <ForgeCurriculumView
        subject={selectedSubject}
        units={subjectUnits}
        subUnits={subjectSubUnits}
        lessons={subjectLessons}
        onStartLesson={handleStartLesson}
      />
    </div>
  );
}
