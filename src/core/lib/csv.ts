type Cell = string | number | null | undefined;

/** Builds CSV text: CRLF line endings, quoted cells with commas, quotes or newlines. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map(r => r.map(esc).join(",")).join("\r\n");
}

/** Downloads rows as a UTF-8 CSV (with BOM so Excel shows Arabic correctly). */
export function downloadCsv(filename: string, headers: string[], rows: Cell[][]) {
  const url = URL.createObjectURL(new Blob(["﻿" + toCsv(headers, rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
