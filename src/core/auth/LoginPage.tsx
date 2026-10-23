import { useState } from "react";
import { Droplets } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { errorMessage } from "@/core/lib/errors";

export default function LoginPage({ appName, appSubtitle }: { appName: string; appSubtitle: string }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-accent rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-accent/20">
            <Droplets className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-text">{appName}</h1>
          <p className="text-sm text-subtext mt-1">{appSubtitle}</p>
        </div>

        <div className="eg-card">
          <h2 className="text-base font-semibold text-text mb-5 text-center">تسجيل الدخول</h2>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="eg-label">البريد الإلكتروني</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username"
                className="eg-input" placeholder="name@example.com" dir="ltr" required />
            </div>
            <div>
              <label className="eg-label">كلمة المرور</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                className="eg-input" placeholder="••••••••" dir="ltr" required />
            </div>
            {error && <p className="text-xs text-danger bg-danger/10 rounded-lg p-3">{error}</p>}
            <button type="submit" disabled={loading} className="eg-btn-primary w-full justify-center">
              {loading ? "جاري الدخول..." : "دخول"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
