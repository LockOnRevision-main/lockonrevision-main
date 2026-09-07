import { Award, BookOpen, CalendarDays, CheckCircle2, Clock, ListChecks, Medal, Target, Trophy, Zap, AlertTriangle, GraduationCap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { StatCard } from "../components/StatCard.jsx";
import { LeaderboardPreview } from "../components/LeaderboardPreview.jsx";
import { DailyChallengeCard } from "../components/DailyChallengeCard.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { subscribeSubjects, subscribeUserCollection } from "../services/learningService.js";
import { getTopLeaderboardUsers } from "../services/leaderboardService.js";
import { getTodaySessions, getUpcomingLessons, getWeeklyCompletion, getRemainingWorkload, subscribeTimetables, getNextExam, getUpcomingDeadlines, getSyllabusProgress, getLastUpdatedTimestamp } from "../services/timetableService.js";

function scoreBreakdown(profile) {
  const xp = Number(profile?.xp || 0);
  const energy = Number(profile?.energy || 0);
  return {
    xp,
    energy,
    totalScore: xp + energy * 100,
  };
}

export function AppPage() {
  const { isFirebaseConfigured, profile, user } = useAuth();
  const { t } = useTranslation();
  const [subjects, setSubjects] = useState([]);
  const [units, setUnits] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [timetables, setTimetables] = useState([]);
  const [leaderboardUsers, setLeaderboardUsers] = useState([]);
  const [leaderboardKey, setLeaderboardKey] = useState(0);
  const score = scoreBreakdown(profile);

  const activeTimetable = timetables[0];

  const todaySessions = useMemo(() => activeTimetable ? getTodaySessions(activeTimetable) : [], [activeTimetable]);
  const upcomingLessons = useMemo(() => activeTimetable ? getUpcomingLessons(activeTimetable, 4) : [], [activeTimetable]);
  const weeklyCompletion = useMemo(() => activeTimetable ? getWeeklyCompletion(activeTimetable) : { completed: 0, total: 0, percent: 0 }, [activeTimetable]);
  const remainingWorkload = useMemo(() => activeTimetable ? getRemainingWorkload(activeTimetable) : { totalMinutes: 0, bySubject: [] }, [activeTimetable]);
  const nextExam = useMemo(() => activeTimetable ? getNextExam(activeTimetable) : null, [activeTimetable]);
  const upcomingDeadlines = useMemo(() => activeTimetable ? getUpcomingDeadlines(activeTimetable, 4) : [], [activeTimetable]);
  const syllabusProgress = useMemo(() => activeTimetable ? getSyllabusProgress(activeTimetable) : null, [activeTimetable]);
  const lastUpdated = useMemo(() => activeTimetable ? getLastUpdatedTimestamp(activeTimetable) : null, [activeTimetable]);

  useEffect(() => {
    if (!user?.uid) return;

    const subSubjects = subscribeSubjects(user.uid, setSubjects);
    const subUnits = subscribeUserCollection(user.uid, "units", setUnits);
    const subLessons = subscribeUserCollection(user.uid, "lessons", setLessons);
    const subTts = subscribeTimetables(user.uid, setTimetables);

    return () => {
      subSubjects();
      subUnits();
      subLessons();
      subTts();
    };
  }, [user?.uid]);

  useEffect(() => {
    getTopLeaderboardUsers().then((users) => setLeaderboardUsers(users)).catch(() => {});
  }, [user?.uid, profile?.totalScore, leaderboardKey]);

  useEffect(() => {
    const interval = window.setInterval(() => setLeaderboardKey((k) => k + 1), 30000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="grid gap-8">
<section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
        <div className="bg-gradient-to-r from-secondary to-primary p-10 text-text-primary">
          <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t("dashboard.title")}</p>
          <div className="mt-4 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="flex flex-col gap-2">
              <h1 className="text-4xl font-black tracking-tight text-text-primary">{t("dashboard.welcome", { name: profile?.name || "Learner" })}</h1>
              <p className="max-w-2xl text-text-primary/85 text-lg">{t("dashboard.welcome_subtitle")}</p>
            </div>
            <Link
              to="/leaderboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-secondary px-6 py-3 font-black text-white shadow-lg transition-all hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <Trophy size={18} />
              {t("nav.leaderboard")}
            </Link>
          </div>
        </div>
      </section>

      {!isFirebaseConfigured ? (
        <p className="rounded-xl border border-border bg-card p-4 text-sm font-bold text-text-primary shadow-sm">
          {t("dashboard.config_missing")}
        </p>
      ) : null}

      <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label={t("dashboard.xp")} value={score.xp.toLocaleString()} helper={t("dashboard.learning_progress")} tone="bg-surface" />
        <StatCard label={t("dashboard.energy")} value={String(score.energy)} helper={t("dashboard.energy_helper")} tone="bg-card" />
        <StatCard label={t("dashboard.total_score")} value={score.totalScore.toLocaleString()} helper={t("dashboard.xp_energy_bonus")} tone="bg-surface" />
        <StatCard label={t("dashboard.streak")} value={`${profile?.currentStreak ?? profile?.streak ?? 0} ${t("common.days")}`} helper={t("dashboard.lessons_completed")} tone="bg-card" />
        <StatCard
          label={t("dashboard.completed")}
          value={`${profile?.completedLessons || 0}`}
          helper={t("dashboard.lessons_completed_count", { count: profile?.completedLessons || 0 })}
          tone="bg-surface"
        />
      </section>

      {/* Daily AI Challenge */}
      <DailyChallengeCard />

      {/* Last updated timestamp */}
      {activeTimetable && lastUpdated && (
        <p className="text-xs text-text-muted text-right -mt-4">Last updated: {new Date(lastUpdated).toLocaleString()} • <Link to="/timetable" className="text-primary font-bold hover:underline">Manage timetable</Link></p>
      )}

      {/* Exam countdown + Syllabus progress + Deadlines row */}
      {activeTimetable && (nextExam || syllabusProgress || upcomingDeadlines.length > 0) && (
        <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {/* Next Exam Countdown */}
          <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm flex flex-col">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-status-error/10 p-2 text-status-error shrink-0">
                <GraduationCap size={20} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">Next Exam</p>
                <h3 className="text-lg font-black tracking-tight text-text-primary">{nextExam ? nextExam.subject : "No exams scheduled"}</h3>
              </div>
            </div>
            {nextExam ? (
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={`text-4xl font-black tracking-tighter ${nextExam.diffDays <= 3 ? "text-status-error" : nextExam.diffDays <= 7 ? "text-warning" : "text-text-primary"}`}>{nextExam.diffDays}</span>
                  <span className="text-sm font-bold text-text-muted">{nextExam.diffDays === 0 ? "Today!" : nextExam.diffDays === 1 ? "day left" : "days left"}</span>
                </div>
                <p className="mt-1 text-sm text-text-secondary">{new Date(nextExam.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })} • {nextExam.type}</p>
                {nextExam.diffDays <= 7 && (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-status-error/10 border border-status-error/20 px-2 py-1 text-xs font-bold text-status-error"><AlertTriangle size={12} /> Upcoming soon</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-text-muted flex-1">Add exam dates in Timetable to see countdown.</p>
            )}
            <Link to="/timetable" className="mt-4 text-xs font-bold text-primary underline underline-offset-2">View all deadlines →</Link>
          </article>

          {/* Syllabus Progress */}
          <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm flex flex-col">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary shrink-0">
                <BookOpen size={20} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">Syllabus Progress</p>
                <h3 className="text-lg font-black tracking-tight text-text-primary">{syllabusProgress ? `${syllabusProgress.percent}%` : "—"}</h3>
              </div>
            </div>
            {syllabusProgress ? (
              <div className="flex-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-background border border-border">
                  <div className="h-full bg-primary transition-all duration-500" style={{ width: `${syllabusProgress.percent}%` }} />
                </div>
                <p className="mt-1 text-xs text-text-secondary">{syllabusProgress.completed}/{syllabusProgress.total} sessions completed</p>
                {syllabusProgress.bySubject.slice(0, 3).map((s) => (
                  <div key={s.subject} className="mt-2 flex justify-between text-xs">
                    <span className="truncate text-text-secondary">{s.subject}</span>
                    <span className="font-bold text-text-primary">{s.percent}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted flex-1">Upload syllabus to track progress.</p>
            )}
            <Link to="/timetable" className="mt-4 text-xs font-bold text-primary underline underline-offset-2">View timetable →</Link>
          </article>

          {/* Upcoming Deadlines */}
          <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm flex flex-col">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-warning/10 p-2 text-warning shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">Upcoming Deadlines</p>
                <h3 className="text-lg font-black tracking-tight text-text-primary">Deadlines</h3>
              </div>
            </div>
            {upcomingDeadlines.length > 0 ? (
              <div className="space-y-2 flex-1">
                {upcomingDeadlines.map((d, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-text-primary">{d.subject}</p>
                      <p className="text-xs text-text-muted">{d.type} • {new Date(d.date + "T00:00:00").toLocaleDateString()}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-black ${d.diffDays <= 3 ? "bg-status-error/15 text-status-error" : d.diffDays <= 7 ? "bg-warning/15 text-warning" : "bg-surface border border-border text-text-muted"}`}>{d.diffDays === 0 ? "Today" : `${d.diffDays}d`}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted flex-1">No upcoming deadlines.</p>
            )}
            <Link to="/timetable" className="mt-4 text-xs font-bold text-primary underline underline-offset-2">View timetable →</Link>
          </article>
        </section>
      )}

      {/* Timetable dashboard row */}
      {activeTimetable ? (
        <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {/* Today's Study */}
          <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm transition-all hover:shadow-md h-full flex flex-col">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary shrink-0">
                <Clock size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t("timetable.todays_study")}</p>
                <h3 className="text-lg font-black tracking-tight text-text-primary">{t("timetable.sessions")}</h3>
              </div>
            </div>
            {todaySessions.length > 0 ? (
              <div className="space-y-2 flex-1">
                {todaySessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-text-primary">{s.subject}</p>
                      <p className="text-xs text-text-muted">{s.topic !== s.subject ? s.topic : ""} &middot; {s.duration}m</p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-text-muted whitespace-nowrap">{s.timeSlot}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-text-muted flex-1 flex items-center justify-center">{t("timetable.all_done")}</p>
            )}
            <div className="mt-4 pt-4 border-t border-border">
              <Link to="/timetable" className="text-xs font-bold text-primary underline underline-offset-2 hover:text-secondary inline-flex items-center gap-1">
                {t("timetable.view_full")}
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </article>

          {/* Upcoming Lessons */}
          <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm transition-all hover:shadow-md h-full flex flex-col">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary shrink-0">
                <ListChecks size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t("timetable.upcoming")}</p>
                <h3 className="text-lg font-black tracking-tight text-text-primary">{t("Timetable")}</h3>
              </div>
            </div>
            {upcomingLessons.length > 0 ? (
              <div className="space-y-2 flex-1">
                {upcomingLessons.map((s, i) => (
                  <div key={s.id || i} className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-text-primary">{s.subject}</p>
                      <p className="text-xs text-text-muted">{s.date} &middot; {s.timeSlot}</p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-text-muted whitespace-nowrap">{s.duration}m</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-text-muted flex-1 flex items-center justify-center">{t("timetable.no_upcoming")}</p>
            )}
            <div className="mt-4 pt-4 border-t border-border">
              <Link to="/timetable" className="text-xs font-bold text-primary underline underline-offset-2 hover:text-secondary inline-flex items-center gap-1">
                {t("timetable.view_full")}
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </div>
          </article>

          {/* Weekly Completion */}
          <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm transition-all hover:shadow-md h-full flex flex-col">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary shrink-0">
                <CalendarDays size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t("timetable.weekly")}</p>
                <h3 className="text-lg font-black tracking-tight text-text-primary">{t("timetable.completion")}</h3>
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black tracking-tighter text-text-primary">{weeklyCompletion.percent}%</span>
              <span className="text-sm text-text-muted">{t("timetable.percent_done")}</span>
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              {weeklyCompletion.completed}/{weeklyCompletion.total} {t("timetable.sessions_word")}
            </p>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-background border border-border flex-1">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${weeklyCompletion.percent}%` }}
              />
            </div>
          </article>

          {/* Remaining Workload */}
          <article className="rounded-3xl border border-border bg-surface p-6 shadow-sm transition-all hover:shadow-md h-full flex flex-col">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2 text-primary shrink-0">
                <BookOpen size={20} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t("timetable.remaining")}</p>
                <h3 className="text-lg font-black tracking-tight text-text-primary">{t("timetable.workload")}</h3>
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-black tracking-tighter text-text-primary">
                {Math.round(remainingWorkload.totalMinutes / 60)}h
              </span>
              <span className="text-sm text-text-muted">{t("timetable.minutes_left", { minutes: remainingWorkload.totalMinutes % 60 })}</span>
            </div>
            {remainingWorkload.bySubject.length > 0 ? (
              <div className="mt-3 space-y-1 flex-1">
                {remainingWorkload.bySubject.slice(0, 3).map((s) => (
                  <div key={s.subject} className="flex justify-between text-xs text-text-secondary">
                    <span className="truncate">{s.subject}</span>
                    <span className="font-medium whitespace-nowrap">{Math.round(s.minutes / 60)}h {s.minutes % 60}m</span>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        </section>
      ) : (
        <Link
          to="/timetable"
          className="group flex items-center justify-between rounded-3xl border-2 border-dashed border-border bg-surface/50 p-6 text-left transition-all hover:border-primary/50 hover:bg-surface"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <CalendarDays size={24} />
            </div>
            <div>
              <p className="text-lg font-black tracking-tight text-text-primary">{t("timetable.create_timetable")}</p>
              <p className="text-sm text-text-secondary">{t("timetable.create_subtitle")}</p>
            </div>
          </div>
          <span className="rounded-xl bg-primary px-5 py-2.5 text-xs font-black text-white transition-all group-hover:bg-primary-active">
            {t("common.create")}
          </span>
        </Link>
      )}

      <section className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
<article className="rounded-3xl border border-border bg-surface p-8 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1 h-full flex flex-col">
            <div className="mb-6 flex items-center gap-4">
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                <Trophy size={24} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t("nav.leaderboard")}</p>
                <h2 className="text-2xl font-black tracking-tight text-text-primary">{t("Leaderboard")}</h2>
              </div>
            </div>

            {leaderboardUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center flex-1">
                <Medal size={40} className="text-text-muted" />
                <p className="mt-4 text-sm font-bold text-text-secondary">{t("common.loading")}</p>
              </div>
            ) : (
              <div className="flex-1">
                <LeaderboardPreview
                  users={leaderboardUsers}
                  currentUserId={user?.uid || profile?.id}
                />
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-border">
              <Link
                to="/leaderboard"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-secondary px-6 py-3 font-black text-white shadow-lg transition-all hover:bg-secondary/90 active:scale-95"
              >
                <Trophy size={16} />
                {t("View Full Leaderboard")}
              </Link>
            </div>
          </article>

<article className="rounded-3xl border border-border bg-surface p-8 shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-1 h-full flex flex-col">
           <div className="mb-8 flex items-center gap-4">
             <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
               <Award size={24} />
             </div>
             <div className="min-w-0">
               <p className="text-xs font-bold uppercase tracking-widest text-text-secondary">{t("dashboard.my_subjects")}</p>
               <h2 className="text-2xl font-black tracking-tight text-text-primary">{t("dashboard.continue_learning")}</h2>
             </div>
           </div>
  
           {subjects.length === 0 ? (
             <div className="flex flex-col items-center justify-center py-16 text-center flex-1">
               <div className="mb-6 rounded-full bg-background p-6 text-text-muted border border-border">
                 <Target size={48} />
               </div>
               <h3 className="text-2xl font-black text-text-primary">{t("forge.no_subjects")}</h3>
               <p className="mt-3 max-w-xs text-sm text-text-secondary leading-relaxed">
                 {t("dashboard.no_subjects_desc")}
               </p>
                <Link
                   to="/forge"
                   className="mt-8 inline-flex items-center justify-center rounded-xl bg-secondary px-8 py-3 font-black text-white shadow-lg transition-all hover:bg-primary hover:scale-105 active:scale-95"
                 >
                   {t("dashboard.open_forge")}
                 </Link>
  
             </div>
           ) : (
             <div className="grid gap-5 flex-1">
               {subjects.map((subject) => {
                 const subjectLessons = lessons.filter((l) => l.subjectId === subject.id);
                 const completedLessons = subjectLessons.filter((l) => l.completed);
                 const progress = subjectLessons.length
                   ? Math.round((completedLessons.length / subjectLessons.length) * 100)
                   : 0;
                 const xp = completedLessons.reduce((sum, l) => sum + (l.xpEarned || 0), 0);
                 const firstIncomplete = subjectLessons.find((l) => !l.completed);
                 const currentUnit = firstIncomplete
                   ? units.find((u) => u.id === firstIncomplete.unitId)?.title || t("common.unit_1")
                   : t("lesson.completed");
   
                 return (
                   <Link
                     key={subject.id}
                     to="/forge"
                     className="group flex items-start justify-between gap-4 rounded-2xl border border-border p-5 text-left transition-all hover:border-primary hover:bg-background shadow-sm h-full"
                   >
                     <div className="flex-1 min-w-0">
                       <div className="flex items-center gap-2">
                         <span className="truncate font-black text-text-primary text-lg">{subject.title}</span>
                         {progress === 100 && (
                           <CheckCircle2 size={16} className="shrink-0 text-status-success" />
                         )}
                       </div>
                       <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold text-text-secondary">
                         <span className="flex items-center gap-1.5">
                           <Target size={12} className="text-primary" /> {currentUnit}
                         </span>
                          <span className="flex items-center gap-1.5">
                            <Zap size={12} className="text-warning" /> {xp} XP
                          </span>
   
                         <span className="flex items-center gap-1.5">
                           <Award size={12} className="text-primary" /> {progress}%
                         </span>
                       </div>
                       <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-background border border-border">
                         <div
                           className="h-full bg-primary transition-all duration-500"
                           style={{ width: `${progress}%` }}
                         />
                       </div>
                     </div>
                     <div className="shrink-0 mt-1">
                        <button
                           type="button"
                           className="rounded-xl bg-primary px-5 py-2.5 text-xs font-black text-white transition-all duration-150 active:scale-95 group-hover:bg-primary-active shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                         >
                           {t("lesson.continue")}
                         </button>
   
                     </div>
                   </Link>
                 );
               })}
             </div>
           )}
            <div className="mt-8 pt-6 border-t border-border rounded-2xl bg-gradient-to-r from-surface to-card p-0 shadow-sm">
              <div className="flex items-center gap-3 font-black text-text-primary p-6">
                <Zap size={20} className="text-warning" />
                {t("dashboard.total_score_formula")}
              </div>
            </div>
         </article>

      </section>
    </div>
  );
}
