"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

export default function RegisterPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [username, setUsername] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [err, setErr]           = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setInfo(null);

  if (password !== confirm) return setErr("Password confirmation does not match.");

    setLoading(true);
    // Use only pathologist mode (summary_mode hardcoded to "patologi")
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, summary_mode: "patologi" },
        emailRedirectTo: `${location.origin}/login`,
      },
    });
    setLoading(false);

    // Debug: log Supabase response so we can see whether confirmation email was queued
    console.debug("supabase.auth.signUp response:", { data, error });

    if (error) return setErr(error.message);

    if (!data.session) {
      // If the server returns info about email confirmation, show it
      const serverMsg = (data as any)?.user?.confirmation_sent_at ? "Confirmation email should have been sent." : undefined;
      setInfo(serverMsg || "Registration successful. Please verify your email, then sign in.");
    }
    else router.push("/dashboard");
  };

  return (
    <div className="auth-container register-form">
      <div className="form-side">
        <div className="form-box">
          <h1>Create Account</h1>
          <p style={{ textAlign:'center', color:'#6b7280', marginBottom:24, fontSize:14 }}>
            Join us today and start your journey
          </p>

          {err && <div className="alert error">{err}</div>}
          {info && <div className="alert success">{info}</div>}

          <form onSubmit={onSubmit}>
            <label>Username</label>
            <input
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />

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
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />

            <label>Confirm Password</label>
            <input
              type="password"
              placeholder="Confirm your password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />

            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Account"}
            </button>
          </form>

          <p className="muted center">
            Already have an account? <a href="/login">Sign in</a>
          </p>
        </div>
      </div>

      <div className="image-side">
        <img src="/login.jpg" alt="Register Illustration" />
      </div>
    </div>
  );
}