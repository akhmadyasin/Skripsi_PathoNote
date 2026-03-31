"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import s from "@/app/styles/dashboard.module.css";
import VoicePanel from "@/app/components/VoicePanel";
import { supabaseBrowser } from "@/app/lib/supabaseClient";

type UserMeta = {
  username?: string;
  avatar_url?: string;
  [k: string]: any;
};

type RecentSummary = {
  id: string;
  title: string;
  description: string;
  time: string; // human readable, e.g., "10 minutes ago"
};

export default function Dashboard() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  // auth/session
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [meta, setMeta] = useState<UserMeta>({});

  // ui state
  const [listening, setListening] = useState(false);
  const toggleListening = () => setListening((v) => !v);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  // recent summaries
  const [recentSummaries, setRecentSummaries] = useState<RecentSummary[]>([
    {
      id: "s1",
      title: "Client Brief Summary",
      description: "Latest summarize file opened",
      time: "10 minutes ago",
    },
    {
      id: "s2",
      title: "Standup Notes Summary",
      description: "Yesterday's highlights",
      time: "25 minutes ago",
    },
    {
      id: "s3",
      title: "Interview Summary",
      description: "Key talking points captured",
      time: "1 hour ago",
    },
  ]);

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

    // load recent summaries from localStorage if available
    try {
      const raw = localStorage.getItem("recentSummaries");
      if (raw) {
        const parsed = JSON.parse(raw) as RecentSummary[];
        if (Array.isArray(parsed) && parsed.length) {
          setRecentSummaries(parsed.slice(0, 4));
        }
      }
    } catch {
      // ignore parse errors and keep fallback
    }

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

  const username = meta.username || "Faisal";
  const avatar   = meta.avatar_url || "https://i.pravatar.cc/64?img=12";

  if (loading) {
    return (
      <div className={s.app}>
        <main className={s.content}>
          <div className={s.card}>Memuat dashboard…</div>
        </main>
      </div>
    );
  }

  return (
    <div className={s.app}>
      {/* SIDEBAR */}
      <aside className={s.sidebar} id="sidebar">
        {/* ... (isi sidebar Anda tetap sama, tidak perlu diubah) ... */}
        <div className={s.sbInner}>
          <div className={s.brand}>
            <Image
              src="/logo_neurabot.jpg" alt="Logo Neurabot" width={40} height={40} className={s.brandImg}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = "none";
                const next = target.nextElementSibling as HTMLElement | null;
                if (next) next.style.display = "grid";
              }}
            />
            <div className={s.brandLogo} style={{ display: "none" }}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#07131f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.5 6H8.5L12 2Z"></path><path d="M12 22l-3.5-6h7L12 22Z"></path><path d="M2 12l6-3.5v7L2 12Z"></path><path d="M22 12l-6 3.5v-7L22 12Z"></path></svg>
            </div>
            <div className={s.brandName}>Neurabot</div>
          </div>
          <nav className={s.nav} aria-label="Sidebar">
            <a className={`${s.navItem} ${s.active}`} href="/dashboard"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9,22 9,12 15,12 15,22"></polyline></svg><span>Dashboard</span></a>
            <a className={s.navItem} href="/history"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12,6 12,12 16,14"></polyline></svg><span>History</span></a>
            <a className={s.navItem} href="/settings"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg><span>Settings</span></a>
          </nav>
          <div className={s.sbFooter}>
            <div style={{ opacity: 0.6 }}>© 2025 Neurabot</div>
          </div>
        </div>
      </aside>

      {/* TOPBAR */}
      <header className={s.topbar}>
        {/* ... (isi topbar Anda tetap sama, tidak perlu diubah) ... */}
        <div className={s.tbWrap}>
          <div className={s.leftGroup}>
            <div className={s.search} role="search">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
              <input type="search" placeholder="Search something..." />
            </div>
          </div>
          <div className={s.rightGroup}>
            <button className={s.listenBtn} aria-pressed={listening} onClick={toggleListening}>
              <span className={s.dot} aria-hidden />
              <span className={s.btnLabel}>{listening ? "Close Panel" : "Start Listening"}</span>
            </button>
            <div className={s.avatar} onClick={toggleProfileDropdown}>
              <Image src={avatar} alt="Foto profil" width={40} height={40} unoptimized />
              <div className={s.meta}>
                <div className={s.name}>{username}</div>
              </div>
              {showProfileDropdown && (
                <div className={s.profileDropdown}>
                  <button className={s.dropdownItem} onClick={closeProfileDropdown}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> Profile</button>
                  <button className={s.dropdownItem} onClick={onLogout}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16,17 21,12 16,7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> Logout</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* KONTEN UTAMA */}
      <main className={s.content}>
        {/* Tampilan Dashboard Utama */}
        <div className={s.dashboardContainer} style={{ display: listening ? 'none' : 'block' }}>
          {/* ... (seluruh isi dashboard Anda yang sebelumnya ada di dalam {!listening ? (...)}) ... */}
          <div className={s.topCards}>
            <div className={s.statsCard}><div className={s.cardIcon}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg></div><div className={s.cardContent}><h3>Total Sessions</h3><div className={s.cardValue}>24</div><div className={s.cardSubtext}>+3 this week</div></div></div>
            <div className={s.statsCard}><div className={s.cardIcon}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14,2 14,8 20,8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10,9 9,9 8,9"></polyline></svg></div><div className={s.cardContent}><h3>Words Transcribed</h3><div className={s.cardValue}>12,847</div><div className={s.cardSubtext}>+1,234 today</div></div></div>
            <div className={s.statsCard}><div className={s.cardIcon}><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7z"></path></svg></div><div className={s.cardContent}><h3>Summaries Created</h3><div className={s.cardValue}>18</div><div className={s.cardSubtext}>+2 this week</div></div></div>
          </div>
          <div className={s.activitySection}>
            <h2><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px', display: 'inline-block', verticalAlign: 'middle'}}><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg> Summarize Activity</h2>
            <div className={s.activityCard}><div className={s.activityHeader}><div className={s.activityTitle}>Recent Summarization</div><div className={s.activityStatus}>Active</div></div><div className={s.activityContent}><div className={s.activityItem}><div className={s.activityIcon}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div><div className={s.activityInfo}><div className={s.activityName}>Meeting Notes Summary</div><div className={s.activityTime}>2 minutes ago</div></div><div className={s.activityResult}>Success</div></div><div className={s.activityItem}><div className={s.activityIcon}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path></svg></div><div className={s.activityInfo}><div className={s.activityName}>Voice Recording Processing</div><div className={s.activityTime}>5 minutes ago</div></div><div className={s.activityResult}>Processing</div></div><div className={s.activityItem}><div className={s.activityIcon}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div><div className={s.activityInfo}><div className={s.activityName}>Interview Transcription</div><div className={s.activityTime}>1 hour ago</div></div><div className={s.activityResult}>Success</div></div></div></div>
          </div>
          <div className={s.recentSection}>
            <h2><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '8px', display: 'inline-block', verticalAlign: 'middle'}}><circle cx="12" cy="12" r="10"></circle><polyline points="12,6 12,12 16,14"></polyline></svg> Recent Summaries</h2>
            <div className={s.recentList}>{recentSummaries.map((item) => (<div key={item.id} className={s.recentItem}><div className={s.recentIcon}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14,2 14,8 20,8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10,9 9,9 8,9"></polyline></svg></div><div className={s.recentContent}><div className={s.recentTitle}>{item.title}</div><div className={s.recentDesc}>{item.description}</div><div className={s.recentTime}>{item.time}</div></div></div>))}</div>
          </div>
        </div>

        {/* Tampilan Voice Panel */}
        <div className={s.voiceWrap} style={{ display: listening ? 'block' : 'none' }}>
          <div className={s.voiceFrame}>
            <VoicePanel />
          </div>
        </div>
      </main>
    </div>
  );
}