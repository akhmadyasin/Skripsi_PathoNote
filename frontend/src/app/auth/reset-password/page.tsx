"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const supabase = supabaseBrowser;

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const initialEmail = searchParams.get("email") || "";
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [searchParams]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim()) {
      setError("Masukkan alamat email Anda terlebih dahulu.");
      return;
    }

    setLoading(true);
    const redirectTo = `${typeof window !== "undefined" ? window.location.origin : ""}/auth/update-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setSuccess("Link reset password telah dikirim ke email Anda. Buka email dan klik tautan untuk mengatur password baru.");
    setEmail("");
  };

  return (
    <div className="auth-container">
      <div className="form-side">
        <div className="form-box">
          <h1>Reset Password</h1>
          <p style={{ textAlign: "center", color: "#6b7280", marginBottom: 24, fontSize: 14 }}>
            Masukkan email akun Anda. Kami akan mengirimkan tautan untuk mengatur ulang password.
          </p>

          {error && <div className="alert">{error}</div>}
          {success && <div className="alert success">{success}</div>}

          <form onSubmit={onSubmit}>
            <label>Email</label>
            <input
              type="email"
              placeholder="nama@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />

            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? "Mengirim..." : "Kirim Link Reset"}
            </button>
          </form>

          <p className="muted center" style={{ marginTop: 16 }}>
            <a href="/login">← Kembali ke login</a>
          </p>
        </div>
      </div>

      <div className="image-side">
        <img src="/login.jpg" alt="Reset Password" />
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="auth-container" style={{ justifyContent: "center", alignItems: "center" }}>Loading...</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
