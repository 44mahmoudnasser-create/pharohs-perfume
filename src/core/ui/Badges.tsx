import { cn } from "@/core/lib/cn";

const TONES = {
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  accent: "bg-accent/15 text-accent",
  muted: "bg-slate-500/20 text-slate-300",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "muted", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn("eg-badge whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "success" : "danger"}>{active ? "مفعّل" : "متوقف"}</Badge>;
}
