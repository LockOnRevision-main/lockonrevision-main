import { Award, Brain, CheckCircle2, Clock, Flame, Sparkles, Target, Trophy, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext.jsx";
import { ensureDailyChallenge, subscribeDailyChallenge } from "../services/dailyChallengeService.js";

const DIFFICULTY_COLOR = {
  easy: "bg-status-success/15 text-status-success border-status-success/30",
  medium: "bg-warning/15 text-warning border-warning/30",
  hard: "bg-status-error/15 text-status-error border-status-error/30",
  mixed: "bg-primary/15 text-primary border-primary/30",
};

const TEMPLATE_LABELS = {
  mixedQuiz: "Mixed Quiz",
  weakTopicRecovery: "Weak Topic Recovery",
  explainConcept: "Explain a Concept",
  matchFollowing: "Match the Following",
  caseStudy: "Case Study",
  diagramLabeling: "Diagram Labeling",
  realLifeApplication: "Real-life Application",
  timedRecall: "Timed Recall",
  multiStepReasoning: "Multi-step Reasoning",
  examSprint: "Exam Sprint",
};

export function DailyChallengeCard() {
  const { user, profile } = useAuth();
  const { t } = useTranslation();
  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    // Subscribe for real-time cached challenge
    const unsub = subscribeDailyChallenge(user.uid, (doc) => {
      if (!cancelled && doc) {
        setChallenge(doc);
        setLoading(false);
      }
    });

    // Ensure today's challenge exists (does NOT regenerate if cached)
    ensureDailyChallenge(user.uid, profile)
      .then((doc) => {
        if (!cancelled) {
          setChallenge(doc);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message || "Failed to load challenge");
          setLoading(false);
        }
      });

    // Re-check at local midnight: schedule next generation
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const msUntilMidnight = midnight - now;
    let midnightTimer = null;
    if (msUntilMidnight > 0 && msUntilMidnight < 24 * 3600 * 1000) {
      midnightTimer = setTimeout(() => {
        ensureDailyChallenge(user.uid, profile).catch(() => {});
      }, msUntilMidnight + 1000);
    }

    return () => {
      cancelled = true;
      unsub?.();
      if (midnightTimer) clearTimeout(midnightTimer);
    };
  }, [user?.uid, profile?.xp, profile?.streak]);

  const handleGenerate = async () => {
    if (!user?.uid) return;
    setGenerating(true);
    setError("");
    try {
      const doc = await ensureDailyChallenge(user.uid, profile);
      setChallenge(doc);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm animate-pulse">
        <div className="h-6 w-48 bg-background rounded mb-3" />
        <div className="h-4 w-full bg-background rounded mb-2" />
        <div className="h-10 w-32 bg-background rounded" />
      </article>
    );
  }

  if (error && !challenge) {
    return (
      <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-xl bg-primary/10 text-primary"><Brain size={20} /></div>
          <h3 className="font-black text-text-primary">Daily AI Challenge</h3>
        </div>
        <p className="text-sm text-status-error mb-3">{error}</p>
        <button onClick={handleGenerate} disabled={generating} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50">
          {generating ? "Generating..." : "Retry"}
        </button>
      </article>
    );
  }

  if (!challenge) {
    return (
      <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-xl bg-primary/10 text-primary"><Brain size={20} /></div>
          <h3 className="font-black text-text-primary">Daily AI Challenge</h3>
        </div>
        <p className="text-sm text-text-secondary mb-3">No challenge yet. Generate your personalized challenge.</p>
        <button onClick={handleGenerate} disabled={generating} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50">
          {generating ? "Generating..." : "Generate Challenge"}
        </button>
      </article>
    );
  }

  const difficulty = challenge.difficulty || "medium";
  const diffClass = DIFFICULTY_COLOR[difficulty] || DIFFICULTY_COLOR.medium;
  const templateLabel = TEMPLATE_LABELS[challenge.templateId] || challenge.templateId || "Challenge";
  const completed = !!challenge.completed;
  const progressPercent = completed ? 100 : 0;

  return (
    <article className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm hover:shadow-md transition-all">
      {/* Header gradient */}
      <div className="bg-gradient-to-r from-primary/10 via-secondary/10 to-primary/5 px-6 py-5 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-primary text-white shadow-sm shrink-0">
              <Sparkles size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-text-secondary flex items-center gap-2">
                <span>Today&apos;s AI Challenge</span>
                {completed && <span className="inline-flex items-center gap-1 rounded-full bg-status-success/15 text-status-success px-2 py-0.5 text-[10px] border border-status-success/20"><CheckCircle2 size={10} /> Completed</span>}
              </p>
              <h3 className="text-lg font-black tracking-tight text-text-primary truncate">{challenge.title}</h3>
              <p className="text-xs text-text-secondary line-clamp-1">{challenge.description}</p>
            </div>
          </div>
          <div className={`hidden sm:inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-black shrink-0 ${diffClass}`}>
            <Target size={12} /> {difficulty}
          </div>
        </div>
      </div>

      <div className="p-6">
        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-background border border-border px-3 py-1 text-xs font-bold text-text-secondary">
            <Brain size={12} /> {challenge.subject || "General"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-background border border-border px-3 py-1 text-xs font-bold text-text-secondary">
            <Clock size={12} /> {challenge.estimatedTime || 10} min
          </span>
          <span className="sm:hidden inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black shrink-0 ${diffClass}">{difficulty}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-3 py-1 text-xs font-bold text-text-secondary">
            {templateLabel}
          </span>
        </div>

        {/* Rewards */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-warning/10 border border-warning/20 px-3 py-1.5 text-xs font-black text-warning">
            <Zap size={14} /> {challenge.xpReward || 40} XP
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs font-black text-primary">
            <Flame size={14} /> {challenge.energyReward || 3} Energy
          </span>
          {challenge.challengeData?.timeLimitSeconds && (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-surface border border-border px-3 py-1.5 text-xs font-bold text-text-secondary">
              ⏱️ {Math.round(challenge.challengeData.timeLimitSeconds / 60)}m timed
            </span>
          )}
        </div>

        {/* Progress */}
        <div className="mb-5">
          <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-text-muted mb-1.5">
            <span>Progress</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-background border border-border">
            <div className={`h-full rounded-full transition-all duration-500 ${completed ? "bg-status-success" : "bg-primary"}`} style={{ width: `${progressPercent}%` }} />
          </div>
          {completed && challenge.completedAt && (
            <p className="mt-1.5 text-xs text-status-success font-medium">
              Completed {(() => { try { const d = challenge.completedAt?.toDate ? challenge.completedAt.toDate() : new Date(challenge.completedAt); return d.toLocaleString(); } catch { return ""; } })()} {challenge.perfect ? "• Perfect! +bonus" : ""}
            </p>
          )}
        </div>

        {/* CTA */}
        {completed ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-status-success">
              <CheckCircle2 size={18} /> Challenge completed
            </div>
            <Link to="/daily-challenge" className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 py-2.5 text-sm font-black text-text-primary hover:bg-card transition-colors">
              Review
            </Link>
          </div>
        ) : (
          <Link
            to="/daily-challenge"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 font-black text-white shadow-lg hover:bg-primary-active active:scale-[0.98] transition-all"
          >
            <Trophy size={18} />
            Start Challenge
          </Link>
        )}
      </div>
    </article>
  );
}
