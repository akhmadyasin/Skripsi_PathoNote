"use client";

import { useEffect, useState } from "react";
import { format } from 'date-fns';
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

import s from "@/app/styles/dashboard.module.css";
import d from "@/app/styles/detail.module.css";
import h from "@/app/styles/collections.module.css";

type UserMeta = {
  username?: string;
  avatar_url?: string;
  [k: string]: any;
};

type PathologyRecord = Record<string, any>;

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

const NON_EDITABLE_FIELDS = new Set([
  'id',
  'user_id',
  'created_at',
  'updated_at',
]);

function isEditableField(key: string) {
  return !NON_EDITABLE_FIELDS.has(key.toLowerCase());
}

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

function getReportFieldKeys(item: PathologyRecord) {
  const ordered = REPORT_FIELD_ORDER.filter((key) => key in item);
  const otherKeys = Object.keys(item).filter((key) => !ordered.includes(key));
  return [...ordered, ...otherKeys];
}

function getReportText(item: PathologyRecord) {
  return getReportFieldKeys(item)
    .map((fieldKey) => `${formatFieldName(fieldKey)}: ${renderFieldValue(item[fieldKey])}`)
    .join('\n');
}

function formatItemDate(item: PathologyRecord) {
  if (item.tanggal) {
    return `${item.tanggal}${item.waktu ? ` | ${item.waktu}` : ''}`;
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
// Supports **bold** markers, list items starting with '- ', and preserves line breaks.
function renderSummaryHtml(src: string | undefined | null) {
  if (!src) return "";
  // escape HTML
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  const raw = escapeHtml(src);
  const lines = raw.split(/\r?\n/);
  let out: string[] = [];
  let inList = false;

  // Helper to close list if open
  const closeListIfOpen = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (line === '') {
      // blank line -> close lists and add separator
      closeListIfOpen();
      out.push('<p></p>');
      continue;
    }

    // list item
    if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      const item = line.substring(2).trim();
      const itemHtml = item.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      out.push(`<li>${itemHtml}</li>`);
      continue;
    }

    // bold-only header line like **Heading** or **Heading:**
    const mHeader = line.match(/^\*\*(.+?)\*\*:?$/);
    if (mHeader) {
      // close any open list first
      closeListIfOpen();
      const headingText = mHeader[1].trim();
      out.push(`<h2>${headingText}</h2>`);
      continue;
    }

    // fallback: inline bold formatting
    const inline = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // If this line looks like a subheading (ends with ':'), render as bold paragraph
    if (/^.+:$/.test(line)) {
      out.push(`<div><strong>${inline.replace(/:$/, '')}</strong></div>`);
    } else {
      out.push(`<div>${inline}</div>`);
    }
  }

  closeListIfOpen();
  return out.join('\n');
}

export default function DetailPage() {
  const router = useRouter();
  const params = useParams();
  const supabase = supabaseBrowser();
  const id = params.id as string;

  // auth/session
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [meta, setMeta] = useState<UserMeta>({});
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileStatus, setProfileStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // detail data
  const [detailData, setDetailData] = useState<PathologyRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editValues, setEditValues] = useState<Partial<PathologyRecord>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // share popup


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
      setMeta((session.user.user_metadata as UserMeta) || {});
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (!sess) router.replace("/login");
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, supabase]);

  // Load detail data
  // fetch function that can be retried
  const fetchDetail = async () => {
    if (!id) {
      router.replace('/collections');
      return;
    }

    setFetching(true);
    setErrorText(null);
    setNotFound(false);
    setDetailData(null);

    try {
      const { data, error } = await supabase
        .from('hasil_patologi')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching pathology record:', error);
        setErrorText(error.message || JSON.stringify(error));
        setNotFound(true);
        return;
      }

      if (!data) {
        setErrorText('No data returned');
        setNotFound(true);
        return;
      }

      setDetailData(data as PathologyRecord);
      setNotFound(false);
    } catch (err: any) {
      console.error('Unexpected error loading detail:', err);
      setErrorText(err?.message ? String(err.message) : String(err));
      setNotFound(true);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    // wait for auth/session to be ready
    if (!loading) fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loading]);

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

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Text copied to clipboard!");
  };

  const startEditing = () => {
    if (!detailData) return;
    const initial: Partial<PathologyRecord> = {};
    getReportFieldKeys(detailData)
      .filter(isEditableField)
      .forEach((field) => {
        initial[field] = detailData[field];
      });
    setEditValues(initial);
    setSaveStatus(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setSaveStatus(null);
  };

  const saveEdit = async () => {
    if (!detailData) return;
    setIsSaving(true);
    setSaveStatus(null);

    const updates: Record<string, any> = {};
    getReportFieldKeys(detailData)
      .filter(isEditableField)
      .forEach((field) => {
        if (field in editValues) {
          updates[field] = editValues[field];
        }
      });

    try {
      const { data, error } = await supabase
        .from('hasil_patologi')
        .update(updates)
        .eq('id', detailData.id)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      if (data) {
        setDetailData(data as PathologyRecord);
        setIsEditing(false);
        setSaveStatus({ type: 'success', message: 'Perubahan berhasil disimpan.' });
      }
    } catch (err: any) {
      console.error('Save error:', err);
      setSaveStatus({ type: 'error', message: err?.message || 'Gagal menyimpan perubahan.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!confirm("Are you sure you want to delete this transcription?")) return;

    (async () => {
      try {
        const userRes = await supabase.auth.getUser();
        const userId = userRes?.data?.user?.id;
        if (!userId) {
          alert('Anda belum login.');
          return;
        }
        const { data: deleted, error } = await supabase
          .from('hasil_patologi')
          .delete()
          .eq('id', id)
          .eq('user_id', userId)
          .select('id');

        if (error) {
          alert('Gagal menghapus: ' + error.message);
          console.error('Delete error:', error);
          return;
        }

        if (!deleted || (Array.isArray(deleted) && deleted.length === 0)) {
          alert('Gagal menghapus: baris tidak ditemukan atau akses ditolak (RLS).');
          return;
        }

        // success -> navigate back to collections
        router.push('/collections');
      } catch (err) {
        console.error('Unexpected delete error', err);
        alert('Gagal menghapus item.');
      }
    })();
  };

  const handleExport = () => {
    if (detailData) {
      const content = getReportText(detailData);
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcription-${detailData.id}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const username = meta.username || email.split("@")[0] || "User";
  const avatar = meta.avatar_url || "https://i.pravatar.cc/64?img=12";

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

  if (loading) {
    return (
      <div className={s.app}>
        <main className={s.content}>
          <div className={s.card}>Loading...</div>
        </main>
      </div>
    );
  }

  if (!detailData) {
    if (notFound) {
      return (
        <div className={s.app}>
          <main className={s.content}>
            <div className={s.card}>
              <h3>Data tidak ditemukan</h3>
              <p>Data hasil patologi yang diminta tidak ditemukan. Mungkin sudah dihapus atau ID tidak valid.</p>
              <p style={{ fontSize: 12, color: '#666' }}>Requested id: <strong>{id}</strong></p>
              {errorText && (
                <div style={{ marginTop: 8, color: '#b00' }}>
                  <strong>Error:</strong> {errorText}
                </div>
              )}
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className={d.actionButton} onClick={() => router.push('/collections')}>Kembali ke Collections</button>
                <button className={d.actionButton} onClick={() => fetchDetail()} disabled={fetching}>
                  {fetching ? 'Retrying...' : 'Retry'}
                </button>
              </div>
            </div>
          </main>
        </div>
      );
    }

    return (
      <div className={s.app}>
        <main className={s.content}>
          <div className={s.card}>Loading transcription...</div>
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
            <a href="/dashboard" className={s.navItem}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9,22 9,12 15,12 15,22"></polyline>
              </svg>
              <span>Dashboard</span>
            </a>
            <a href="/collections" className={s.navItem}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12,6 12,12 16,14"></polyline>
              </svg>
              <span>Collections</span>
            </a>
            <a href="/settings" className={s.navItem}>
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
          </div>

          <div className={s.rightGroup}>
            <div className={s.avatar} onClick={toggleProfileDropdown}>
              <Image src={avatar} alt="Foto profil" width={36} height={36} unoptimized />
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
        <div className={d.detailContainer}>
          <div className={d.detailHeader}>
            <div className={d.headerInfo}>
              <h1 className={d.detailTitle}>
                {detailData.nomor_pa ? `PA ${detailData.nomor_pa}` : 'Detail Hasil Patologi'}
              </h1>
              <div className={d.detailMeta}>
                <div className={d.metaItem}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  {formatItemDate(detailData)}
                </div>
                <div className={d.metaItem}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 4h18"></path>
                    <path d="M5 10h14"></path>
                    <path d="M7 16h10"></path>
                  </svg>
                  {detailData.jaringan ? `${detailData.jaringan}${detailData.lokasi ? ` • ${detailData.lokasi}` : ''}` : detailData.lokasi || '-'}
                </div>
              </div>
            </div>

            <div className={d.headerActions}>
              <button className={d.actionButton} onClick={() => router.push('/collections')}>
                Kembali
              </button>
              {!isEditing ? (
                <button className={d.actionButton} onClick={startEditing}>
                  Edit
                </button>
              ) : (
                <>
                  <button className={d.actionButton} onClick={saveEdit} disabled={isSaving}>
                    {isSaving ? 'Menyimpan...' : 'Simpan'}
                  </button>
                  <button className={d.secondaryButton} onClick={cancelEditing} disabled={isSaving}>
                    Batal
                  </button>
                </>
              )}
              <button className={d.actionButton} onClick={handleExport}>
                Export
              </button>
            </div>
          </div>

          {saveStatus && (
            <div className={saveStatus.type === 'success' ? d.saveSuccess : d.saveError} style={{ marginBottom: 16 }}>
              {saveStatus.message}
            </div>
          )}

          <div className={h.cardContent}>
            <div className={h.reportFields}>
              {getReportFieldKeys(detailData).map((fieldKey) => (
                <div key={fieldKey} className={h.reportFieldRow}>
                  <div className={h.reportFieldName}>{formatFieldName(fieldKey)}</div>
                  {isEditing && isEditableField(fieldKey) ? (
                    ['kesimpulan', 'makroskopik', 'mikroskopik', 'keterangan_klinik', 'diagnosa_klinik', 'didapat_dengan', 'cairan_fiksasi'].includes(fieldKey) ? (
                      <textarea
                        className={d.editTextarea}
                        value={String(editValues[fieldKey] ?? detailData[fieldKey] ?? '')}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                        rows={3}
                      />
                    ) : (
                      <input
                        className={d.editInput}
                        type="text"
                        value={String(editValues[fieldKey] ?? detailData[fieldKey] ?? '')}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, [fieldKey]: e.target.value }))}
                      />
                    )
                  ) : (
                    <div className={h.reportFieldValue}>{renderFieldValue(detailData[fieldKey])}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className={d.footerActions}>
            <button className={d.dangerButton} onClick={handleDelete}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3,6 5,6 21,6"></polyline>
                <path d="M19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
              Delete
            </button>
          </div>
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
