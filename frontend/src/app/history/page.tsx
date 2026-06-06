"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";
import s from "@/app/styles/dashboard.module.css";
import h from "@/app/styles/history.module.css";

type HistoryRecord = {
  id: string;
  hasil_patologi_id: string;
  petugas_id: string;
  nama_petugas: string;
  metode_pengiriman: string;
  tujuan_pengiriman: string;
  status: string;
  created_at?: string;
};

type PathologyRecord = Record<string, any>;

type UserMeta = {
  username?: string;
  avatar_url?: string;
  display_name?: string;
  [k: string]: any;
};

export default function HistoryPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [meta, setMeta] = useState<UserMeta>({});
  const [histories, setHistories] = useState<HistoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<PathologyRecord | null>(null);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  // Fetch session dan data history
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;

        if (!session) {
          router.replace("/login");
          return;
        }

        const userMeta = (session.user.user_metadata as UserMeta) || {};
        setEmail(session.user.email || "");
        setMeta(userMeta);

        // Fetch history_pengiriman data
        const { data, error: fetchError } = await supabase
          .from("history_pengiriman")
          .select("*")
          .order("created_at", { ascending: false });

        if (fetchError) {
          setError(`Gagal memuat history: ${fetchError.message}`);
          console.error("Fetch error:", fetchError);
        } else {
          setHistories(data || []);
        }
      } catch (err) {
        console.error("Error:", err);
        setError("Terjadi kesalahan saat memuat data");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (!sess) router.replace("/login");
    });

    return () => {
      mounted = false;
      sub?.subscription.unsubscribe();
    };
  }, [supabase, router]);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:5001";

  const username = meta.username || email.split("@")[0] || "User";
  const avatar = meta.avatar_url || "https://i.pravatar.cc/64?img=12";

  const getStatusColor = (status: unknown) => {
    const normalized = typeof status === "string" ? status.toLowerCase() : String(status || "");
    switch (normalized) {
      case "success":
      case "terkirim":
        return "#10b981"; // green
      case "failed":
        return "#ef4444"; // red
      case "pending":
      case "draft":
        return "#f59e0b"; // amber
      default:
        return "#6b7280"; // gray
    }
  };

  const getStatusLabel = (status: unknown) => {
    const normalized = typeof status === "string" ? status.toLowerCase() : String(status || "");
    switch (normalized) {
      case "success":
      case "terkirim":
        return "Terkirim";
      case "failed":
        return "Gagal";
      case "pending":
      case "draft":
        return "Draft";
      default:
        return status === null || status === undefined ? "-" : String(status);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "-";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("id-ID", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateString;
    }
  };

  const renderReportPreview = (item: PathologyRecord) => {
    const parts = [
      { label: "Diagnosa Klinik", value: item.diagnosa_klinik },
      { label: "Keterangan Klinik", value: item.keterangan_klinik },
      { label: "Makroskopik", value: item.makroskopik },
      { label: "Mikroskopik", value: item.mikroskopik },
      { label: "Kesimpulan", value: item.kesimpulan },
    ];

    return parts.filter((part) => part.value).map((part) => (
      <div key={part.label} className={h.previewSection}>
        <strong>{part.label}</strong>
        <p>{String(part.value)}</p>
      </div>
    ));
  };

  const handlePreview = async (record: HistoryRecord) => {
    setPreviewError(null);
    setPreviewRecord(null);
    setShowPreviewModal(true);
    setPreviewLoading(true);

    if (!record.hasil_patologi_id) {
      setPreviewError("Tidak ada ID hasil patologi terkait.");
      setPreviewLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("hasil_patologi")
        .select("*")
        .eq("id", record.hasil_patologi_id)
        .single();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error("Data preview tidak ditemukan.");
      }

      setPreviewRecord(data as PathologyRecord);
    } catch (err: any) {
      console.error("Preview error:", err);
      setPreviewError(err?.message || "Gagal memuat preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreviewModal = () => {
    setShowPreviewModal(false);
    setPreviewRecord(null);
    setPreviewError(null);
  };

  const filteredHistories = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return histories;
    return histories.filter((record) =>
      [
        record.nama_petugas,
        record.metode_pengiriman,
        record.tujuan_pengiriman,
        record.status,
        record.created_at,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [histories, query]);

  const handleDelete = async (id: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus record ini?")) return;

    try {
      const response = await fetch(`${API_BASE}/api/history/${id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      if (!response.ok || result.status !== "success") {
        console.error("Delete error:", result);
        alert(`Gagal menghapus record: ${result.message || "Unknown error"}`);
        return;
      }

      setHistories(histories.filter((h) => h.id !== id));
      alert("Record berhasil dihapus");
    } catch (err) {
      console.error("Delete error:", err);
      alert("Gagal menghapus record");
    }
  };

  if (loading) {
    return (
      <div className={s.app}>
        <aside className={s.sidebar}>
          <div className={s.sbInner}>
            <div className={s.brand}>
              <Image src="/logo_neurabot.jpg" alt="Logo PathoNote" width={36} height={36} className={s.brandImg} />
              <div className={s.brandName}>PathoNote</div>
            </div>
            <nav className={s.nav} aria-label="Sidebar">
              <a className={s.navItem} href="/dashboard">Dashboard</a>
              <a className={`${s.navItem}`} href="/collections">Collections</a>
              <a className={`${s.navItem} ${s.active}`} href="/history">History</a>
              <a className={s.navItem} href="/settings">Settings</a>
            </nav>
            <div className={s.sbFooter}>© 2025 Neurabot</div>
          </div>
        </aside>
        <main className={s.content}>
          <div className={s.card} style={{ textAlign: "center" }}>Memuat data...</div>
        </main>
      </div>
    );
  }

  return (
    <div className={s.app}>
      <aside className={s.sidebar}>
        <div className={s.sbInner}>
          <div className={s.brand}>
            <Image src="/logo_neurabot.jpg" alt="Logo PathoNote" width={36} height={36} className={s.brandImg} />
            <div className={s.brandName}>PathoNote</div>
          </div>

          <nav className={s.nav} aria-label="Sidebar">
            <a className={s.navItem} href="/dashboard">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9,22 9,12 15,12 15,22"></polyline></svg>
              <span>Dashboard</span>
            </a>
            <a className={s.navItem} href="/collections">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12,6 12,12 16,14"></polyline></svg>
              <span>Collections</span>
            </a>
            <a className={`${s.navItem} ${s.active}`} href="/history">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12,8 12,12 15,15"></polyline></svg>
              <span>History</span>
            </a>
            <a className={s.navItem} href="/settings">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              <span>Settings</span>
            </a>
          </nav>

          <div className={s.sbFooter}>© 2025 Neurabot</div>
        </div>
      </aside>

      <header className={s.topbar}>
        <div className={s.tbWrap}>
          <div className={s.leftGroup}>
            <div className={s.search} role="search">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              <input
                type="search"
                placeholder="Search history..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search history"
              />
            </div>
          </div>
          <div className={s.rightGroup}>
            <div className={s.avatar} onClick={() => setShowProfileDropdown(!showProfileDropdown)}>
              <Image src={avatar} alt="Foto profil" width={40} height={40} unoptimized />
              <div className={s.meta}>
                <div className={s.name}>{username}</div>
              </div>
            </div>
            {showProfileDropdown && (
              <div className={s.profileDropdown}>
                <button className={s.dropdownItem} onClick={() => router.push("/settings")}>⚙️ Pengaturan</button>
                <button className={s.dropdownItem} onClick={async () => {
                  await supabase.auth.signOut();
                  router.replace("/login");
                }}>🚪 Keluar</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className={s.content}>
        <div className={h.historyContainer}>
          {error && (
            <div className={h.errorBox}>
              ⚠️ {error}
            </div>
          )}

          <div className={h.tableContainer}>
            {filteredHistories.length === 0 ? (
              <div className={h.emptyState}>
                <p>Belum ada history pengiriman</p>
              </div>
            ) : (
              <table className={h.table}>
                <thead>
                  <tr>
                    <th>Tanggal & Waktu</th>
                    <th>Petugas</th>
                    <th>Metode</th>
                    <th>Tujuan</th>
                    <th>Status</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistories.map((record) => (
                    <tr key={record.id}>
                      <td>{formatDate(record.created_at)}</td>
                      <td>{record.nama_petugas}</td>
                      <td>
                        <span className={h.badge}>
                          {record.metode_pengiriman}
                        </span>
                      </td>
                      <td className={h.truncate} title={record.tujuan_pengiriman}>
                        {record.tujuan_pengiriman}
                      </td>
                      <td>
                        <span
                          className={h.status}
                          style={{ backgroundColor: getStatusColor(record.status) }}
                        >
                          {getStatusLabel(record.status)}
                        </span>
                      </td>
                      <td>
                        <button
                          className={h.previewButton}
                          onClick={() => handlePreview(record)}
                          title="Preview"
                          type="button"
                        >
                          👁️
                        </button>
                        <button
                          className={h.deleteButton}
                          onClick={() => handleDelete(record.id)}
                          title="Hapus"
                          type="button"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>

      {showPreviewModal && (
        <div className={h.previewOverlay} role="dialog" aria-modal="true">
          <div className={h.previewModal}>
            <div className={h.previewHeader}>
              <div>
                <h3>Preview Hasil Patologi</h3>
                <p>{previewRecord?.nomor_pa ? `PA ${previewRecord.nomor_pa}` : previewRecord?.id || "Preview data"}</p>
              </div>
              <button className={h.closeButton} onClick={closePreviewModal} aria-label="Tutup preview" type="button">
                ×
              </button>
            </div>

            <div className={h.previewBody}>
              {previewLoading ? (
                <div className={h.loadingBox}>Memuat preview...</div>
              ) : previewError ? (
                <div className={h.errorBox}>{previewError}</div>
              ) : previewRecord ? (
                <>
                  <div className={h.previewMeta}>
                    <div>
                      <strong>Petugas</strong>
                      <p>{previewRecord.nama_petugas || "-"}</p>
                    </div>
                    <div>
                      <strong>Metode</strong>
                      <p>{previewRecord.metode_pengiriman || "-"}</p>
                    </div>
                    <div>
                      <strong>Tujuan</strong>
                      <p>{previewRecord.tujuan_pengiriman || "-"}</p>
                    </div>
                    <div>
                      <strong>Status</strong>
                      <p>{getStatusLabel(previewRecord.status)}</p>
                    </div>
                  </div>
                  <div className={h.previewContent}>
                    {renderReportPreview(previewRecord)}
                    {!previewRecord.diagnosa_klinik && !previewRecord.keterangan_klinik && !previewRecord.makroskopik && !previewRecord.mikroskopik && !previewRecord.kesimpulan && (
                      <p className={h.noPreviewText}>Tidak ada data hasil patologi yang dapat ditampilkan.</p>
                    )}
                  </div>
                </>
              ) : (
                <div className={h.noPreviewText}>Tidak ada data preview.</div>
              )}
            </div>

            <div className={h.previewActions}>
              <button className={h.secondaryButton} onClick={closePreviewModal} type="button">
                Tutup
              </button>
              {previewRecord && (
                <button className={h.primaryButton} onClick={() => {
                  closePreviewModal();
                  router.push(`/detail/${previewRecord.id}`);
                }} type="button">
                  Buka detail
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
