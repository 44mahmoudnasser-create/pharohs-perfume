import { AlertTriangle, RotateCcw } from "lucide-react";
import { cn } from "@/core/lib/cn";

export function Spinner({ className = "w-6 h-6" }: { className?: string }) {
  return <div className={cn(className, "border-2 border-border border-t-accent rounded-full animate-spin")} />;
}

export function LoadingState({ message = "جاري التحميل..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-subtext">
      <Spinner />
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function EmptyState({ message = "لا توجد بيانات", children }: { message?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-subtext gap-3">
      <span className="text-4xl">📭</span>
      <p className="text-sm text-center">{message}</p>
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <AlertTriangle className="w-8 h-8 text-danger" />
      <p className="text-sm text-danger max-w-md">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="eg-btn-ghost !py-1.5 !text-xs">
          <RotateCcw className="w-3.5 h-3.5" />إعادة المحاولة
        </button>
      )}
    </div>
  );
}

/** Renders loading / error states, otherwise children. */
export function AsyncBoundary({
  loading, error, onRetry, children,
}: { loading: boolean; error: string | null; onRetry?: () => void; children: React.ReactNode }) {
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (loading) return <LoadingState />;
  return <>{children}</>;
}
