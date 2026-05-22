"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from 'date-fns';
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";
import s from "@/app/styles/dashboard.module.css"; // reuse layout styles
import h from "@/app/styles/collections.module.css";   // styles khusus collections

type UserMeta = {
  username?: string;
  avatar_url?: string;
  [k: string]: any;
};

type CollectionItem = Record<string, any>;

const REPORT_FIELD_ORDER = [
  'kunjungan',
  'tanggal',
  'waktu',
  'nomor_pa',
  'id_simgos',
  'jenis_pemeriksaan',
  'pa_sebelumnya',
  'asisten',
  'dokter',
  'oleh',
  'status',
  'status_data',
  'status_pengiriman',
  'jaringan',
  'lokasi',
  'topography',
  'morphology',
  'grade',
  'perilaku_tumor',
  'didapat_dengan',
  'cairan_fiksasi',
  'diagnosa_klinik',
  'keterangan_klinik',
  'makroskopik',
  'mikroskopik',
  'kesimpulan',
  'permintaan_ihc',
  'imuno_histokimia',
  'bukan_tumor',
  'reevolusi',
  'tanggal_imuno',
  'created_at',
  'user_id',
];

function formatFieldName(key: string) {
  const normalized = key.toLowerCase();
  const friendly = FIELD_LABELS[normalized.toUpperCase() as keyof typeof FIELD_LABELS];
  if (friendly) return friendly;
  return normalized
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderFieldValue(value: any) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function getReportFieldKeys(item: CollectionItem) {
  const ordered = REPORT_FIELD_ORDER.filter((key) => key in item);
  const otherKeys = Object.keys(item).filter((key) => !ordered.includes(key));
  return [...ordered, ...otherKeys];
}

function getReportText(item: CollectionItem) {
  return getReportFieldKeys(item)
    .map((fieldKey) => `${formatFieldName(fieldKey)}: ${renderFieldValue(item[fieldKey])}`)
    .join('\n');
}

function formatItemDate(item: CollectionItem) {
  if (item.tanggal) {
    const parts = String(item.tanggal).split('-').map(Number);
    if (parts.length === 3) {
      const [year, month, day] = parts;
      const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const datePart = `${String(day).padStart(2, '0')} ${monthNames[(month || 1) - 1]} ${year}`;
      const timePart = item.waktu ? String(item.waktu).substring(0, 5) : '';
      return timePart ? `${datePart} | ${timePart}` : datePart;
    }
    return item.tanggal + (item.waktu ? ` | ${String(item.waktu).substring(0, 5)}` : '');
  }
  if (item.created_at) {
    try {
      return format(new Date(item.created_at), 'dd MMM yyyy | HH:mm');
    } catch {
      return String(item.created_at);
    }
  }
  return item.id || '';
}

function parseJsonSummary(text: string | null | undefined): Record<string, string> | null {
  if (!text) return null;
  const raw = text.trim();
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < 0) return null;
  const candidate = raw.substring(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed).reduce((acc, [key, value]) => {
        acc[key] = value == null ? '' : String(value);
        return acc;
      }, {} as Record<string, string>);
    }
  } catch {
    return null;
  }
  return null;
}

const FIELD_LABELS: Record<string, string> = {
  MAKROSKOPIK: 'Makroskopik',
  MIKROSKOPIK: 'Mikroskopik',
  KESIMPULAN: 'Kesimpulan',
  JARINGAN: 'Jaringan',
  LOKASI: 'Lokasi',
  DIAGNOSA_KLINIK: 'Diagnosa Klinik',
  KETERANGAN_KLINIK: 'Keterangan Klinik',
  DIDAPAT_DENGAN: 'Diperoleh dengan',
  CAIRAN_FIKSASI: 'Cairan Fiksasi',
};

function renderStructuredSummary(summary: string | null | undefined) {
  const json = parseJsonSummary(summary);
  if (!json) return null;
  const keys = Object.keys(json);
  if (!keys.length) return null;

  const mainFields = ['MAKROSKOPIK', 'MIKROSKOPIK', 'KESIMPULAN'];
  const hasMain = mainFields.some((k) => json[k]);

  return (
    <div className={h.summaryStructured}>
      {hasMain && (
        <>
          {mainFields.map((field) => (
            json[field] ? (
              <p key={field} className={field === 'KESIMPULAN' ? h.conclusionLine : undefined}>
                <strong>{FIELD_LABELS[field] || field}:</strong> {json[field]}
              </p>
            ) : null
          ))}
          <hr />
        </>
      )}
      {keys.map((key) => {
        if (mainFields.includes(key)) return null;
        const value = json[key];
        if (!value) return null;
        return (
          <p key={key}>
            <strong>{FIELD_LABELS[key] || key}:</strong> {value}
          </p>
        );
      })}
    </div>
  );
}

function decodeJwtPayload(token: string | null | undefined) {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(base64).split('').map((c) => '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const SAMPLE: CollectionItem[] = [];

export default function CollectionsPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  // auth/session
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [meta, setMeta] = useState<UserMeta>({});
  const [userRole, setUserRole] = useState<string>('');
  const [tokenRole, setTokenRole] = useState<string>('');
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileStatus, setProfileStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CollectionItem[]>(SAMPLE);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!session) {
        router.replace("/login");
        return;
      }
      setEmail(session.user.email || "");
      const sessionMeta = (session.user.user_metadata as UserMeta) || {};
      setMeta(sessionMeta);
      const effectiveRole = ((session.user.user_metadata as any)?.role || 'dokter').toString().toLowerCase();
      setUserRole(effectiveRole);
      const decoded = decodeJwtPayload(session.access_token);
      const tokenClaimRole = ((decoded as any)?.role || '').toString().toLowerCase();
      setTokenRole(tokenClaimRole);
      const isPetugas = effectiveRole === 'petugas';
      // fetch user summaries from Supabase (only for authenticated user)
      try {
        const userId = session.user.id;

        let query = supabase
          .from('hasil_patologi')
          .select('*')
          .order('created_at', { ascending: false });

        if (userId && !isPetugas) query = query.eq('user_id', userId) as any;

        console.debug('Collections fetch', {
          userId,
          effectiveRole,
          tokenClaimRole,
          isPetugas,
          sessionMeta,
          decodedJwtRole: tokenClaimRole,
          query: userId && !isPetugas ? 'own records only' : 'all records',
        });

        const { data, error } = await query;

        if (error) {
          console.error('Error fetching pathology records:', error?.message || error, error?.details || 'no details');
        } else if (data) {
          setItems(data as CollectionItem[]);
        }
      } catch (err) {
        console.error('Unexpected error fetching collections', err);
      } finally {
        setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (!sess) router.replace("/login");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showProfileDropdown) {
        const target = event.target as Element;
        if (!target.closest(`.${s.avatar}`)) {
          setShowProfileDropdown(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProfileDropdown]);

  const username = meta.username || email.split("@")[0] || "User";
  const avatar = meta.avatar_url || "https://i.pravatar.cc/64?img=12";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      Object.values(it)
        .filter((value) => value !== null && value !== undefined)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [items, query]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("Transkrip tersalin ✅");
    } catch {
      alert("Gagal menyalin.");
    }
  };

  const handleDelete = (id: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus koleksi ini?")) return;

    // optimistic UI update
    const prev = items;
    setItems((p) => p.filter((x) => x.id !== id));

    (async () => {
      try {
        const userRes = await supabase.auth.getUser();
        const userId = userRes?.data?.user?.id;
        if (!userId) {
          throw new Error('User tidak terautentikasi');
        }
        const { data: deleted, error } = await supabase
          .from('hasil_patologi')
          .delete()
          .eq('id', id)
          .eq('user_id', userId)
          .select('id');

        if (error) throw error;
        // If no rows were returned, nothing was deleted (maybe RLS or mismatch)
        if (!deleted || (Array.isArray(deleted) && deleted.length === 0)) {
          throw new Error('Tidak dapat menghapus baris di database (akses ditolak atau baris tidak ditemukan)');
        }
      } catch (err: any) {
        alert('Gagal menghapus koleksi: ' + (err?.message || String(err)));
        setItems(prev); // rollback
      }
    })();
  };

  const onLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const toggleProfileDropdown = () => {
    setShowProfileDropdown(!showProfileDropdown);
  };

  const closeProfileDropdown = () => {
    setShowProfileDropdown(false);
  };

  const openProfileModal = () => {
    setProfileName(meta.display_name || meta.username || email.split("@")[0] || "");
    setProfileEmail(email);
    setProfileStatus(null);
    setShowProfileDropdown(false);
    setShowProfileModal(true);
  };

  const closeProfileModal = () => {
    setShowProfileModal(false);
    setProfileStatus(null);
  };

  const saveProfile = async () => {
    setProfileStatus(null);
    if (!profileName.trim()) {
      setProfileStatus({ type: "error", message: "Nama tidak boleh kosong." });
      return;
    }
    if (!profileEmail.trim()) {
      setProfileStatus({ type: "error", message: "Email tidak boleh kosong." });
      return;
    }

    setIsSavingProfile(true);
    const { data: { user }, error } = await supabase.auth.updateUser({
      email: profileEmail,
      data: {
        display_name: profileName,
        username: profileName,
      },
    });

    if (error) {
      setProfileStatus({ type: "error", message: error.message });
      setIsSavingProfile(false);
      return;
    }

    const userMeta = (user?.user_metadata as UserMeta) || {};
    setMeta(userMeta);
    setEmail(user?.email || profileEmail);
    setProfileStatus({ type: "success", message: "Profil berhasil disimpan." });
    setIsSavingProfile(false);
  };

  if (loading) {
    return (
      <div className={s.app}>
        <main className={s.content}>
          <div className={s.card}>Loading collections...</div>
        </main>
      </div>
    );
  }

  return (
    <div className={s.app}>
      {/* SIDEBAR */}
      <aside className={s.sidebar}>
        <div className={s.sbInner}>
          <div className={s.brand}>
            <Image
              src="/logo_neurabot.jpg"
              alt="Logo Neurabot"
              width={36}
              height={36}
              className={s.brandImg}
            />
            <div className={s.brandName}>PathoNote</div>
          </div>

          <nav className={s.nav} aria-label="Sidebar">
            <a className={s.navItem} href="/dashboard">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9,22 9,12 15,12 15,22"></polyline>
              </svg>
              <span>Dashboard</span>
            </a>
            <a className={`${s.navItem} ${s.active}`} href="/collections">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12,6 12,12 16,14"></polyline>
              </svg>
              <span>Collections</span>
            </a>
            <a className={s.navItem} href="/history">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12,8 12,12 15,15"></polyline>
              </svg>
              <span>History</span>
            </a>
            <a className={s.navItem} href="/settings">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span>Settings</span>
            </a>
          </nav>

          <div className={s.sbFooter}>
            <div style={{ opacity: 0.6 }}>© 2025 Neurabot</div>
          </div>
        </div>
      </aside>

      {/* TOPBAR */}
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
                placeholder="Search laporan..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search laporan"
              />
            </div>
          </div>

          <div className={s.rightGroup}>
            <div className={s.avatar} onClick={toggleProfileDropdown}>
              <Image
                src={avatar}
                alt="Foto profil"
                width={36}
                height={36}
                unoptimized
              />
              <div className={s.meta}>
                <div className={s.name}>{username}</div>
              </div>
              
              {showProfileDropdown && (
                <div className={s.profileDropdown}>
                  <button className={s.dropdownItem} onClick={openProfileModal}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    Profile
                  </button>
                  <button className={s.dropdownItem} onClick={onLogout}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                      <polyline points="16,17 21,12 16,7"></polyline>
                      <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* CONTENT */}
      <main className={s.content}>
        <div className={h.historyContainer}>
          <div className={h.historyHeader}>
            <h2 className={h.title}>Collections</h2>
            <div style={{ marginTop: 8, fontSize: 14, color: '#666' }}>
              Role saat ini: <strong>{userRole || 'memuat...'}</strong>
              {userRole === 'petugas' ? ' — Menampilkan semua koleksi' : ' — Menampilkan koleksi milik Anda'}
              <br />
              JWT claim: <strong>{tokenRole || 'tidak ada'}</strong>
              {userRole === 'petugas' && !tokenRole ? (
                <div style={{ color: '#b33', marginTop: 4 }}>
                  Token belum punya claim role. Coba logout/login lagi.
                </div>
              ) : null}
            </div>
            <div className={h.headerActions}>
              <button className={h.actionButton} onClick={() => alert('Export functionality coming soon!')}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7,10 12,15 17,10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Export
              </button>

            </div>
          </div>

          {filtered.length === 0 ? (
            <div className={h.emptyState}>
              <div className={h.emptyIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8v5l4 2"></path>
                  <path d="M21 12A9 9 0 1 1 3 12"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
              </div>
              <h3>No Reports Yet</h3>
              <p>Start using Voice to Text to see your pathology reports from Supabase here.</p>
            </div>
          ) : (
            <div className={h.historyGrid}>
              {filtered.map((it) => (
                <article key={it.id} className={h.historyCard}>
                  <div className={h.cardHeader}>
                    <div className={h.cardDate}>
                      <span className={h.dateIcon}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                          <line x1="16" y1="2" x2="16" y2="6"></line>
                          <line x1="8" y1="2" x2="8" y2="6"></line>
                          <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                      </span>
                      {formatItemDate(it)}
                    </div>
                    <div className={h.cardTopActions}>
                      <button className={h.exportBtn} onClick={() => alert('Export functionality coming soon!')} title="Export">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7,10 12,15 17,10"></polyline>
                          <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                      </button>

                    </div>
                  </div>

                  <div className={h.cardContent}>
              <div>
                <div className={h.transcript} style={{ fontWeight: 700, marginBottom: 8 }}>
                  [{it.nomor_pa || 'AUTO'}] - {it.jaringan || it.lokasi || '-'}
                </div>
                <div className={h.summary} style={{ marginBottom: 8 }}>
                  <strong>Kesimpulan:</strong> {it.kesimpulan || '-'}
                </div>
                <div className={h.itemDate}>
                  {formatItemDate(it) || '-'}
                </div>
              </div>
            </div>

            <div className={h.cardActions}>
              <button className={`${h.actionBtn} ${h.secondaryBtn}`} onClick={() => router.push(`/detail/${it.id}`)}>
                <span className={h.btnIcon}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </span>
                View Details
              </button>
              <button className={`${h.actionBtn} ${h.secondaryBtn}`} onClick={() => handleCopy(getReportText(it))}>
                <span className={h.btnIcon}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                  </svg>
                </span>
                Copy
              </button>
              <button className={`${h.actionBtn} ${h.dangerBtn}`} onClick={() => handleDelete(it.id)}>
                <span className={h.btnIcon}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3,6 5,6 21,6"></polyline>
                    <path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </span>
                Delete
              </button>
            </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Profile Modal */}
      {showProfileModal && (
        <div className={s.profileModalOverlay} onClick={closeProfileModal}>
          <div className={s.profileModal} onClick={(event) => event.stopPropagation()}>
            <div className={s.profileModalHeader}>
              <div>
                <h2>Edit Profil</h2>
                <p className={s.profileModalNotice}>Nama dan email diambil dari akun Supabase Anda.</p>
              </div>
              <button className={s.modalClose} onClick={closeProfileModal} aria-label="Tutup">×</button>
            </div>

            <div className={s.profileModalBody}>
              <label className={s.formRow}>
                <span>Nama</span>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Nama tampil"
                />
              </label>
              <label className={s.formRow}>
                <span>Email</span>
                <input
                  type="email"
                  value={profileEmail}
                  onChange={(e) => setProfileEmail(e.target.value)}
                  placeholder="Email"
                />
              </label>
            </div>

            {profileStatus && (
              <div className={profileStatus.type === "error" ? s.profileError : s.profileSuccess}>
                {profileStatus.message}
              </div>
            )}

            <div className={s.profileModalFooter}>
              <button className={s.buttonSecondary} onClick={closeProfileModal} type="button">
                Batal
              </button>
              <button className={s.buttonPrimary} onClick={saveProfile} type="button" disabled={isSavingProfile}>
                {isSavingProfile ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
