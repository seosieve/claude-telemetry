import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError(null);

    const result = await login(email.trim());
    setLoading(false);

    if (result.success) {
      setSent(true);
    } else {
      setError(result.error || "Failed to send magic link");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-rose-500 to-sky-400" />
          <h1 className="text-xl font-semibold text-white">Claude Tracker</h1>
          <p className="text-xs text-slate-500">
            Centralized token usage tracking
          </p>
        </div>

        {sent ? (
          /* Confirmation */
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
            <p className="text-sm font-medium text-emerald-400">
              Check your email
            </p>
            <p className="mt-2 text-xs text-slate-400">
              We sent a magic link to{" "}
              <span className="font-medium text-white">{email}</span>. Click
              the link to sign in.
            </p>
            <button
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              className="mt-4 text-xs text-slate-500 hover:text-slate-300"
            >
              Use a different email
            </button>
          </div>
        ) : (
          /* Login form */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-medium text-slate-400 mb-1.5"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-sky-500/50"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full rounded-lg bg-sky-500 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-600 disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send Magic Link"}
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-center">
                <p className="text-xs text-rose-400">{error}</p>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
