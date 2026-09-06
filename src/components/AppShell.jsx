import { CalendarDays, KeyRound, LogOut, Hammer, Trophy, User, X, Menu } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AiSidebar } from "./AiSidebar.jsx";
import { Logo } from "./Logo.jsx";
import { PasswordInput } from "./PasswordInput.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { canAccessAdmin } from "../utils/permissions.js";

export function AppShell({ children }) {
  const { t } = useTranslation();
  const { isFirebaseConfigured, changePassword, logout, profile, user } = useAuth();
  const showAdmin = canAccessAdmin(profile, user?.email);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  async function handleChangePassword(e) {
    e.preventDefault();
    setPwError("");
    setPwSuccess("");
    if (newPassword.length < 8) { setPwError(t("app_shell.password_min_error")); return; }
    setPwBusy(true);
    try {
      await changePassword(newPassword);
      setPwSuccess(t("app_shell.password_changed"));
      setNewPassword("");
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-text-primary">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
            <NavLink to="/app" className="group flex items-center gap-2 sm:gap-4 transition-opacity hover:opacity-90 shrink-0">
              <div className="h-9 w-9 sm:h-11 sm:w-11 overflow-hidden rounded-xl bg-secondary shadow-lg shadow-secondary/20 transition-transform group-hover:scale-110">
                <Logo variant="icon" className="h-full w-full" />
              </div>
              <div className="flex-col hidden sm:flex">
                <p className="font-black tracking-tight text-text-primary leading-none text-sm sm:text-base">{t("app.name")}</p>
                <p className="text-xs font-medium text-text-secondary mt-1">{profile?.name || t("app_shell.local_learner")}</p>
              </div>
            </NavLink>
 
            {/* Desktop nav – hidden on <md to prevent horizontal scroll */}
            <nav className="hidden md:flex items-center gap-1 sm:gap-2">
              <NavLink to="/app" className={({ isActive }) => `rounded-lg px-2 sm:px-4 py-2 min-h-[44px] inline-flex items-center text-xs sm:text-sm font-bold transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isActive ? "bg-primary text-white shadow-md" : "text-text-secondary hover:bg-surface hover:text-text-primary"}`}>{t("nav.dashboard")}</NavLink>
              <NavLink to="/forge" className={({ isActive }) => `inline-flex items-center gap-1 sm:gap-2 rounded-lg px-2 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm font-bold transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isActive ? "bg-primary text-white shadow-md" : "text-text-secondary hover:bg-surface hover:text-text-primary"}`}><Hammer size={14} className="sm:size-[16px]" /><span>{t("nav.forge")}</span></NavLink>
              <NavLink to="/timetable" className={({ isActive }) => `inline-flex items-center gap-1 sm:gap-2 rounded-lg px-2 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm font-bold transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isActive ? "bg-primary text-white shadow-md" : "text-text-secondary hover:bg-surface hover:text-text-primary"}`}><CalendarDays size={14} className="sm:size-[16px]" /><span>{t("nav.timetable")}</span></NavLink>
              <NavLink to="/leaderboard" className={({ isActive }) => `inline-flex items-center gap-1 sm:gap-2 rounded-lg px-2 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm font-bold transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isActive ? "bg-primary text-white shadow-md" : "text-text-secondary hover:bg-surface hover:text-text-primary"}`}><Trophy size={14} className="sm:size-[16px]" /><span>{t("nav.leaderboard")}</span></NavLink>
              <NavLink to="/profile" className={({ isActive }) => `inline-flex items-center gap-1 sm:gap-2 rounded-lg px-2 sm:px-4 py-2 min-h-[44px] text-xs sm:text-sm font-bold transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isActive ? "bg-primary text-white shadow-md" : "text-text-secondary hover:bg-surface hover:text-text-primary"}`}><User size={14} className="sm:size-[16px]" /><span>{t("nav.profile")}</span></NavLink>
              {showAdmin ? <NavLink to="/admin" className={({ isActive }) => `rounded-lg px-2 sm:px-4 py-2 min-h-[44px] inline-flex items-center text-xs sm:text-sm font-bold transition-all whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isActive ? "bg-primary text-white shadow-md" : "text-text-secondary hover:bg-surface hover:text-text-primary"}`}>{t("nav.admin")}</NavLink> : null}
              {isFirebaseConfigured ? (<><button type="button" onClick={() => { setShowChangePw(true); setPwError(""); setPwSuccess(""); setNewPassword(""); }} className="rounded-lg border border-border bg-surface p-1.5 sm:p-2 min-h-[44px] min-w-[44px] text-text-secondary shadow-sm transition-all hover:bg-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 shrink-0" aria-label={t("profile.change_password")}><KeyRound size={16} className="sm:size-[18px]" /></button><button type="button" onClick={logout} className="rounded-lg border border-border bg-surface p-1.5 sm:p-2 min-h-[44px] min-w-[44px] text-text-secondary shadow-sm transition-all hover:bg-primary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 shrink-0" aria-label={t("nav.logout")}><LogOut size={16} className="sm:size-[18px]" /></button></>) : null}
            </nav>
            {/* Mobile hamburger – prevents horizontal scroll, ensures tappable 44px */}
            <button type="button" onClick={() => setMobileOpen(v=>!v)} className="md:hidden inline-flex items-center justify-center rounded-xl border border-border bg-surface p-2 min-h-[44px] min-w-[44px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="mobile-nav">
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
        </div>
        {/* Mobile drawer – fluid, no horizontal scroll */}
        {mobileOpen ? (
          <nav id="mobile-nav" className="md:hidden border-t border-border bg-surface px-4 py-4 flex flex-col gap-2" role="navigation" aria-label="Mobile">
            <NavLink to="/app" onClick={()=>setMobileOpen(false)} className={({isActive})=>`rounded-xl px-4 py-3 min-h-[44px] text-sm font-bold ${isActive ? "bg-primary text-white" : "bg-background text-text-secondary"}`}>{t("nav.dashboard")}</NavLink>
            <NavLink to="/forge" onClick={()=>setMobileOpen(false)} className={({isActive})=>`rounded-xl px-4 py-3 min-h-[44px] text-sm font-bold flex items-center gap-2 ${isActive ? "bg-primary text-white" : "bg-background text-text-secondary"}`}><Hammer size={16}/>{t("nav.forge")}</NavLink>
            <NavLink to="/timetable" onClick={()=>setMobileOpen(false)} className={({isActive})=>`rounded-xl px-4 py-3 min-h-[44px] text-sm font-bold flex items-center gap-2 ${isActive ? "bg-primary text-white" : "bg-background text-text-secondary"}`}><CalendarDays size={16}/>{t("nav.timetable")}</NavLink>
            <NavLink to="/leaderboard" onClick={()=>setMobileOpen(false)} className={({isActive})=>`rounded-xl px-4 py-3 min-h-[44px] text-sm font-bold flex items-center gap-2 ${isActive ? "bg-primary text-white" : "bg-background text-text-secondary"}`}><Trophy size={16}/>{t("nav.leaderboard")}</NavLink>
            <NavLink to="/profile" onClick={()=>setMobileOpen(false)} className={({isActive})=>`rounded-xl px-4 py-3 min-h-[44px] text-sm font-bold flex items-center gap-2 ${isActive ? "bg-primary text-white" : "bg-background text-text-secondary"}`}><User size={16}/>{t("nav.profile")}</NavLink>
            {showAdmin ? <NavLink to="/admin" onClick={()=>setMobileOpen(false)} className={({isActive})=>`rounded-xl px-4 py-3 min-h-[44px] text-sm font-bold ${isActive ? "bg-primary text-white" : "bg-background text-text-secondary"}`}>{t("nav.admin")}</NavLink> : null}
            {isFirebaseConfigured ? (
              <div className="flex gap-2 pt-2 border-t border-border mt-2">
                <button type="button" onClick={()=>{setMobileOpen(false); setShowChangePw(true);}} className="flex-1 rounded-xl border border-border bg-background py-3 min-h-[44px] text-sm font-bold flex items-center justify-center gap-2"><KeyRound size={16}/>{t("profile.change_password")}</button>
                <button type="button" onClick={()=>{setMobileOpen(false); logout();}} className="flex-1 rounded-xl bg-primary py-3 min-h-[44px] text-sm font-black text-white flex items-center justify-center gap-2"><LogOut size={16}/>{t("nav.logout")}</button>
              </div>
            ) : null}
          </nav>
        ) : null}
      </header>

      <section className="mx-auto max-w-6xl px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8 3xl:px-8 max-w-[1600px] 3xl:max-w-[1800px] w-full">{children}</section>
      <AiSidebar />

      {showChangePw ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={() => setShowChangePw(false)}>
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-black tracking-tight text-text-primary">{t("profile.change_password")}</h2>
              <button
                type="button"
                onClick={() => setShowChangePw(false)}
                className="rounded-xl border border-border bg-surface p-2 text-text-secondary transition-colors hover:bg-primary hover:text-white"
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleChangePassword} className="grid gap-4">
              <label className="grid gap-2 text-sm font-bold text-text-primary">
                {t("profile.new_password")}
                <PasswordInput
                  id="change-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  showValidation={true}
                />
              </label>
              {pwSuccess ? (
                <p className="rounded-xl p-3 text-sm font-bold text-success" style={{ backgroundColor: "rgba(16, 185, 129, 0.2)" }}>{pwSuccess}</p>
              ) : null}
              {pwError ? (
                <p className="rounded-xl p-3 text-sm font-bold text-error" style={{ backgroundColor: "rgba(239, 68, 68, 0.2)" }}>{pwError}</p>
              ) : null}
              <button
                type="submit"
                disabled={pwBusy || newPassword.length < 8}
                className="rounded-xl bg-primary px-4 py-3 font-black text-white transition-all hover:bg-primary-active active:scale-95 disabled:opacity-50"
              >
                {pwBusy ? t("common.saving") : t("profile.change_password")}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
