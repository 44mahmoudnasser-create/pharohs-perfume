const nf = (max: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: max });
const num0 = nf(0), num2 = nf(2), num3 = nf(3);
const money = new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type N = number | string | null | undefined;

export const fmtInt = (v: N) => (v == null ? "—" : num0.format(Number(v)));
export const fmtNum = (v: N, digits = 3) =>
  v == null ? "—" : (digits === 2 ? num2 : digits === 0 ? num0 : num3).format(Number(v));

export const fmtMoney = (v: N, currency = "") =>
  v == null ? "—" : `${money.format(Number(v))}${currency ? " " + currency : ""}`;

export const UNIT_LABEL: Record<string, string> = { g: "جم", pcs: "قطعة", ml: "مل" };
export const fmtQty = (v: N, unit?: string) =>
  v == null ? "—" : `${fmtNum(v)} ${unit ? UNIT_LABEL[unit] ?? unit : ""}`.trim();

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "—";
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("ar-EG", { dateStyle: "medium" }) : "—";

/** yyyy-mm-dd in the browser's local time */
export const isoDate = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 86400000));
