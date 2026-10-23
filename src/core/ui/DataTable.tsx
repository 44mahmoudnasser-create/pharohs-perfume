import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/core/lib/cn";
import { EmptyState } from "./States";
import Pagination from "./Pagination";

export type Column<T> = {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
};

/**
 * Client-side table: sorting + pagination. Filtering/search is done by the
 * caller (pass already-filtered rows) so filters can live in the page header.
 */
export default function DataTable<T>({
  rows, columns, rowKey, pageSize = 25, initialSort, emptyMessage = "لا توجد بيانات",
  onRowClick, rowClassName,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  pageSize?: number;
  initialSort?: { key: string; dir: "asc" | "desc" };
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [rows]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a), vb = col.sortValue!(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ar") * dir;
    });
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages);
  const visible = sorted.slice((current - 1) * pageSize, current * pageSize);

  const toggleSort = (key: string) =>
    setSort(s => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  if (rows.length === 0) return <div className="eg-card !p-0"><EmptyState message={emptyMessage} /></div>;

  return (
    <div className="eg-card !p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="eg-table">
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} className={c.className}>
                  {c.sortValue ? (
                    <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-text">
                      {c.header}
                      {sort?.key === c.key
                        ? (sort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
                        : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && "cursor-pointer", rowClassName?.(row))}>
                {columns.map(c => (
                  <td key={c.key} className={c.className}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="border-t border-border/50 px-4 py-2">
          <Pagination page={current} pageCount={pages} total={sorted.length} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
