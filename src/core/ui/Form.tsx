import { Search } from "lucide-react";
import { cn } from "@/core/lib/cn";

export function Field({
  label, required, hint, error, children, className,
}: {
  label: string; required?: boolean; hint?: string; error?: string | null;
  children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className="eg-label">{label}{required && " *"}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-subtext mt-1">{hint}</p>}
      {error && <p className="text-[11px] text-danger mt-1">{error}</p>}
    </div>
  );
}

export function SearchInput({
  value, onChange, placeholder = "بحث", className,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-subtext" />
      <input value={value} onChange={e => onChange(e.target.value)} type="search"
        className="eg-input !py-1.5 !text-xs pr-8 w-full" placeholder={placeholder} />
    </div>
  );
}

export function FilterSelect<T extends string>({
  value, onChange, options, className,
}: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)}
      className={cn("eg-select !py-1.5 !text-xs !w-auto min-w-[8rem]", className)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-xs text-danger bg-danger/10 rounded-lg p-3">{message}</p>;
}

/** Segmented control used for status filters and tabs. */
export function Segmented<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="inline-flex flex-wrap bg-card2 rounded-lg p-0.5 border border-border/60">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn("px-3 py-1.5 rounded-md text-xs transition-colors",
            value === o.value ? "bg-accent text-white font-semibold" : "text-subtext hover:text-text")}>
          {o.label}{o.count != null && <span className="tabular-nums opacity-70"> ({o.count})</span>}
        </button>
      ))}
    </div>
  );
}

export const statusOptions = [
  { value: "all" as const, label: "الكل" },
  { value: "active" as const, label: "المفعّل" },
  { value: "inactive" as const, label: "المتوقف" },
];
export type StatusFilter = "all" | "active" | "inactive";
export const matchesStatus = (active: boolean, f: StatusFilter) =>
  f === "all" || (f === "active" ? active : !active);
