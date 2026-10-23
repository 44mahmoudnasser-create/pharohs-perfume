import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/core/lib/supabase";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  active: boolean;
};

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** UI-only check (hides buttons/pages). The database enforces the real rules. */
  can: (permission: string) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

/**
 * Reusable auth provider. The role always comes from the app_users table
 * (never from JWT/user_metadata). `permissions` maps role → allowed keys and
 * is supplied by each application.
 */
export function AuthProvider({
  permissions, children,
}: { permissions: Record<string, readonly string[]>; children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); return; }
    const { data } = await supabase.from("app_users")
      .select("id, email, full_name, role, active").eq("id", s.user.id).maybeSingle();
    setProfile((data as Profile | null) ?? { id: s.user.id, email: s.user.email ?? "", full_name: null, role: "", active: false });
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // token refreshes don't change the profile
      if (event !== "TOKEN_REFRESHED") void loadProfile(s);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value = useMemo<AuthState>(() => ({
    session,
    profile,
    loading,
    can: (p: string) => !!profile?.active && (permissions[profile.role] ?? []).includes(p),
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    signOut: async () => { await supabase.auth.signOut(); },
    refreshProfile: () => loadProfile(session),
  }), [session, profile, loading, permissions, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
