"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);



  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setErr(error.message);
      return;
    }

    // Ambil user & role setelah sign-in
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      setErr(userErr.message);
      return;
    }

    // Persist mode as 'patologi' (only mode available now)
    try { localStorage.setItem("summaryMode", "patologi"); } catch {}
    router.push("/dashboard");
  };

  const onGoogle = async () => {
    setErr(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setErr(error.message);
  };

  const onForgot = async () => {
    if (!email) {
      setErr("Please enter your email address first to reset password.");
      return;
    }
    setErr(null);
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/update-password`,
    });
    setLoading(false);
    if (error) setErr(error.message);
    else setResetSent(true);
  };

  return (
    <div className="auth-container">
      <div className="form-side">
        <div className="form-box">
          <h1>Welcome Back</h1>
          <p style={{ textAlign:'center', color:'#6b7280', marginBottom:24, fontSize:14 }}>
            Sign in to your account to continue
          </p>

          {err && <div className="alert">{err}</div>}
          {resetSent && (
            <div className="alert success">
              Password reset link has been sent to your email.
            </div>
          )}

          <form onSubmit={onSubmit}>
            <label>Email</label>
            <input
              type="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />

            <label>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />

            <div className="row between">
              <span />
              <button
                type="button"
                className="linklike"
                onClick={onForgot}
                disabled={loading}
                aria-disabled={loading}
              >
                Forgot Password?
              </button>
            </div>

            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Log In"}
            </button>
          </form>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            margin: '24px 0',
            color: '#9ca3af'
          }}>
            <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
            <span style={{ padding: '0 16px', fontSize: 14 }}>or continue with</span>
            <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
          </div>

          <button className="btn google" type="button" onClick={onGoogle} disabled={loading}>
            <span className="g">G</span> Log in with Google
          </button>

          <p className="muted center">
            Don't have an account? <a href="/register">Sign up now</a>
          </p>
        </div>
      </div>

      <div className="image-side">
        <img src="/login.jpg" alt="Login Illustration" />
      </div>
    </div>
  );
}