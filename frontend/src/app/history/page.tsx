"use client";

import { useEffect, useMemo, useState } from "react";
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
  const supabase = supabaseBrowser;

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [meta, setMeta] = useState<UserMeta>({});
  const [userRole, setUserRole] = useState<string>('');
  const [histories, setHistories] = useState<HistoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<PathologyRecord | null>(null);
  const [previewCreatorMeta, setPreviewCreatorMeta] = useState<UserMeta | null>(null);

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
        const role = ((session.user.user_metadata as any)?.role || '').toString().toLowerCase();
        setUserRole(role);

        // Fetch history_pengiriman data (only share-via-email events across all users)
        const { data, error: fetchError } = await supabase
          .from("history_pengiriman")
          .select("*")
          // Fetch records where metode_pengiriman or tujuan_pengiriman mention "email"
          // using case-insensitive LIKE to cover variations (e.g. "Email", "share via email")
          .or("metode_pengiriman.ilike.%email%,tujuan_pengiriman.ilike.%email%")
          .order("created_at", { ascending: false });

        if (fetchError) {
          setError(`Gagal memuat history: ${fetchError.message}`);
          console.error("Fetch error:", fetchError);
        } else {
          // Filter out user-management events (created/deleted user) from the histories view
          const filtered = (data || []).filter((rec: HistoryRecord) => !isUserManagementEvent(rec));
          setHistories(filtered as HistoryRecord[]);
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

  async function fetchUserMetaById(userId?: string | null) {
    if (!userId) return null;
    try {
      const res = await fetch(`${API_BASE}/api/user-meta/${encodeURIComponent(userId)}`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      const meta = data?.user_metadata || data?.raw_user_meta_data || data?.user_metadata || {};
      return meta as UserMeta;
    } catch (e) {
      return null;
    }
  }

  const getStatusColor = (status: unknown) => {
    // Test hook: getStatusColor(status)
    // - Mengembalikan warna (hex) berdasarkan nilai status untuk tampilan UI.
    // - Gunakan untuk memverifikasi mapping warna pada status berbeda.
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
    // Test hook: getStatusLabel(status)
    // - Mengembalikan label teks yang ditampilkan untuk status.
    // - Berguna untuk menguji localisasi/pemetaan status.
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

  const isUserManagementEvent = (record: HistoryRecord) => {
    const check = (v: unknown) => (v || '').toString().toLowerCase();
    const metode = check(record.metode_pengiriman);
    const tujuan = check(record.tujuan_pengiriman);
    const petugas = check(record.nama_petugas);

    // common keywords indicating user creation/deletion / admin user events
    const userKeywords = ['user', 'pengguna', 'akun'];
    const createKeywords = ['create', 'created', 'created user', 'create_user', 'tambah', 'register', 'registrasi'];
    const deleteKeywords = ['delete', 'deleted', 'hapus', 'remove'];

    const containsAny = (text: string, arr: string[]) => arr.some((k) => text.includes(k));

    // If metode or tujuan or petugas mention both user and create/delete keywords, classify as user-management
    if (containsAny(metode, userKeywords) && (containsAny(metode, createKeywords) || containsAny(metode, deleteKeywords))) return true;
    if (containsAny(tujuan, userKeywords) && (containsAny(tujuan, createKeywords) || containsAny(tujuan, deleteKeywords))) return true;
    if (containsAny(petugas, userKeywords) && (containsAny(petugas, createKeywords) || containsAny(petugas, deleteKeywords))) return true;

    // fallback: method explicitly equals common labels
    const explicit = ['created user', 'delete user', 'user created', 'user deleted', 'create user', 'hapus pengguna'];
    if (explicit.includes(metode)) return true;

    return false;
  };

  const formatDate = (dateString?: string) => {
    // Test hook: formatDate(dateString)
    // - Format tanggal ISO string ke locale `id-ID` untuk tampilan.
    // - Input invalid akan dikembalikan apa adanya.
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

  const normalizeDestinationLabel = (value: unknown): string => {
    // Test hook: normalizeDestinationLabel(value)
    // - Normalisasi label tujuan pengiriman untuk tampilan.
    // - Memetakan "API RS" -> "Backend API".
    // - Selalu mengembalikan string.
    if (typeof value !== "string") return String(value ?? "-");
    const trimmed = value.trim();
    if (trimmed === "API RS") return "Backend API";
    return trimmed || "-";
  };

  const renderReportPreview = (item: PathologyRecord) => {
    // Test hook: renderReportPreview(item)
    // - Menghasilkan JSX bagian-bagian hasil patologi (Diagnosa, Makroskopik, dll.)
    // - Untuk pengujian, cek bahwa bagian yang kosong tidak dirender.
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
    // Test hook: handlePreview(record)
    // - Mengambil data `hasil_patologi` dari Supabase berdasarkan `hasil_patologi_id`.
    // - Men-set state loading/error/previewRecord; cetak error ke console jika gagal.
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
      // fetch creator metadata (if available)
      const creatorMeta = await fetchUserMetaById((data as any)?.user_id || null);
      setPreviewCreatorMeta(creatorMeta);
    } catch (err: any) {
      console.error("Preview error:", err);
      setPreviewError(err?.message || "Gagal memuat preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreviewModal = () => {
    // Test hook: closePreviewModal()
    // - Menutup modal preview dan mereset state terkait.
    setShowPreviewModal(false);
    setPreviewRecord(null);
    setPreviewError(null);
    setPreviewCreatorMeta(null);
  };

  const filteredHistories = useMemo(() => {
    // Test hook: filteredHistories (useMemo)
    // - Filter client-side untuk fitur pencarian pada kolom penting.
    // - Gunakan untuk memastikan hasil pencarian konsisten.
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
    // Test hook: handleDelete(id)
    // - Memanggil endpoint legacy `${API_BASE}/api/history/:id` untuk menghapus.
    // - Setelah sukses, menghapus entry dari state lokal `histories`.
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

      setHistories((prev) => prev.filter((h) => h.id !== id));
      alert("Record berhasil dihapus");
    } catch (err) {
      console.error("Delete network error:", err);
      alert("Terjadi kesalahan saat menghapus record");
    }
  };

  if (loading) {
    return (
      <>
        <main className={s.content}>
          <div className={h.historyContainer}>
            <div className={h.card} style={{ textAlign: "center" }}>Memuat data...</div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
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
                        {normalizeDestinationLabel(record.tujuan_pengiriman)}
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
                        {userRole !== 'dokter' && userRole !== 'superadmin' && (
                          <button
                            className={h.deleteButton}
                            onClick={() => handleDelete(record.id)}
                            title="Hapus"
                            type="button"
                          >
                            🗑️
                          </button>
                        )}
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
                    {previewCreatorMeta && (
                      <div>
                        <strong>Dibuat Oleh</strong>
                        <p>{previewCreatorMeta?.display_name || previewCreatorMeta?.username || previewCreatorMeta?.email || '-'}</p>
                      </div>
                    )}
                    <div>
                      <strong>Tanggal</strong>
                      <p>{previewRecord.tanggal || formatDate(previewRecord.created_at)}</p>
                    </div>
                    <div>
                      <strong>Jaringan</strong>
                      <p>{previewRecord.jaringan || '-'}</p>
                    </div>
                    <div>
                      <strong>Lokasi</strong>
                      <p>{previewRecord.lokasi || '-'}</p>
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
              {previewRecord && userRole !== 'dokter' && (
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
    </>
  );
}
