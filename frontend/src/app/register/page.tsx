"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:5001";

type UserMeta = {
  role?: string;
  [key: string]: unknown;
};

export default function RegisterPage() {
  const router = useRouter();
  const supabase = supabaseBrowser;

  const [username, setUsername] = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [role, setRole]         = useState("dokter");
  const [err, setErr]           = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [allowed, setAllowed]   = useState<boolean | null>(null);
  const [session, setSession]   = useState<{ access_token?: string; user?: { user_metadata?: UserMeta } } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!session) {
        router.replace("/login");
        return;
      }

      setSession(session);
      const userMeta = (session.user.user_metadata as UserMeta) || {};
      const rawMeta = ((session.user as unknown as { raw_user_meta_data?: UserMeta }).raw_user_meta_data || {}) as UserMeta;
      const userRole = ((userMeta.role as string) || (rawMeta.role as string) || "").toString().toLowerCase();
      setAllowed(userRole === "superadmin");
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!sess) router.replace("/login");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);

    if (password !== confirm) {
      setErr("Password confirmation does not match.");
      return;
    }

    if (!session?.access_token) {
      setErr("Unable to verify your session. Please log in again.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/admin/create-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email,
          password,
          username,
          display_name: username,
          role,
        }),
      });

      const result = (await response.json()) as { error?: string; success?: boolean; user?: { email?: string } };
      if (!response.ok) {
        setErr(result?.error || "Failed to create user.");
        setLoading(false);
        return;
      }

      const userEmail = result?.user?.email || email;
      setInfo(`User created successfully for ${userEmail}.`);
      setUsername("");
      setEmail("");
      setPassword("");
      setConfirm("");
      setRole("dokter");
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Unexpected error when creating user.");
    } finally {
      setLoading(false);
    }
  };

  if (allowed === null) {
    return (
      <div className="auth-container register-form">
        <div className="form-side">
          <div className="form-box">
            <h1>Checking access...</h1>
            <p>Please wait while we verify your administrator access.</p>
          </div>
        </div>
      </div>
    );
  }

  if (allowed === false) {
    return (
      <div className="auth-container register-form">
        <div className="form-side">
          <div className="form-box">
            <div className="access-denied-icon">⛔</div>
            <h1>Access Denied</h1>
            <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: 24, fontSize: 14 }}>
              This page is reserved for Superadmin accounts only.
            </p>
            <p className="muted center">
              <a href="/login">← Return to login</a>
            </p>
          </div>
        </div>
        <div className="image-side">
          <img src="/login.png" alt="Admin Area" />
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container register-form">
      <div className="form-side">
        <div className="form-box">
          <div className="admin-header">
            <div className="admin-icon">👤</div>
            <h1>Create User Account</h1>
            <p className="admin-subtitle">Add a new user to the system</p>
          </div>

          {err && <div className="alert error">❌ {err}</div>}
          {info && <div className="alert success">✓ {info}</div>}

          <form onSubmit={onSubmit}>
            <div className="form-group">
              <label>Full Name / Username *</label>
              <input
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label>Email Address *</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="form-group flex-1">
                <label>Role *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                  className="form-select"
                >
                  <option value="dokter">👨‍⚕️ Dokter</option>
                  <option value="petugas">👤 Petugas</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group flex-1">
                <label>Password *</label>
                <input
                  type="password"
                  placeholder="Min. 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
              <div className="form-group flex-1">
                <label>Confirm Password *</label>
                <input
                  type="password"
                  placeholder="Repeat password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button className="btn primary create-btn" type="submit" disabled={loading}>
              {loading ? (
                <><span className="spinner"></span> Creating...</>
              ) : (
                <><span>➕</span> Create User</>
              )}
            </button>
          </form>

          <div className="form-footer">
            <a href="/dashboard" className="back-link">← Back to Dashboard</a>
          </div>
        </div>
      </div>

      <div className="image-yyside">
        <img src="/login.png" alt="Create User" />
      </div>
    </div>
  );
}
