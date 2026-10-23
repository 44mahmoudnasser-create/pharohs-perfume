// Turns Supabase / PostgREST / network errors into a single Arabic message.
// Business-rule errors raised by our database functions already carry an
// Arabic message (and a machine-readable hint), so they are shown as-is.

type PgLikeError = { message?: string; code?: string; hint?: string | null; details?: string | null };

const ARABIC = /[؀-ۿ]/;

export class AppError extends Error {
  constructor(message: string, public code?: string, public hint?: string | null) {
    super(message);
  }
}

export function errorMessage(err: unknown): string {
  if (!err) return "حدث خطأ غير متوقع";
  if (typeof err === "string") return err;

  const e = err as PgLikeError;
  const msg = e.message ?? "";

  if (msg && ARABIC.test(msg)) return msg;

  switch (e.code) {
    case "23505": return "القيمة مسجلة من قبل (اسم أو كود مكرر)";
    case "23503": return "لا يمكن تنفيذ العملية لأن السجل مرتبط ببيانات أخرى";
    case "23514": return "قيمة غير صالحة — راجع البيانات المدخلة";
    case "23502": return "يوجد حقل مطلوب فارغ";
    case "42501": return "ليس لديك صلاحية لتنفيذ هذه العملية";
    case "PGRST301": return "انتهت الجلسة، سجّل الدخول مرة أخرى";
  }
  if (/row-level security|permission denied/i.test(msg)) return "ليس لديك صلاحية لتنفيذ هذه العملية";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى";
  if (/Invalid login credentials/i.test(msg)) return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
  if (/Email not confirmed/i.test(msg)) return "لم يتم تأكيد البريد الإلكتروني بعد";
  return msg || "حدث خطأ غير متوقع";
}

/** Throws the Supabase error (if any) and returns data. */
export function unwrap<T>(res: { data: T | null; error: PgLikeError | null }): T {
  if (res.error) throw new AppError(errorMessage(res.error), res.error.code, res.error.hint);
  return res.data as T;
}
