import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LessonPlayer } from "../components/LessonPlayer.jsx";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext.jsx";
import { completeLesson } from "../services/learningService.js";
import { getDocs, query, collection, where } from "firebase/firestore";
import { db, isFirebaseConfigured } from "../config/firebase.js";
import { getLocalUser } from "../services/localStore.js";

export function ForgeLessonPage() {
  const { subjectId, lessonId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!lessonId || !user?.uid) return;

    async function loadLesson() {
      try {
        if (!isFirebaseConfigured) {
          const userData = getLocalUser(user.uid);
          const found = userData?.lessons?.find((l) => l.id === lessonId);
          if (found) setLesson(found);
        } else {
          const snap = await getDocs(
            query(collection(db, "users", user.uid, "lessons"), where("__name__", "==", lessonId))
          );
          if (!snap.empty) {
            setLesson({ id: snap.docs[0].id, ...snap.docs[0].data() });
          }
        }
      } catch {
        setStatus(t('forge_lesson.failed_load'));
      } finally {
        setLoading(false);
      }
    }

    loadLesson();
  }, [lessonId, user?.uid, t]);

  const handleCompleteLesson = useCallback(async (lessonId, xpEarned, perfect, correctCount, totalCount) => {
    try {
      const accuracy = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 100;
      const result = await completeLesson(user.uid, lessonId, xpEarned, perfect, {
        difficulty: lesson?.difficulty || "medium",
        grade: profile?.grade,
        curriculum: profile?.curriculum,
        subjectName: lesson?.subjectName,
        accuracy,
      });
      if (!result.success && result.reason === "already-completed") {
        setStatus(t('forge_lesson.already_completed'));
      } else if (result.success) {
        setStatus(t('forge_lesson.completed', { xp: result.totalXP, energy: result.energyAward, perfect: perfect ? t('forge_lesson.perfect_suffix') : '' }));
      }
    } catch (error) {
      setStatus(error.message);
    }
  }, [user?.uid, profile, lesson, t]);

  const handleBack = useCallback(() => {
    if (subjectId) {
      navigate(`/forge/subject/${subjectId}`);
    } else {
      navigate("/forge");
    }
  }, [navigate, subjectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="loading-spinner-lg animate-spin-slow rounded-full border-primary/20 border-t-primary" role="status" aria-label="Loading" style={{ willChange: "transform" }} />
          <p className="text-sm font-bold uppercase tracking-widest text-text-muted">Loading lesson…</p>
        </div>
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="max-w-4xl mx-auto p-4 sm:p-6 text-center">
        <p className="text-lg font-bold text-text-primary mb-4">{t("errors.not_found")}</p>
        <button
          onClick={handleBack}
          className="px-6 py-3 bg-primary text-white rounded-xl font-black"
        >
          {t("common.back")}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <button
        onClick={handleBack}
        className="mb-4 text-sm font-bold text-text-secondary hover:text-text-primary flex items-center gap-2 transition-colors"
      >
        {t("forge.back_to_curriculum")}
      </button>
      {status && (
        <div className="mb-4 p-3 rounded-xl text-sm font-bold text-center border border-status-success/30 bg-status-success/10 text-status-success">
          {status}
        </div>
      )}
      <LessonPlayer lesson={lesson} onComplete={handleCompleteLesson} />
    </div>
  );
}
