"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from 'date-fns';
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";
import s from "@/app/styles/dashboard.module.css"; // reuse layout styles
import h from "@/app/styles/collections.module.css";   // styles khusus collections
import { getSessionUserProfile } from '@/app/lib/userProfile';

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

// Test hook: formatFieldName(key)
// - Mengubah nama field teknis menjadi label yang ramah-tampilan.

function renderFieldValue(value: any) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

// Test hook: renderFieldValue(value)
// - Normalisasi nilai field untuk ditampilkan (stringify, boolean, null handling).

function getReportFieldKeys(item: CollectionItem) {
  const ordered = REPORT_FIELD_ORDER.filter((key) => key in item);
  const otherKeys = Object.keys(item).filter((key) => !ordered.includes(key));
  return [...ordered, ...otherKeys];
}

// Test hook: getReportFieldKeys(item)
// - Menghasilkan urutan kunci report yang akan dirender atau diedit.

function getReportText(item: CollectionItem) {
  return getReportFieldKeys(item)
    .map((fieldKey) => `${formatFieldName(fieldKey)}: ${renderFieldValue(item[fieldKey])}`)
    .join('\n');
}

// Test hook: getReportText(item)
// - Mengembalikan teks lengkap report (plaintext) yang digunakan untuk share/copy.

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

// Test hook: formatItemDate(item)
// - Format tanggal/waktu item untuk tampilan kartu.

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

// Test hook: parseJsonSummary(text)
// - Mencoba mengekstrak JSON embedded dalam teks ringkasan.

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

// Test hook: renderStructuredSummary(summary)
// - Mengkonversi ringkasan terstruktur menjadi elemen JSX untuk tampilan.

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

// Test hook: decodeJwtPayload(token)
// - Mendekode payload JWT dari access token untuk mengambil klaim role.

const SAMPLE: CollectionItem[] = [];

export default function CollectionsPage() {
  const router = useRouter();
  const supabase = supabaseBrowser;

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:5001";

  const [userMetaMap, setUserMetaMap] = useState<Record<string, UserMeta>>({});

  async function fetchUserMetaById(userId: string) {
    if (!userId) return null;
    if (userMetaMap[userId]) return userMetaMap[userId];
    try {
      const res = await fetch(`${API_BASE}/api/user-meta/${encodeURIComponent(userId)}`);
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      const meta = data?.user_metadata || data?.raw_user_meta_data || data?.user_metadata || {};
      setUserMetaMap((m) => ({ ...m, [userId]: meta }));
      return meta;
    } catch (e) {
      return null;
    }
  }

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

  // Initialize query from URL search param so topbar search navigates here
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('search') || '';
      if (q) setQuery(q);
    } catch {}
  }, []);

  // Preload user metadata for items' owners when items change
  useEffect(() => {
    const ids = Array.from(new Set(items.map((it) => it.user_id).filter(Boolean)));
    ids.forEach((id) => {
      if (!userMetaMap[id]) void fetchUserMetaById(id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

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
      const profile = getSessionUserProfile(session as any);
      setMeta(profile.meta || {});
      setUserRole(profile.role || 'dokter');
      const decoded = decodeJwtPayload(session.access_token);
      const tokenClaimRole = ((decoded as any)?.role || '').toString().toLowerCase();
      setTokenRole(tokenClaimRole);
      const isPetugasOrSuperadmin = (profile.role === 'petugas' || profile.role === 'superadmin');
      // fetch user summaries from Supabase (only for authenticated user)
      try {
        const userId = session.user.id;

        let query = supabase
          .from('hasil_patologi')
          .select('*')
          .order('created_at', { ascending: false });

        // Dokter should only see their own pathology records.
        if (profile.role === 'dokter') {
          query = query.eq('user_id', userId);
        }

        console.debug('Collections fetch', {
          userId,
          role: profile.role,
          tokenClaimRole,
          isPetugasOrSuperadmin,
          sessionMeta: profile.meta,
          query: profile.role === 'dokter' ? 'own records only' : 'all records',
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

  // Split by status_pengiriman: ready vs others (waiting)
  const waitingItems = filtered.filter((it) => String(it.status_pengiriman || '').toLowerCase().trim() !== 'ready');
  const readyItems = filtered.filter((it) => String(it.status_pengiriman || '').toLowerCase().trim() === 'ready');

  const updateStatusPengiriman = async (id: string, status: string) => {
    const normalizedStatus = String(status).toLowerCase().trim();
    if (normalizedStatus !== 'pending' && normalizedStatus !== 'ready') {
      console.warn(`Attempted to set unsupported status_pengiriman: ${status}`);
      return;
    }

    // optimistic update
    const prev = items;
    setItems((p) => p.map((it) => (it.id === id ? { ...it, status_pengiriman: normalizedStatus } : it)));
    try {
      const { data, error } = await supabase
        .from('hasil_patologi')
        .update({ status_pengiriman: normalizedStatus })
        .eq('id', id)
        .select('id, status_pengiriman') as any;

      if (error) throw error;
      // refresh local item with returned value if provided
      if (data && Array.isArray(data) && data[0]) {
        const updated = data[0];
        setItems((p) => p.map((it) => (it.id === id ? { ...it, status_pengiriman: updated.status_pengiriman } : it)));
      }
    } catch (err: any) {
      alert('Gagal memperbarui status: ' + (err?.message || String(err)));
      setItems(prev);
    }
  };

  const renderCard = (it: CollectionItem) => (
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
          {tokenRole !== 'authenticated' && (
            <button className={h.exportBtn} onClick={() => alert('Export functionality coming soon!')} title="Export">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7,10 12,15 17,10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          )}

        </div>
      </div>

      <div className={h.cardContent}>
        <div>
          <div className={h.transcript} style={{ fontWeight: 700, marginBottom: 8 }}>
            [{it.nomor_pa || 'AUTO'}] - {it.jaringan || it.lokasi || '-'}
          </div>
          <div style={{ marginBottom: 6, color: '#555', fontSize: 13 }}>
            <strong>Oleh:</strong> {userMetaMap[it.user_id]?.username || it.user_id || '-'}
          </div>
          <div className={h.summary} style={{ marginBottom: 8 }}>
            <strong>Kesimpulan:</strong> {it.kesimpulan || '-'}
          </div>
          <div className={h.itemDate}>
            {formatItemDate(it) || '-'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <div style={{ background: (String(it.status_pengiriman || '').toLowerCase() === 'ready' ? '#e6ffed' : '#fff7e6'), padding: '4px 8px', borderRadius: 6, fontSize: 12 }}>
              <strong>Status Kirim:</strong> {String(it.status_pengiriman || 'pending')}
            </div>
              {userRole === 'petugas' && (() => {
                const st = String(it.status_pengiriman || '').toLowerCase().trim();
                return (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {st !== 'ready' && (
                      <button className={`${h.actionBtn} ${h.secondaryBtn}`} onClick={() => updateStatusPengiriman(it.id, 'ready')}>
                        Set Ready
                      </button>
                    )}
                    {st === 'ready' && (
                      <button className={`${h.actionBtn} ${h.secondaryBtn}`} onClick={() => updateStatusPengiriman(it.id, 'pending')}>
                        Set Pending
                      </button>
                    )}
                  </div>
                );
              })()}
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
        {userRole !== 'superadmin' && (
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
        )}
      </div>
    </article>
  );

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
      <main className={s.content}>
        <div className={s.card}>Loading collections...</div>
      </main>
    );
  }

  return (
    <>
      {/* CONTENT */}
      <div className={h.historyContainer}>
          <div className={h.historyHeader}>
            <div className={h.headerActions}>
              {(userRole !== 'superadmin' && tokenRole !== 'authenticated') && (
                <button className={h.actionButton} onClick={() => alert('Export functionality coming soon!')}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7,10 12,15 17,10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Export
                </button>
              )}
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
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginTop: 6, marginBottom: 8 }}>Menunggu Review</h3>
                <div className={h.historyGrid}>
                  {waitingItems.map((it) => renderCard(it))}
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <h3 style={{ marginTop: 6, marginBottom: 8 }}>Ready</h3>
                <div className={h.historyGrid}>
                  {readyItems.map((it) => renderCard(it))}
                </div>
              </div>
            </div>
          )}
        </div>
    </>
    );
}

