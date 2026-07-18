"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";
import { getSessionUserProfile } from "@/app/lib/userProfile";

type UserRow = {
  id: string;
  email: string;
  username: string;
  display_name: string;
  role: string;
  created_at?: string;
  last_sign_in_at?: string;
  email_confirmed_at?: string | null;
};

type UserMeta = {
  role?: string;
  [key: string]: unknown;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:5001";

export default function UserListPage() {
  const router = useRouter();
  const supabase = supabaseBrowser;

  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!session) {
        router.replace("/login");
        return;
      }

      const profile = getSessionUserProfile(session as any);
      if (profile.role !== "superadmin") {
        setAllowed(false);
        setLoading(false);
        return;
      }

      setAllowed(true);
      await loadUsers(session.access_token || "");
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!sess) router.replace("/login");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  const loadUsers = async (accessToken: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result = await response.json() as { users?: UserRow[]; error?: string };
      if (!response.ok) {
        throw new Error(result?.error || "Gagal memuat daftar pengguna.");
      }

      setUsers(Array.isArray(result?.users) ? result.users : []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan saat memuat data pengguna.");
      setUsers([]);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus akun ini?")) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Token akses tidak tersedia.");
      }

      const response = await fetch(`${API_BASE}/api/admin/delete-user/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result?.error || "Gagal menghapus akun.");
      }

      await loadUsers(accessToken);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan saat menghapus akun.");
    }
  };

  const filteredUsers = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return users;

    return users.filter((user) =>
      [user.display_name, user.username, user.email, user.role]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [query, users]);

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Memuat daftar pengguna…</h1>
          <p style={{ marginTop: 8, color: "#64748b" }}>Mohon tunggu sebentar.</p>
        </div>
      </div>
    );
  }

  if (allowed === false) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⛔</div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Akses Ditolak</h1>
          <p style={{ marginTop: 8, color: "#64748b" }}>
            Halaman ini hanya dapat diakses oleh akun Superadmin.
          </p>
          <a href="/dashboard" style={styles.primaryButton}>Kembali ke Dashboard</a>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerCard}>
        <div>
          <p style={styles.eyebrow}>Superadmin Panel</p>
          <h1 style={{ margin: "4px 0 8px", fontSize: 28 }}>Daftar Pengguna</h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Kelola akun pengguna yang sudah terdaftar di sistem.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/dashboard" style={styles.secondaryButton}>← Dashboard</a>
          <a href="/register" style={styles.primaryButton}>+ Tambah User</a>
        </div>
      </div>

      <div style={styles.toolbar}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari nama, email, atau role…"
          style={styles.input}
        />
        <div style={styles.summary}>{filteredUsers.length} pengguna</div>
      </div>

      {error ? (
        <div style={styles.errorBox}>{error}</div>
      ) : filteredUsers.length === 0 ? (
        <div style={styles.card}>
          <p style={{ margin: 0, color: "#64748b" }}>Belum ada pengguna yang tersedia.</p>
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Nama</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Terdaftar</th>
                <th style={styles.th}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td style={styles.td}>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>{user.display_name || user.username || "-"}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{user.username || "-"}</div>
                  </td>
                  <td style={styles.td}>{user.email || "-"}</td>
                  <td style={styles.td}>
                    <span style={roleBadgeStyle(user.role)}>{formatRole(user.role)}</span>
                  </td>
                  <td style={styles.td}>
                    <span style={statusBadgeStyle(Boolean(user.email_confirmed_at))}>
                      {user.email_confirmed_at ? "Terkonfirmasi" : "Menunggu Konfirmasi"}
                    </span>
                  </td>
                  <td style={styles.td}>{formatDate(user.created_at)}</td>
                  <td style={styles.td}>
                    <button
                      type="button"
                      onClick={() => handleDeleteUser(user.id)}
                      style={styles.deleteButton}
                      disabled={user.role === "superadmin"}
                      title={user.role === "superadmin" ? "Tidak dapat menghapus Superadmin" : "Hapus akun"}
                    >
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatRole(role: string) {
  if (!role) return "Dokter";
  if (role.toLowerCase() === "petugas") return "Petugas";
  if (role.toLowerCase() === "superadmin") return "Superadmin";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function roleBadgeStyle(role: string) {
  const normalized = (role || "").toLowerCase();
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };

  if (normalized === "superadmin") {
    return { ...base, background: "#dbeafe", color: "#1d4ed8" };
  }
  if (normalized === "petugas") {
    return { ...base, background: "#fef3c7", color: "#b45309" };
  }
  return { ...base, background: "#e0f2fe", color: "#0369a1" };
}

function statusBadgeStyle(confirmed: boolean) {
  return {
    display: "inline-block",
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: confirmed ? "#dcfce7" : "#fef2f2",
    color: confirmed ? "#166534" : "#b91c1c",
  } as React.CSSProperties;
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #f8fbff 0%, #eef8ff 100%)",
    padding: 24,
    color: "#0f172a",
  } as React.CSSProperties,
  deleteButton: {
    background: "#f87171",
    color: "white",
    border: "none",
    borderRadius: 8,
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: 700,
  } as React.CSSProperties,
  headerCard: {
    background: "#ffffff",
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 20px 45px rgba(15, 23, 42, 0.08)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap" as const,
    marginBottom: 18,
  },
  eyebrow: {
    margin: 0,
    color: "#38b6ff",
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: "0.16em",
    textTransform: "uppercase" as const,
  },
  primaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 16px",
    borderRadius: 999,
    background: "#38b6ff",
    color: "#ffffff",
    textDecoration: "none",
    fontWeight: 700,
    boxShadow: "0 10px 20px rgba(56, 182, 255, 0.2)",
  } as React.CSSProperties,
  secondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "10px 16px",
    borderRadius: 999,
    background: "#f8fafc",
    color: "#0f172a",
    textDecoration: "none",
    fontWeight: 700,
    border: "1px solid #e2e8f0",
  } as React.CSSProperties,
  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap" as const,
    marginBottom: 16,
  },
  input: {
    flex: 1,
    minWidth: 260,
    border: "1px solid #dbe4ee",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 14,
    outline: "none",
  } as React.CSSProperties,
  summary: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: 600,
  } as React.CSSProperties,
  card: {
    background: "#ffffff",
    borderRadius: 18,
    padding: 20,
    boxShadow: "0 14px 36px rgba(15, 23, 42, 0.06)",
  } as React.CSSProperties,
  errorBox: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  } as React.CSSProperties,
  tableWrap: {
    background: "#ffffff",
    borderRadius: 18,
    padding: 10,
    boxShadow: "0 14px 36px rgba(15, 23, 42, 0.06)",
    overflowX: "auto" as const,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  },
  th: {
    textAlign: "left" as const,
    padding: "12px 14px",
    fontSize: 12,
    color: "#64748b",
    borderBottom: "1px solid #e2e8f0",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  td: {
    padding: "14px",
    borderBottom: "1px solid #f1f5f9",
    fontSize: 14,
    color: "#334155",
    verticalAlign: "top" as const,
  },
};
