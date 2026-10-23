import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/core/lib/supabase";

export type SettingRow = { key: string; value: unknown; description: string | null; updated_at: string };

type SettingsState = {
  rows: SettingRow[];
  get: <T>(key: string, fallback: T) => T;
  reload: () => Promise<void>;
};

const Ctx = createContext<SettingsState | null>(null);

/** Loads app_settings once per session; pages call reload() after changes. */
export function SettingsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [rows, setRows] = useState<SettingRow[]>([]);

  const reload = useCallback(async () => {
    const { data } = await supabase.from("app_settings").select("key, value, description, updated_at").order("key");
    setRows((data as SettingRow[] | null) ?? []);
  }, []);

  useEffect(() => { if (enabled) void reload(); }, [enabled, reload]);

  const value = useMemo<SettingsState>(() => ({
    rows,
    get: <T,>(key: string, fallback: T) => {
      const r = rows.find(x => x.key === key);
      return r == null || r.value == null ? fallback : (r.value as T);
    },
    reload,
  }), [rows, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

/** Common shortcuts used across modules. */
export function useShop() {
  const { get } = useSettings();
  return {
    name: get<string>("shop.name", "متجر"),
    currency: get<string>("shop.currency", ""),
    allowNegativeStock: get<boolean>("inventory.allow_negative_stock", false),
    allowPriceOverride: get<boolean>("sales.allow_price_override", false),
  };
}
