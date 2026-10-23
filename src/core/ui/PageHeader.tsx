/** Sticky page header — same pattern as the factory system pages. */
export default function PageHeader({
  title, subtitle, count, actions,
}: {
  title: string; subtitle?: string; count?: string; actions?: React.ReactNode;
}) {
  return (
    <div className="sticky top-14 md:top-0 z-20 bg-bg/95 backdrop-blur border-b border-border/60 px-4 md:px-6 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-text">{title}</h1>
            {count && <span className="text-xs text-subtext tabular-nums">{count}</span>}
          </div>
          {subtitle && <p className="text-[11px] text-subtext">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}

export function PageBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 md:p-6 space-y-4 ${className}`}>{children}</div>;
}
