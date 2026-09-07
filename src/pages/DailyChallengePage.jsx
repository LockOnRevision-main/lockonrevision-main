import { ArrowLeft, Award, Brain, CheckCircle, Clock, Flame, Sparkles, Target, Trophy, XCircle, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { completeDailyChallenge, ensureDailyChallenge, getTodayDateString, subscribeDailyChallenge } from "../services/dailyChallengeService.js";
import { shuffleArray } from "../utils/shuffle.js";

function ProgressBar({ value }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-background border border-border">
      <div className="h-full bg-primary transition-all duration-500" style={{ width: `${value}%` }} />
    </div>
  );
}

function MultipleChoiceRenderer({ question, value, onChange, shuffled }) {
  return (
    <div>
      <h3 className="text-base font-bold text-text-primary mb-1">{question.question}</h3>
      {question.context && <p className="text-sm text-text-secondary mb-3 bg-background p-3 rounded-lg border border-border">{question.context}</p>}
      <div className="space-y-2">
        {shuffled.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`w-full p-3 text-left rounded-xl border-2 font-medium transition-all ${value === opt ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-text-secondary hover:border-primary/40"}`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function FillBlankRenderer({ question, value, onChange }) {
  return (
    <div>
      <h3 className="text-base font-bold text-text-primary mb-3">{question.question}</h3>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="Type your answer" className="w-full p-3 rounded-xl border-2 border-border bg-background focus:border-primary focus:outline-none text-text-primary" />
    </div>
  );
}

function TrueFalseRenderer({ question, value, onChange }) {
  return (
    <div>
      <h3 className="text-base font-bold text-text-primary mb-3">{question.question}</h3>
      <div className="flex gap-3">
        {["True", "False", "true", "false"].slice(0, 2).map((opt) => (
          <button key={opt} onClick={() => onChange(opt)} className={`flex-1 p-3 rounded-xl border-2 font-bold ${value === opt ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-text-secondary"}`}>{opt}</button>
        ))}
      </div>
    </div>
  );
}

function MatchRenderer({ pairs, value, onChange }) {
  const shuffledPairs = useMemo(() => shuffleArray(pairs || []), [pairs]);
  const leftShuffled = useMemo(() => shuffleArray(shuffledPairs.map((p) => p.left)), [shuffledPairs]);
  const rightShuffled = useMemo(() => shuffleArray(shuffledPairs.map((p) => p.right)), [shuffledPairs]);
  const [selectedLeft, setSelectedLeft] = useState(null);
  const [matches, setMatches] = useState([]);

  const leftRemaining = leftShuffled.filter((l) => !matches.find((m) => m.left.id === l.id));
  const rightRemaining = rightShuffled.filter((r) => !matches.find((m) => m.right.id === r.id));

  const commit = (newMatches) => {
    if (newMatches.length === pairs.length) {
      onChange(newMatches.map((m) => `${m.left.id}-${m.right.id}`).join(","));
    }
  };

  return (
    <div>
      <p className="text-sm text-text-secondary mb-3">Tap a left item, then its match on the right.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          {leftRemaining.map((item) => (
            <button key={item.id} onClick={() => setSelectedLeft(item)} className={`w-full p-3 text-left rounded-xl border-2 font-medium ${selectedLeft?.id === item.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-text-secondary"}`}>{item.text}</button>
          ))}
        </div>
        <div className="space-y-2">
          {rightRemaining.map((item) => (
            <button key={item.id} onClick={() => { if (selectedLeft) { const nm = [...matches, { left: selectedLeft, right: item }]; setMatches(nm); setSelectedLeft(null); commit(nm); } }} className="w-full p-3 text-left rounded-xl border-2 border-border bg-surface text-text-secondary hover:border-primary/40 font-medium">{item.text}</button>
          ))}
        </div>
      </div>
      {matches.length > 0 && <p className="mt-3 text-xs font-bold text-center text-status-success">{matches.length}/{pairs.length} matched</p>}
      {matches.length === pairs.length && <p className="mt-2 text-center text-xs text-text-muted">Answer recorded</p>}
    </div>
  );
}

function ExplainRenderer({ concept, rubric, sampleAnswer, value, onChange }) {
  return (
    <div>
      <h3 className="text-base font-bold text-text-primary mb-2">Explain: {concept}</h3>
      <p className="text-sm text-text-secondary mb-2">Cover these points:</p>
      <ul className="list-disc pl-5 text-sm text-text-secondary mb-3 bg-background p-3 rounded-xl border border-border">
        {(rubric || []).map((r, i) => <li key={i}>{r}</li>)}
      </ul>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={4} placeholder="Write your explanation (3-5 sentences)..." className="w-full p-3 rounded-xl border-2 border-border bg-background focus:border-primary focus:outline-none text-text-primary resize-none" />
      <details className="mt-3">
        <summary className="text-xs font-bold cursor-pointer text-primary">Show sample answer</summary>
        <p className="mt-2 text-sm text-text-secondary bg-card p-3 rounded-lg border border-border">{sampleAnswer}</p>
      </details>
      <p className="mt-2 text-xs text-text-muted">Self-assess: compare your answer to rubric, then mark as done below.</p>
    </div>
  );
}

export function DailyChallengePage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    setLoading(true);
    const unsub = subscribeDailyChallenge(user.uid, (doc) => {
      if (!cancelled && doc) { setChallenge(doc); setLoading(false); }
    });
    ensureDailyChallenge(user.uid, profile)
      .then((doc) => { if (!cancelled) { setChallenge(doc); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; unsub?.(); };
  }, [user?.uid]);

  const challengeData = challenge?.challengeData || {};
  const templateId = challengeData.templateId || challenge?.templateId || "mixedQuiz";

  const items = useMemo(() => {
    if (templateId === "matchFollowing" && challengeData.pairs) return [{ id: "match", type: "match", pairs: challengeData.pairs, question: challengeData.instructions || "Match the following" }];
    if (templateId === "explainConcept" && challengeData.concept) return [{ id: "explain", type: "explain", concept: challengeData.concept, rubric: challengeData.rubric, sampleAnswer: challengeData.sampleAnswer, instructions: challengeData.instructions }];
    if (templateId === "diagramLabeling" && challengeData.labels) {
      // Combine diagram + labels as one item + questions
      const base = [];
      base.push({ id: "diagram", type: "diagram", diagramDescription: challengeData.diagramDescription, labels: challengeData.labels, instructions: challengeData.instructions });
      if (Array.isArray(challengeData.questions)) base.push(...challengeData.questions.map((q, i) => ({ ...q, id: q.id || `q-${i}` })));
      return base;
    }
    if (Array.isArray(challengeData.questions) && challengeData.questions.length) return challengeData.questions.map((q, i) => ({ ...q, id: q.id || `q-${i}` }));
    if (Array.isArray(challengeData.items) && challengeData.items.length) return challengeData.items;
    // Fallback: treat challengeData itself as single item
    return [];
  }, [challengeData, templateId]);

  const currentItem = items[currentIdx];
  const progress = items.length ? ((currentIdx + 1) / items.length) * 100 : 0;

  // Shuffle per question for multiple choice
  const shuffledOptions = useMemo(() => {
    if (!currentItem || !currentItem.options) return [];
    return shuffleArray(currentItem.options);
  }, [currentItem?.id]);

  const setAnswer = useCallback((id, val) => {
    setAnswers((prev) => ({ ...prev, [id]: val }));
  }, []);

  const canProceed = useMemo(() => {
    if (!currentItem) return false;
    const v = answers[currentItem.id];
    if (currentItem.type === "explain") return typeof v === "string" && v.trim().length > 20;
    return v != null && String(v).trim().length > 0;
  }, [answers, currentItem]);

  const handleNext = () => {
    if (currentIdx < items.length - 1) setCurrentIdx((c) => c + 1);
    else setResult({ showReview: true });
  };

  const handleSubmit = async () => {
    if (!challenge || challenge.completed) return;
    setSubmitting(true);
    setError("");
    try {
      // Score calculation
      let correct = 0;
      let totalScored = 0;
      for (const item of items) {
        const userAns = answers[item.id];
        if (item.type === "explain" || item.type === "diagram" || item.type === "match") {
          // Explain/diagram/match: count as participation if answered
          if (userAns && String(userAns).trim().length > 5) { correct += 1; totalScored += 1; }
          else totalScored += 1;
          continue;
        }
        if (item.correctAnswer != null) {
          totalScored += 1;
          const norm = (s) => String(s || "").trim().toLowerCase();
          if (norm(userAns) === norm(item.correctAnswer)) correct += 1;
        } else {
          // No correct answer field – treat as participation
          if (userAns) { correct += 1; totalScored += 1; } else totalScored += 1;
        }
      }
      const score = totalScored ? Math.round((correct / totalScored) * 100) : 0;
      const perfect = score >= 100 || (totalScored > 0 && correct === totalScored);
      const res = await completeDailyChallenge(user.uid, challenge, score, perfect);
      if (!res.success && res.reason === "already-completed") {
        setResult({ already: true, score, correct, total: totalScored, perfect });
      } else {
        setResult({ success: true, score, correct, total: totalScored, perfect, xpReward: res.xpReward, energyReward: res.energyReward });
      }
      // Refresh challenge state
      const refreshed = await ensureDailyChallenge(user.uid, profile);
      setChallenge(refreshed);
    } catch (e) {
      setError(e.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6 flex flex-col items-center gap-3 min-h-[50vh] justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary/20 border-t-primary" />
        <p className="text-sm font-bold uppercase tracking-widest text-text-muted">Loading challenge…</p>
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-center">
        <p className="text-text-secondary mb-4">{error || "No challenge available."}</p>
        <Link to="/app" className="inline-flex items-center gap-2 text-primary font-bold"><ArrowLeft size={16} /> Back to Home</Link>
      </div>
    );
  }

  const completed = !!challenge.completed;

  // Completed view
  if (completed && !result?.showReview) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <button onClick={() => navigate("/app")} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-text-secondary hover:text-text-primary"><ArrowLeft size={16} /> Back</button>
        <div className="rounded-3xl border border-status-success/30 bg-status-success/10 p-8 text-center">
          <div className="mx-auto w-16 h-16 rounded-full bg-status-success/20 flex items-center justify-center text-status-success mb-4"><CheckCircle size={32} /></div>
          <h2 className="text-2xl font-black text-text-primary">Challenge Completed!</h2>
          <p className="text-text-secondary mt-1">{challenge.title} • {challenge.subject}</p>
          <div className="mt-6 flex justify-center gap-6">
            <div className="text-center"><div className="text-2xl font-black text-warning flex items-center gap-1 justify-center"><Zap size={20} />{challenge.xpAwarded ?? challenge.xpReward}</div><div className="text-xs font-bold uppercase tracking-widest text-text-muted">XP earned</div></div>
            <div className="text-center"><div className="text-2xl font-black text-primary flex items-center gap-1 justify-center"><Flame size={20} />{challenge.energyAwarded ?? challenge.energyReward}</div><div className="text-xs font-bold uppercase tracking-widest text-text-muted">Energy</div></div>
          </div>
          <p className="mt-4 text-xs text-text-muted">Come back tomorrow for a new personalized challenge. Streak preserved!</p>
          <div className="mt-6 flex gap-3 justify-center">
            <Link to="/app" className="px-6 py-2.5 rounded-xl bg-primary text-white font-black">Home</Link>
            <button onClick={() => setResult({ showReview: true })} className="px-6 py-2.5 rounded-xl border border-border bg-surface font-bold">Review Answers</button>
          </div>
        </div>

        {result?.showReview && (
          <div className="mt-6 space-y-3">
            <h3 className="font-black text-text-primary">Review</h3>
            {items.map((it, idx) => (
              <div key={it.id} className="p-4 rounded-xl border border-border bg-surface">
                <p className="font-bold text-text-primary text-sm mb-1">{idx + 1}. {it.question || it.concept || it.diagramDescription || it.instructions}</p>
                {it.explanation && <p className="text-xs text-text-secondary bg-background p-2 rounded-lg border border-border">{it.explanation}</p>}
                {it.correctAnswer && <p className="text-xs text-text-secondary mt-1">Answer: <span className="font-bold text-text-primary">{it.correctAnswer}</span></p>}
                {it.sampleAnswer && <p className="text-xs text-text-secondary mt-1">Sample: {it.sampleAnswer}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Review after submit (not yet marked completed but viewing results)
  if (result?.showReview && !completed) {
    // This is the pre-submit review step – actually show all items answered summary and submit button
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <button onClick={() => setResult(null)} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-text-secondary hover:text-text-primary"><ArrowLeft size={16} /> Back to questions</button>
        <h2 className="text-2xl font-black text-text-primary mb-4">Review your answers</h2>
        <div className="space-y-3 mb-6">
          {items.map((it, idx) => {
            const val = answers[it.id];
            return (
              <div key={it.id} className="p-4 rounded-xl border border-border bg-surface">
                <p className="font-bold text-text-primary text-sm">{idx + 1}. {it.question || it.concept || it.instructions}</p>
                <p className="text-sm text-text-secondary mt-1">Your answer: <span className="font-medium text-text-primary">{val ? String(val).slice(0, 200) : "— no answer —"}</span></p>
                {it.correctAnswer && <p className="text-xs text-text-muted">Correct: {it.correctAnswer}</p>}
              </div>
            );
          })}
        </div>
        <button onClick={handleSubmit} disabled={submitting} className="w-full py-3 rounded-xl bg-primary text-white font-black disabled:opacity-50 shadow-lg">
          {submitting ? "Submitting..." : "Submit Challenge"}
        </button>
        {error && <p className="mt-3 text-sm text-status-error text-center">{error}</p>}
      </div>
    );
  }

  if (result && (result.success || result.already)) {
    const { score, correct, total, xpReward, energyReward, perfect } = result;
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6 text-center">
        <div className={`mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-4 ${score >= 80 ? "bg-status-success/20 text-status-success" : score >= 50 ? "bg-warning/20 text-warning" : "bg-status-error/20 text-status-error"}`}>
          {score >= 50 ? <Trophy size={32} /> : <Target size={32} />}
        </div>
        <h2 className="text-3xl font-black text-text-primary">{score >= 100 ? "Perfect!" : score >= 80 ? "Great job!" : score >= 50 ? "Good effort!" : "Keep practicing!"}</h2>
        <p className="text-text-secondary mt-1">{correct}/{total} • {score}% {perfect ? "• Bonus XP!" : ""}</p>
        <div className="mt-6 flex justify-center gap-8">
          <div className="text-center"><div className="text-3xl font-black text-warning flex items-center gap-1 justify-center"><Zap size={22} />{xpReward ?? challenge.xpReward}</div><div className="text-xs font-bold uppercase tracking-widest text-text-muted">XP</div></div>
          <div className="text-center"><div className="text-3xl font-black text-primary flex items-center gap-1 justify-center"><Flame size={22} />{energyReward ?? challenge.energyReward}</div><div className="text-xs font-bold uppercase tracking-widest text-text-muted">Energy</div></div>
        </div>
        <div className="mt-8 flex gap-3 justify-center">
          <Link to="/app" className="px-6 py-3 rounded-xl bg-primary text-white font-black">Continue</Link>
          <button onClick={() => setResult({ showReview: true })} className="px-6 py-3 rounded-xl border border-border bg-surface font-bold">Review</button>
        </div>
      </div>
    );
  }

  // Active challenge UI
  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <button onClick={() => navigate("/app")} className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-text-secondary hover:text-text-primary"><ArrowLeft size={16} /> Back to Home</button>

      <div className="rounded-3xl border border-border bg-surface overflow-hidden shadow-sm mb-6">
        <div className="bg-gradient-to-r from-primary/10 to-secondary/10 px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-text-secondary">
            <Sparkles size={14} className="text-primary" /> Daily AI Challenge • {challenge.templateId || templateId}
          </div>
          <h1 className="text-xl font-black text-text-primary mt-1">{challenge.title}</h1>
          <p className="text-sm text-text-secondary">{challenge.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-3 py-1 text-xs font-bold"><Brain size={12} />{challenge.subject}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-background border border-border px-3 py-1 text-xs font-bold"><Clock size={12} />{challenge.estimatedTime}m</span>
            <span className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-black bg-primary/10 text-primary border-primary/20"><Target size={12} />{challenge.difficulty}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 border border-warning/20 px-3 py-1 text-xs font-black text-warning"><Zap size={12} />{challenge.xpReward} XP</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-black text-primary"><Flame size={12} />{challenge.energyReward} Energy</span>
          </div>
        </div>
        <div className="px-6 py-4">
          <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-text-muted mb-1">
            <span>Question {currentIdx + 1} of {items.length}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <ProgressBar value={progress} />
        </div>
      </div>

      {challengeData.passage && (
        <div className="mb-4 p-4 rounded-2xl border border-border bg-card">
          <h3 className="text-xs font-black uppercase tracking-widest text-text-secondary mb-2">Case Passage</h3>
          <p className="text-sm text-text-secondary leading-relaxed">{challengeData.passage}</p>
        </div>
      )}
      {challengeData.instructions && items.length > 1 && (
        <p className="mb-4 text-sm font-medium text-text-secondary bg-surface border border-border rounded-xl p-3">{challengeData.instructions}</p>
      )}

      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm mb-4">
        {currentItem ? (
          <>
            {currentItem.type === "match" && <MatchRenderer pairs={currentItem.pairs} value={answers[currentItem.id]} onChange={(v) => setAnswer(currentItem.id, v)} />}
            {currentItem.type === "explain" && <ExplainRenderer concept={currentItem.concept} rubric={currentItem.rubric} sampleAnswer={currentItem.sampleAnswer} value={answers[currentItem.id]} onChange={(v) => setAnswer(currentItem.id, v)} />}
            {currentItem.type === "diagram" && (
              <div>
                <h3 className="font-bold text-text-primary mb-2">{currentItem.instructions || "Diagram"}</h3>
                <p className="text-sm text-text-secondary bg-background p-3 rounded-lg border border-border mb-3">{currentItem.diagramDescription}</p>
                <div className="space-y-2">
                  {(currentItem.labels || []).map((lab) => (
                    <div key={lab.id} className="p-3 rounded-xl border border-border bg-card">
                      <p className="text-sm font-bold text-text-primary mb-2">{lab.label} ({lab.id})</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(lab.options || []).map((opt) => (
                          <button key={opt} onClick={() => setAnswer(`diagram-${lab.id}`, opt)} className={`p-2 rounded-lg border text-sm font-medium ${answers[`diagram-${lab.id}`] === opt ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-text-secondary"}`}>{opt}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(!currentItem.type || ["multipleChoice", "shortAnswer", "fillBlank", "trueFalse"].includes(currentItem.type) || currentItem.options) && (
              <>
                {currentItem.type === "fillBlank" && <FillBlankRenderer question={currentItem} value={answers[currentItem.id]} onChange={(v) => setAnswer(currentItem.id, v)} />}
                {currentItem.type === "trueFalse" && <TrueFalseRenderer question={currentItem} value={answers[currentItem.id]} onChange={(v) => setAnswer(currentItem.id, v)} />}
                {currentItem.type === "shortAnswer" && <FillBlankRenderer question={currentItem} value={answers[currentItem.id]} onChange={(v) => setAnswer(currentItem.id, v)} />}
                {(!currentItem.type || currentItem.type === "multipleChoice") && currentItem.options && <MultipleChoiceRenderer question={currentItem} value={answers[currentItem.id]} onChange={(v) => setAnswer(currentItem.id, v)} shuffled={shuffledOptions} />}
                {!currentItem.options && !currentItem.type && currentItem.question && <FillBlankRenderer question={currentItem} value={answers[currentItem.id]} onChange={(v) => setAnswer(currentItem.id, v)} />}
              </>
            )}
            {/* Generic fallback: if item has question but no known type */}
            {currentItem.question && !currentItem.options && !["match", "explain", "diagram", "fillBlank", "trueFalse", "shortAnswer", "multipleChoice"].includes(currentItem.type) && (
              <FillBlankRenderer question={currentItem} value={answers[currentItem.id]} onChange={(v) => setAnswer(currentItem.id, v)} />
            )}
          </>
        ) : (
          <p className="text-sm text-text-muted">No questions in this challenge.</p>
        )}
      </div>

      <div className="flex justify-between gap-3">
        <button onClick={() => setCurrentIdx((c) => Math.max(0, c - 1))} disabled={currentIdx === 0} className="px-5 py-3 rounded-xl border border-border bg-surface font-bold disabled:opacity-40">Back</button>
        {currentIdx < items.length - 1 ? (
          <button onClick={handleNext} disabled={!canProceed} className="px-6 py-3 rounded-xl bg-primary text-white font-black disabled:opacity-40 flex items-center gap-2 shadow-md">
            Next
          </button>
        ) : (
          <button onClick={() => setResult({ showReview: true })} disabled={Object.keys(answers).length === 0} className="px-6 py-3 rounded-xl bg-primary text-white font-black disabled:opacity-40 shadow-md">
            Review & Submit
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-status-error text-center">{error}</p>}
    </div>
  );
}
