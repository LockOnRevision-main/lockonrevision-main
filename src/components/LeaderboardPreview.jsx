import { Medal, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getLeaderAvatar } from "../utils/avatar.js";
import { ProfileIconRenderer } from "./Profile/ProfileIconPicker.jsx";

function buildPreviewEntries(users, currentUserId) {
  if (!users.length) return [];

  const currentUser = users.find((u) => u.id === currentUserId);
  if (!currentUser) return users.slice(0, 3).map((u) => ({ ...u, _isCurrentUser: false }));

  const uIdx = users.findIndex((u) => u.id === currentUserId);
  const seen = new Set();
  const entries = [];

  function addUser(user) {
    if (seen.has(user.id)) return;
    seen.add(user.id);
    entries.push({ ...user, _isCurrentUser: user.id === currentUserId });
  }

  // Top 3 users
  for (let i = 0; i < Math.min(3, users.length); i++) {
    addUser(users[i]);
  }

  // Up to 3 users above current user
  const aboveStart = Math.max(3, uIdx - 3);
  for (let i = aboveStart; i < uIdx; i++) {
    addUser(users[i]);
  }

  // Current user
  addUser(currentUser);

  // Up to 3 users below current user
  const belowEnd = Math.min(users.length, uIdx + 4);
  for (let i = uIdx + 1; i < belowEnd; i++) {
    addUser(users[i]);
  }

  return entries;
}

export function LeaderboardPreview({ users, currentUserId }) {
  const { t } = useTranslation();
  const previewEntries = buildPreviewEntries(users, currentUserId);

  if (!previewEntries.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Medal size={40} className="text-text-muted" />
        <p className="mt-4 text-sm font-bold text-text-secondary">{t("leaderboard.no_ranks")}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-background overflow-hidden">
      {previewEntries.map((entry) => {
        const rank = entry._rank;
        const xp = Number(entry.xp || 0);
        const energy = Number(entry.energy || 0);
        const total = Number(entry._score) || Number(entry.totalScore || xp + energy * 100);
        const isCurrentUser = entry._isCurrentUser;

        const avatar = getLeaderAvatar(entry, entry.id);
        return (
          <div
            key={entry.id}
            className={`flex items-center gap-4 px-4 py-3.5 transition-all ${
              isCurrentUser
                ? "bg-primary/5 ring-1 ring-inset ring-primary/30"
                : "hover:bg-background/50"
            }`}
          >
            <div className="flex w-10 shrink-0 items-center justify-center font-black text-text-primary text-sm">
              {rank <= 3 ? <Medal className="text-warning shrink-0" size={16} /> : <Trophy className="text-text-muted shrink-0" size={14} />}
              <span className="ml-1.5 tabular-nums">{rank}</span>
            </div>

            <div className="shrink-0">
              {avatar.type === "image" ? (
                <img
                  src={avatar.src}
                  alt=""
                  className="h-9 w-9 rounded-xl border-2 border-border bg-background object-cover"
                />
              ) : avatar.type === "icon" ? (
                <div className="h-9 w-9 rounded-xl border-2 border-border bg-background p-1.5">
                  <ProfileIconRenderer iconId={avatar.iconId} className="h-full w-full" />
                </div>
              ) : (
                <div
                  className="h-9 w-9 rounded-xl border-2 border-border bg-background p-1"
                  dangerouslySetInnerHTML={{ __html: avatar.svg }}
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm font-black text-text-primary">
                {entry.name || entry.displayName || entry.username || entry.email?.split("@")[0] || t("common.learner")}
                {isCurrentUser ? (
                  <span className="shrink-0 inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-primary">
                    {t("common.you")}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {t("Energy", { xp: xp.toLocaleString(), energy })}
              </p>
            </div>

            <div className="shrink-0 text-right w-24">
              <span className="text-sm font-black text-primary tabular-nums">{total.toLocaleString()}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
