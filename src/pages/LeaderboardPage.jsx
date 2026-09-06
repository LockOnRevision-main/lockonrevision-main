import { ChevronLeft, ChevronRight, Medal, RefreshCcw, Search, Trophy, User, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getLeaderboardUsers, subscribeToLeaderboard, findUserPage } from "../services/leaderboardService.js";
import { useAuth } from "../context/AuthContext.jsx";
import { getLeaderAvatar } from "../utils/avatar.js";
import { ProfileIconRenderer } from "../components/Profile/ProfileIconPicker.jsx";

const PAGE_SIZE = 20;

export function LeaderboardPage() {
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const currentUserId = user?.uid || profile?.id;

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const listRef = useRef(null);

  const fetchPage = useCallback(async (p, q) => {
    setLoading(true);
    setError("");
    try {
      const res = await getLeaderboardUsers({ page: p, pageSize: PAGE_SIZE, search: q });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(page, search);
  }, [page, search, refreshKey, fetchPage]);

  useEffect(() => {
    const unsub = subscribeToLeaderboard(() => {
      setRefreshKey((k) => k + 1);
    });
    return unsub;
  }, []);

  function handleSearch(value) {
    setSearch(value);
    setPage(1);
  }

  function jumpToMyPosition() {
    if (!currentUserId) return;
    setSearch("");
    findUserPage(currentUserId, "", PAGE_SIZE).then((p) => {
      if (p !== null) {
        setPage(p);
        window.setTimeout(() => {
          listRef.current?.querySelector(`[data-user-id="${currentUserId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    });
  }

  const items = result?.items || [];
  const totalPages = result?.totalPages || 1;

  return (
    <div className="grid gap-8">
      <section className="rounded-3xl border border-border bg-surface p-8 shadow-sm">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-primary">{t("nav.leaderboard")}</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight text-text-primary">{t("Leaderboard")}</h1>
            <p className="mt-2 flex items-center gap-2 text-sm font-bold text-text-secondary">
              <Zap size={16} className="text-warning" />
              {t("(Energyx100)+XP")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {currentUserId ? (
              <button
                type="button"
                onClick={jumpToMyPosition}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 py-3 font-black text-text-primary shadow-sm transition-all hover:bg-surface hover:border-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <User size={17} />
                {t("Your Rank")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => { setRefreshKey((k) => k + 1); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-5 py-3 font-black text-text-primary shadow-sm transition-all hover:bg-surface hover:border-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <RefreshCcw size={17} className={loading ? "animate-spin" : ""} />
              {t("common.refresh")}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        <div className="relative">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t("Search by name or Id")}
            className="w-full rounded-xl border border-border bg-background py-3 pl-12 pr-4 text-sm font-bold text-text-primary outline-none transition-all placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm" ref={listRef}>
        <div className="grid grid-cols-[60px_44px_1fr_100px] gap-3 bg-background px-4 py-4 text-xs font-black uppercase tracking-widest text-text-muted border-b border-border sm:grid-cols-[80px_44px_1fr_160px] sm:px-6">
          <span>{t("Rank")}</span>
          <span className="text-center">{t("Avatar")}</span>
          <span>{t("Name")}</span>
          <span className="text-right text-[10px] sm:text-xs">{t("Score")}</span>
        </div>

        {loading && !result ? (
          <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
            <RefreshCcw size={28} className="animate-spin text-primary" />
            <p className="text-sm font-bold text-text-secondary">{t("common.loading")}</p>
          </div>
        ) : null}

        {error ? <p className="p-8 text-sm font-bold text-status-error text-center">{error}</p> : null}

        {!loading && !error && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
            <Trophy size={40} className="text-text-muted" />
            <p className="text-sm font-bold text-text-secondary">
              {search ? t("leaderboard.no_search_results") : t("leaderboard.no_entries")}
            </p>
          </div>
        ) : null}

        <div className="divide-y divide-border">
          {items.map((leader) => {
            const rank = leader._rank;
            const xp = Number(leader.xp || 0);
            const energy = Number(leader.energy || 0);
            const total = Number(leader._score) || Number(leader.totalScore || xp + energy * 100);
            const isCurrentUser = leader.id === currentUserId;
            const avatar = getLeaderAvatar(leader, leader.id);
            return (
              <article
                key={leader.id}
                data-user-id={leader.id}
                className={`grid grid-cols-[60px_44px_1fr_100px] items-center gap-3 px-4 py-3 transition-all sm:grid-cols-[80px_44px_1fr_160px] sm:px-6 ${
                  isCurrentUser
                    ? "bg-primary/5 ring-1 ring-inset ring-primary/30"
                    : "hover:bg-background/50"
                }`}
              >
                <div className="flex items-center gap-1 font-black text-text-primary sm:gap-2">
                  {rank <= 3 ? <Medal className="text-warning shrink-0" size={18} /> : null}
                  <span className="text-sm sm:text-base">{rank}</span>
                </div>

                <div className="flex items-center justify-center">
                  {avatar.type === "image" ? (
                    <img
                      src={avatar.src}
                      alt=""
                      className="h-10 w-10 rounded-xl border-2 border-border bg-background object-cover"
                    />
                  ) : avatar.type === "icon" ? (
                    <div className="h-10 w-10 rounded-xl border-2 border-border bg-background p-2">
                      <ProfileIconRenderer iconId={avatar.iconId} className="h-full w-full" />
                    </div>
                  ) : (
                    <div
                      className="h-10 w-10 rounded-xl border-2 border-border bg-background p-1.5"
                      dangerouslySetInnerHTML={{ __html: avatar.svg }}
                    />
                  )}
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-black text-text-primary text-sm sm:text-lg truncate">
                      {leader.name || leader.displayName || leader.username || leader.email?.split('@')[0] || t("common.learner")}
                      {isCurrentUser ? (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary">
                          {t("common.you")}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-text-secondary truncate">
                      {t("Energy", { xp: xp.toLocaleString(), energy })}
                    </p>
                  </div>
                </div>
                <p className="text-right text-sm font-black text-primary sm:text-xl">{total.toLocaleString()}{t("leaderboard.pts_suffix")}</p>
              </article>
            );
          })}
        </div>

        {totalPages > 1 ? (
          <div className="flex items-center justify-center gap-2 border-t border-border bg-background px-4 py-4 sm:px-6">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-black text-text-primary transition-all hover:bg-background hover:border-primary disabled:opacity-40 disabled:pointer-events-none"
            >
              <ChevronLeft size={14} />
              {t("common.back")}
            </button>
            <span className="px-4 text-xs font-bold text-text-secondary">
              {t("leaderboard.page_of", { page, totalPages })}
              {result ? <span className="ml-1 text-text-muted">{t("leaderboard.total_count", { total: result.total })}</span> : null}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs font-black text-text-primary transition-all hover:bg-background hover:border-primary disabled:opacity-40 disabled:pointer-events-none"
            >
              {t("common.next")}
              <ChevronRight size={14} />
            </button>
          </div>
        ) : null}

        {loading && result ? (
          <div className="flex items-center justify-center gap-2 border-t border-border bg-background px-4 py-3">
            <RefreshCcw size={14} className="animate-spin text-primary" />
            <span className="text-xs font-bold text-text-secondary">{t("common.updating")}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
