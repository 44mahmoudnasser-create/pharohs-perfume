import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { errorMessage } from "@/core/lib/errors";

type Toast = { id: number; ok: boolean; text: string };
type Notify = { success: (text: string) => void; error: (err: unknown) => void };

const Ctx = createContext<Notify | null>(null);

/** Global success / error notices, styled like the factory system's inline notices. */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((ok: boolean, text: string) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, ok, text }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ok ? 3500 : 6000);
  }, []);

  const api = useMemo<Notify>(() => ({
    success: text => push(true, text),
    error: err => push(false, errorMessage(err)),
  }), [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed top-3 inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id}
            className={cn("pointer-events-auto max-w-md w-full flex items-start gap-2 text-sm px-4 py-3 rounded-xl border shadow-2xl backdrop-blur",
              t.ok ? "bg-card/95 border-success/40 text-success" : "bg-card/95 border-danger/40 text-danger")}>
            {t.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span className="leading-relaxed">{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useNotify(): Notify {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotify must be used inside NotificationsProvider");
  return ctx;
}
