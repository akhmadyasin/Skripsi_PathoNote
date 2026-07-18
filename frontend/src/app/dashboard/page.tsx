"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import s from "@/app/styles/dashboard.module.css";
import VoicePanel from "@/app/components/VoicePanel";
import { supabaseBrowser } from "@/app/lib/supabaseClient";
import { getSessionUserProfile } from "@/app/lib/userProfile";

type UserMeta = {
  username?: string;
  display_name?: string;
  role?: string;
  avatar_url?: string;
  [k: string]: unknown;
};

type DashboardStats = {
  totalRecords: number;
  pendingTasks: number;
  distributedCount: number;
};

type DashboardActivityItem = {
  id: string;
  title: string;
  description: string;
  time: string;
  status: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:5001";

export default function Dashboard() {
  const router = useRouter();
  const supabase = supabaseBrowser;

  // auth/session
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [meta, setMeta] = useState<UserMeta>({});

  // ui state
  const [listening, setListening] = useState(false);
  const [role, setRole] = useState("dokter");
  const canUseVoice = role !== "petugas";

  const toggleListening = () => {
    if (role === "petugas") return;
    setListening((v) => !v);
  };

  const [stats, setStats] = useState<DashboardStats>({
    totalRecords: 0,
    pendingTasks: 0,
    distributedCount: 0,
  });
  const [activityItems, setActivityItems] = useState<DashboardActivityItem[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

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
      setEmail(profile.email);
      setMeta(profile.meta as UserMeta);
      setRole(profile.role);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (!sess) router.replace("/login");
    });

    const loadDashboardData = async () => {
      try {
        // Load recent pathology records for the current authenticated user only
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id || null;
        const profile = getSessionUserProfile(session as any);
        const currentRole = profile.role;

        const isPetugas = currentRole === "petugas";
        const isSuperadmin = currentRole === "superadmin";

        let recordsForStats: Array<Record<string, unknown>> = [];
        let recordsForActivity: Array<Record<string, unknown>> = [];
        if (userId) {
          const statsQuery = supabase
            .from("hasil_patologi")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(50);

          // Only restrict to user's own records when role is `dokter`.
          // Petugas should see records available for distribution (not limited to user_id).
          if (currentRole === "dokter") {
            statsQuery.eq("user_id", userId);
          }

          const { data: statsData, error: statsError } = await statsQuery;
          if (statsError) throw statsError;
          recordsForStats = Array.isArray(statsData) ? statsData : [];

          const activityQuery = supabase
            .from("hasil_patologi")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(50);

          if (currentRole === "dokter") {
            activityQuery.eq("user_id", userId);
          }

          const { data: activityData, error: activityError } = await activityQuery;
          if (activityError) throw activityError;
          recordsForActivity = Array.isArray(activityData) ? activityData : [];
        } else {
          recordsForStats = [];
          recordsForActivity = [];
        }

        const getStatusValue = (item: Record<string, unknown>) => {
          const statusPengiriman = String((item as { status_pengiriman?: string | number }).status_pengiriman || "").trim().toLowerCase();
          if (statusPengiriman) return statusPengiriman;
          return String((item as { status?: string | number }).status || "").trim().toLowerCase();
        };

        const totalRecords = recordsForStats.length;
        const pendingTasks = recordsForStats.filter((item) => {
          const status = getStatusValue(item);
          return status !== "ready";
        }).length;

        const historyCountQuery = supabase
          .from("history_pengiriman")
          .select("id", { count: "exact", head: true })
          .or("metode_pengiriman.ilike.%email%,tujuan_pengiriman.ilike.%email%")
          .or("status.ilike.%success%,status.ilike.%terkirim%,status.ilike.%completed%,status.ilike.%done%,status.ilike.%sent%");

        if (currentRole === "dokter") {
          historyCountQuery.eq("petugas_id", userId);
        }

        const { count: distributedCount, error: distributedCountError } = await historyCountQuery;
        const distributed = distributedCountError ? 0 : Number(distributedCount || 0);

        let history: Array<Record<string, unknown>> = [];
        if (userId) {
          const { data: historyData, error: historyError } = await supabase
            .from("history_pengiriman")
            .select("*")
            .eq("petugas_id", userId)
            .order("created_at", { ascending: false })
            .limit(8);

          if (historyError) {
            console.warn("Failed to load dashboard activity from history_pengiriman:", historyError);
          } else {
            history = Array.isArray(historyData) ? historyData : [];
            if (currentRole !== "superadmin") {
              history = history.filter((record) => {
                const method = String(record.metode_pengiriman || record.metode || "").toLowerCase();
                return method !== "create_user" && method !== "delete_user";
              });
            }
          }
        }

        const activityFeed = [
          ...history.map((item) => ({ ...item, __source: "history_pengiriman" })),
          ...recordsForActivity.map((item) => ({ ...item, __source: "hasil_patologi" })),
        ]
          .filter(Boolean)
          // Only include activities related to the current user account
          .filter((it) => {
            if (!userId) return false;
            const src = (it as any).__source;
            if (src === "history_pengiriman") {
              return String((it as any).petugas_id || "") === String(userId);
            }
            if (src === "hasil_patologi") {
              return String((it as any).user_id || "") === String(userId);
            }
            return false;
          })
          .sort((a, b) => {
            const aTime = String((a as Record<string, unknown>).created_at || "");
            const bTime = String((b as Record<string, unknown>).created_at || "");
            if (!aTime && !bTime) return 0;
            if (!aTime) return 1;
            if (!bTime) return -1;
            return new Date(bTime).getTime() - new Date(aTime).getTime();
          })
          .reduce((acc: Array<Record<string, unknown>>, item) => {
            const src = (item as any).__source;
            const accountId = src === "history_pengiriman"
              ? String((item as any).petugas_id || "")
              : String((item as any).user_id || "");
            const currentCount = acc.filter((existing) => {
              const existingSrc = (existing as any).__source;
              const existingAccountId = existingSrc === "history_pengiriman"
                ? String((existing as any).petugas_id || "")
                : String((existing as any).user_id || "");
              return existingAccountId === accountId;
            }).length;
            if (currentCount < 3) acc.push(item);
            return acc;
          }, [])
          .slice(0, 8);

        const mappedActivities = activityFeed.map((item, index) => {
          const record = item as Record<string, unknown> & { __source?: string };
          const source = record.__source;
          const method = source === "hasil_patologi"
            ? "hasil pemeriksaan dibuat"
            : String(record.metode_pengiriman || record.metode || "Aktivitas").replace(/_/g, " ");
          const destination = String(record.tujuan_pengiriman || record.tujuan || "").trim();
          const statusValue = String(record.status || "").toLowerCase();
          const createdAt = String(record.created_at || "");
          const time = createdAt ? new Date(createdAt).toLocaleString("id-ID", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          }) : "Baru saja";

          const statusLabel = ["success", "terkirim", "completed", "done", "sent", "2"].includes(statusValue)
            ? "Terkirim"
            : statusValue === "failed" || statusValue === "gagal"
              ? "Gagal"
              : statusValue === "pending" || statusValue === "draft" || statusValue === "received" || statusValue === "1"
                ? "Diproses"
                : "Aktif";

          const description = source === "hasil_patologi"
            ? (String(record.nomor_pa || record.kunjungan || "Record hasil pemeriksaan dibuat").trim() || "Record hasil pemeriksaan dibuat")
            : (destination || `Aksi ${method} tercatat`);

          return {
            id: String((item as { id?: string }).id || `${index}`),
            title: `${method.charAt(0).toUpperCase() + method.slice(1)}${destination ? ` · ${destination}` : ""}`,
            description,
            time,
            status: statusLabel,
          };
        });

        if (!mounted) return;
        setStats({ totalRecords, pendingTasks, distributedCount: distributed });
        setActivityItems(mappedActivities);
      } catch {
        if (!mounted) return;
        setActivityItems([]);
        setStats({ totalRecords: 0, pendingTasks: 0, distributedCount: 0 });
      } finally {
        if (mounted) setStatsLoading(false);
      }
    };

    loadDashboardData();

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  const roleLabel = role === "petugas" ? "Petugas" : role === "superadmin" ? "Superadmin" : "Dokter";
  const summaryCards = [
    {
      title: role === "petugas" ? "Data Tersedia" : role === "superadmin" ? "Total Rekam Sistem" : "Total Rekam Saya",
      value: statsLoading ? "..." : stats.totalRecords,
      subtext: role === "petugas"
        ? "Rekam yang bisa Anda distribusikan"
        : role === "superadmin"
          ? "Semua rekam hasil pemeriksaan yang terkelola"
          : "Rekam hasil pemeriksaan Anda",
    },
    {
      title: role === "petugas" ? "Menunggu Distribusi" : role === "superadmin" ? "Butuh Tindakan" : "Masih Diproses",
      value: statsLoading ? "..." : stats.pendingTasks,
      subtext: role === "petugas"
        ? "Masih menunggu penyaluran ke tujuan"
        : role === "superadmin"
          ? "Rekam yang masih belum selesai ditangani"
          : "Masih menunggu proses akhir",
    },
    {
      title: "Sudah Didistribusikan",
      value: statsLoading ? "..." : stats.distributedCount,
      subtext: role === "petugas"
        ? "Distribusi via email yang sudah selesai"
        : role === "superadmin"
          ? "Semua distribusi email yang sudah terdata"
          : "Distribusi email Anda yang sudah selesai",
    },
  ];

  if (loading) {
    return (
      <div className={s.dashboardContainer}>
        <div className={s.card}>Memuat dashboard…</div>
      </div>
    );
  }

  return (
    <>
      {/* Tampilan Dashboard Utama */}
      <div className={s.dashboardContainer} style={{ display: listening ? 'none' : 'block' }}>
        {role === "petugas" && (
          <div style={{ marginBottom: 18, padding: 16, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 14, color: '#92400e' }}>
            Akses Voice Panel dibatasi untuk role <strong>Petugas</strong>. Untuk membuka Voice Panel, gunakan akun dengan role <strong>Dokter</strong>.
          </div>
        )}
        {role === "superadmin" && (
          <div style={{ marginBottom: 18, padding: 16, background: 'rgba(56, 182, 255, 0.12)', border: '1px solid rgba(56, 182, 255, 0.25)', borderRadius: 14, color: '#1fa4f5' }}>
            <p style={{ margin: 0, fontWeight: 600 }}>Superadmin control</p>
            <p style={{ margin: '8px 0 12px', color: '#334155' }}>Create new user accounts from here.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a href="/register" style={{ display: 'inline-block', padding: '10px 16px', background: '#38b6ff', color: 'white', borderRadius: 8, textDecoration: 'none', fontWeight: 500, fontSize: 14, transition: 'all 0.3s ease' }}
                onMouseEnter={(e) => {e.currentTarget.style.background = '#1fa4f5'; e.currentTarget.style.transform = 'translateY(-2px)';}}
                onMouseLeave={(e) => {e.currentTarget.style.background = '#38b6ff'; e.currentTarget.style.transform = 'translateY(0)';}}
              >
                Open Create User Page
              </a>
              <a href="/users" style={{ display: 'inline-block', padding: '10px 16px', background: '#f8fafc', color: '#0f172a', borderRadius: 8, textDecoration: 'none', fontWeight: 500, fontSize: 14, transition: 'all 0.3s ease', border: '1px solid #dbe4ee' }}
                onMouseEnter={(e) => {e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.transform = 'translateY(-2px)';}}
                onMouseLeave={(e) => {e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.transform = 'translateY(0)';}}
              >
                View User List
              </a>
            </div>
          </div>
        )}

        <div className={s.topCards}>
          {summaryCards.map((card, index) => (
            <div className={s.statsCard} key={`${card.title}-${index}`}>
              <div className={s.cardIcon}>
                {index === 0 ? (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18"></path><path d="M5 7v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7"></path><path d="M8 11h8"></path><path d="M8 15h5"></path></svg>
                ) : index === 1 ? (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M3 10h18"></path></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                )}
              </div>
              <div className={s.cardContent}>
                <h3>{card.title}</h3>
                <div className={s.cardValue}>{card.value}</div>
                <div className={s.cardSubtext}>{card.subtext}</div>
              </div>
            </div>
          ))}
        </div>

        <div className={s.activitySection}>
          <h2><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px', display: 'inline-block', verticalAlign: 'middle'}}><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg> Recent Activity</h2>
          <div className={s.activityCard}>
            <div className={s.activityHeader}>
              <div className={s.activityTitle}>Aktivitas terbaru</div>
              <div className={s.activityStatus}>Live</div>
            </div>
            <div className={s.activityContent}>
              {activityItems.length === 0 ? (
                <div className={s.activityItem}>
                  <div className={s.activityInfo}>
                    <div className={s.activityName}>Belum ada aktivitas</div>
                    <div className={s.activityTime}>Data akan muncul setelah ada record baru</div>
                  </div>
                </div>
              ) : (
                activityItems.map((item, index) => (
                  <div key={`${item.id}-${index}`} className={s.activityItem}>
                    <div className={s.activityIcon}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                    <div className={s.activityInfo}>
                      <div className={s.activityName}>{item.title}</div>
                      <div className={s.activityTime}>{item.description}</div>
                    </div>
                    <div className={s.activityResult}>{item.status}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tampilan Voice Panel */}
      <div className={s.voiceWrap} style={{ display: listening ? 'block' : 'none' }}>
        <div className={s.voiceFrame}>
          <VoicePanel isOpen={listening} />
        </div>
      </div>
    </>
  );
}
