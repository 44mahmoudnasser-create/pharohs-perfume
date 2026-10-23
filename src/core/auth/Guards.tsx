import { Clock, ShieldAlert } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { LoadingState } from "@/core/ui/States";

/** Full-screen message for signed-in users who can't use the app yet. */
export function PendingActivation() {
  const { profile, signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="eg-card max-w-sm w-full text-center space-y-3">
        <Clock className="w-10 h-10 text-warning mx-auto" />
        <h1 className="text-base font-bold text-text">الحساب في انتظار التفعيل</h1>
        <p className="text-sm text-subtext leading-relaxed">
          تم تسجيل الدخول باسم <span dir="ltr" className="text-text">{profile?.email}</span>، لكن الحساب غير مفعّل بعد.
          اطلب من مدير النظام تفعيل حسابك وتحديد صلاحيتك.
        </p>
        <button onClick={() => void signOut()} className="eg-btn-ghost w-full justify-center">تسجيل الخروج</button>
      </div>
    </div>
  );
}

/** Hides a page when the user lacks the permission (the database still enforces it). */
export function RequirePermission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { can, loading } = useAuth();
  if (loading) return <LoadingState />;
  if (!can(permission)) {
    return (
      <div className="p-6">
        <div className="eg-card flex flex-col items-center gap-3 py-12 text-center">
          <ShieldAlert className="w-8 h-8 text-danger" />
          <p className="text-sm text-subtext">ليس لديك صلاحية لفتح هذه الصفحة</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
