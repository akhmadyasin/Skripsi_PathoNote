"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = supabaseBrowser;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const verifySession = async () => {
      try {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        const code = new URLSearchParams(window.location.search).get("code");

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            setError(error.message);
            setChecking(false);
            return;
          }

          setChecking(false);
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            setError(error.message);
            setChecking(false);
            return;
          }

          setChecking(false);
          return;
        }

        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          setError(error.message);
          setChecking(false);
          return;
        }

        if (!session) {
          setError("Tautan reset password tidak valid atau sudah kadaluarsa. Silakan minta tautan baru.");
          setChecking(false);
          return;
        }

        setChecking(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal memproses tautan reset password.");
        setChecking(false);
      }
    };

    verifySession();
  }, [supabase]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (password.length < 6) {
      setError("Password minimal 6 karakter.");
      return;
    }

    if (password !== confirm) {
      setError("Konfirmasi password tidak sesuai.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSuccess("Password berhasil diubah. Anda akan diarahkan ke halaman login.");
    setPassword("");
    setConfirm("");

    window.setTimeout(() => {
      router.replace("/login");
    }, 1500);
  };

  if (checking) {
    return (
      <div className="auth-container">
        <div className="form-side">
          <div className="form-box">
            <h1>Memeriksa tautan...</h1>
            <p>Silakan tunggu sebentar.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="form-side">
        <div className="form-box">
          <h1>Buat Password Baru</h1>
          <p style={{ textAlign: "center", color: "#6b7280", marginBottom: 24, fontSize: 14 }}>
            Masukkan password baru untuk akun Anda.
          </p>

          {error && <div className="alert">{error}</div>}
          {success && <div className="alert success">{success}</div>}

          <form onSubmit={onSubmit}>
            <label>Password Baru</label>
            <input
              type="password"
              placeholder="Minimal 6 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />

            <label>Konfirmasi Password</label>
            <input
              type="password"
              placeholder="Ulangi password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />

            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? "Menyimpan..." : "Simpan Password Baru"}
            </button>
          </form>

          <p className="muted center" style={{ marginTop: 16 }}>
            <a href="/login">← Kembali ke login</a>
          </p>
        </div>
      </div>

      <div className="image-side">
        <img src="/login.jpg" alt="Update Password" />
      </div>
    </div>
  );
}
