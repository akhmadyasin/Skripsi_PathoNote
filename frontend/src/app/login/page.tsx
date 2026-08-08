"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:5001";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);



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

    // Verify session after sign-in
    const { data: { session }, error: userErr } = await supabase.auth.getSession();
    if (userErr) {
      setErr(userErr.message);
      return;
    }

    const accessToken = session?.access_token;
    if (!accessToken) {
      setErr("Sesi login tidak ditemukan.");
      return;
    }

    try {
      const statusResponse = await fetch(`${API_BASE}/api/auth/check-account-status`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!statusResponse.ok) {
        const statusBody = await statusResponse.json().catch(() => ({}));
        throw new Error(statusBody?.error || "Gagal memeriksa status akun.");
      }

      const statusBody = await statusResponse.json() as { is_active?: boolean };
      if (statusBody.is_active === false) {
        await supabase.auth.signOut();
        setErr("Akun Anda saat ini nonaktif. Silakan hubungi Superadmin untuk mengaktifkannya kembali.");
        return;
      }
    } catch (statusError) {
      setErr(statusError instanceof Error ? statusError.message : "Gagal memeriksa status akun.");
      return;
    }

    // Persist mode as 'patologi' (only mode available now)
    try { localStorage.setItem("summaryMode", "patologi"); } catch {}
    router.push("/dashboard");
  };

  const onForgot = () => {
    if (!email.trim()) {
      setErr("Please enter your email address first to reset password.");
      return;
    }

    router.push(`/auth/reset-password?email=${encodeURIComponent(email.trim())}`);
  };

  return (
    <div className="auth-container">
      <div className="form-side">
        <div className="form-box">
          <h1>Welcome Back</h1>
          <p style={{ textAlign:'center', color:'#6b7280', marginBottom:24, fontSize:14 }}>
            Sign in to your account to continue
          </p>

          {err && <div className="alert error">{err}</div>}

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

          <p className="muted center">
            Account creation is restricted. Please ask your Superadmin to create a user for you.
            <br />
            <a
              href="https://wa.me/6289512853891?text=Halo%20Superadmin%2C%20saya%20ingin%20meminta%20dibuatkan%20akun%20untuk%20mengakses%20aplikasi%20PathoNote."
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#38b6ff', fontWeight: 600, textDecoration: 'none' }}
            >
              Contact Superadmin
            </a>
          </p>
        </div>
      </div>

      <div className="image-side">
        <img src="/login.png" alt="Login Illustration" />
      </div>
    </div>
  );
}
