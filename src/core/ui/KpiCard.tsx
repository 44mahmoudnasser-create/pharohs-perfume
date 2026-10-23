import { cn } from "@/core/lib/cn";

export default function KpiCard({
  label, value, color = "text-accent", hint, onClick,
}: {
  label: string; value: React.ReactNode; color?: string; hint?: string; onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "eg-card flex flex-col items-center justify-center gap-1 min-w-0 transition-all disabled:opacity-100",
        onClick ? "cursor-pointer hover:border-accent/40 hover:bg-card2 active:scale-95" : "cursor-default",
      )}
    >
      <span className={cn("text-2xl md:text-3xl font-extrabold leading-none tabular-nums", color)}>{value}</span>
      <span className="text-xs text-subtext text-center leading-tight">{label}</span>
      {hint && <span className="text-[10px] text-accent/60 mt-0.5">{hint}</span>}
    </button>
  );
}
