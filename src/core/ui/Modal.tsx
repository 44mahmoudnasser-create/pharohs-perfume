import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/core/lib/cn";

export default function Modal({
  open, onClose, title, children, size = "md",
}: {
  open: boolean; onClose: () => void; title: string;
  children: React.ReactNode; size?: "sm" | "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="eg-modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={cn("eg-modal w-full", widths[size])} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <h2 className="text-base font-bold text-text">{title}</h2>
          <button onClick={onClose} className="text-subtext hover:text-danger transition-colors" aria-label="إغلاق">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
