"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

import s from "@/app/styles/dashboard.module.css";
import d from "@/app/styles/detail.module.css";

type UserMeta = {
  username?: string;
  avatar_url?: string;
  [k: string]: any;
};

type HistoryItem = {
  id: string;
  date: string;       
  duration: string;   
  transcript: string;
  summary: string;
};

// Simple formatter to render the structured summary returned by the realtime summarizer.
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

// Sample data - in real app this would come from API/database
const SAMPLE_DATA: { [key: string]: HistoryItem } = {
  "1": {
    id: "1",
    date: "15 Januari 2025, 14:30",
    duration: "2 menit 15 detik",
    transcript: 'Halo, ini adalah contoh transkrip dari sesi voice to text. Sistem ini bekerja dengan baik untuk mengkonversi suara menjadi teks secara real-time. Kemudian AI akan meringkas konten ini menjadi format yang lebih mudah dibaca. Proses ini melibatkan beberapa tahap yaitu capture audio, speech recognition, dan natural language processing untuk menghasilkan ringkasan yang akurat.',
    summary: "Sesi voice to text berhasil mengkonversi suara menjadi teks dengan baik. Sistem bekerja real-time dan AI merangkum konten menjadi format yang mudah dibaca.",
  },
  "2": {
    id: "2", 
    date: "15 Januari 2025, 10:15",
    duration: "1 menit 45 detik",
    transcript: "Testing sistem voice recognition untuk memastikan semua fitur berfungsi dengan baik. Ini adalah uji coba kedua untuk memverifikasi kualitas transkripsi dan ringkasan AI. Hasilnya menunjukkan bahwa sistem dapat menangkap audio dengan jelas dan mengkonversinya menjadi teks yang akurat.",
    summary: "Uji coba sistem voice recognition berhasil. Fitur transkripsi dan ringkasan AI berfungsi dengan baik.",
  },
};

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

  // detail data
  const [detailData, setDetailData] = useState<HistoryItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

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
      router.replace('/history');
      return;
    }

    setFetching(true);
    setErrorText(null);
    setNotFound(false);
    setDetailData(null);

    try {
      const { data, error } = await supabase
        .from('histories')
        .select('id, created_at, original_text, summary_result, metadata')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching summary:', error);
        setErrorText(error.message || JSON.stringify(error));
        setNotFound(true);
        return;
      }

      if (!data) {
        setErrorText('No data returned');
        setNotFound(true);
        return;
      }

      const mapped: HistoryItem = {
        id: data.id,
        date: data.created_at ? new Date(data.created_at).toLocaleString() : '',
        duration: (data.metadata && data.metadata.duration) || '',
        transcript: data.original_text,
        summary: data.summary_result,
      };

      setDetailData(mapped);
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
          .from('histories')
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

        // success -> navigate back to history
        router.push('/history');
      } catch (err) {
        console.error('Unexpected delete error', err);
        alert('Gagal menghapus item.');
      }
    })();
  };

  const handleExport = () => {
    if (detailData) {
      const content = `Transcription Detail\n\nDate: ${detailData.date}\nDuration: ${detailData.duration}\n\nTranscript:\n${detailData.transcript}\n\nSummary:\n${detailData.summary}`;
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
              <h3>Transcription not found</h3>
              <p>The requested transcription could not be found. It may have been deleted or the ID is invalid.</p>
              <p style={{ fontSize: 12, color: '#666' }}>Requested id: <strong>{id}</strong></p>
              {errorText && (
                <div style={{ marginTop: 8, color: '#b00' }}>
                  <strong>Error:</strong> {errorText}
                </div>
              )}
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button className={d.actionButton} onClick={() => router.push('/history')}>Back to History</button>
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
            <div className={s.brandName}>Neurabot</div>
          </div>

          <nav className={s.nav} aria-label="Sidebar">
            <a href="/dashboard" className={s.navItem}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9,22 9,12 15,12 15,22"></polyline>
              </svg>
              <span>Dashboard</span>
            </a>
            <a href="/history" className={s.navItem}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12,6 12,12 16,14"></polyline>
              </svg>
              <span>History</span>
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
                  <button className={s.dropdownItem} onClick={closeProfileDropdown}>
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
          {/* Header */}
          <div className={d.detailHeader}>
            <div className={d.headerInfo}>
              <h1 className={d.detailTitle}>Transcription Details</h1>
              <div className={d.detailMeta}>
                <div className={d.metaItem}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                  {detailData.date}
                </div>
                <div className={d.metaItem}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12,6 12,12 16,14"></polyline>
                  </svg>
                  {detailData.duration}
                </div>
              </div>
            </div>
            
            <div className={d.headerActions}>
              <button className={d.actionButton} onClick={handleExport}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7,10 12,15 17,10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Export
              </button>

            </div>
          </div>

          {/* Content */}
          <div className={d.detailContent}>
            {/* Transcript Section */}
            <section className={d.contentSection}>
              <div className={d.sectionHeader}>
                <h2 className={d.sectionTitle}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                  Full Transcript
                </h2>
                <button className={d.copyButton} onClick={() => handleCopy(detailData.transcript)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                  </svg>
                  Copy
                </button>
              </div>
              <div className={d.transcriptContent}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{detailData.transcript}</div>
              </div>
            </section>

            {/* Summary Section */}
            <section className={d.contentSection}>
              <div className={d.sectionHeader}>
                <h2 className={d.sectionTitle}>
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14,2 14,8 20,8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10,9 9,9 8,9"></polyline>
                  </svg>
                  AI Summary
                </h2>
                <button className={d.copyButton} onClick={() => handleCopy(detailData.summary)}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                  </svg>
                  Copy
                </button>
              </div>
              <div className={d.summaryContent}>
                <div dangerouslySetInnerHTML={{ __html: renderSummaryHtml(detailData.summary) }} />
              </div>
            </section>
          </div>

          {/* Footer Actions */}
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


    </div>
  );
}
