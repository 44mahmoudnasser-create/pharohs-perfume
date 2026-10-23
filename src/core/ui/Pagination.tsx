import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtInt } from "@/core/lib/format";

export default function Pagination({
  page, pageCount, total, onChange,
}: { page: number; pageCount: number; total?: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-subtext">
      <span className="tabular-nums">
        صفحة {fmtInt(page)} من {fmtInt(pageCount)}{total != null && ` · ${fmtInt(total)} سجل`}
      </span>
      <div className="flex items-center gap-1">
        {/* RTL: "previous" points right */}
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}
          className="eg-btn-ghost !px-2 !py-1" aria-label="الصفحة السابقة">
          <ChevronRight className="w-4 h-4" />
        </button>
        <button type="button" disabled={page >= pageCount} onClick={() => onChange(page + 1)}
          className="eg-btn-ghost !px-2 !py-1" aria-label="الصفحة التالية">
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
