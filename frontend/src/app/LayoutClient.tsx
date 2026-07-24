"use client";

import { useEffect, useState, ReactNode } from "react";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import s from "@/app/styles/dashboard.module.css";
import MobileSidebar from "@/app/components/MobileSidebar";
import ProfileModal from "@/app/components/ProfileModal";
import { supabaseBrowser } from "@/app/lib/supabaseClient";
import { getSessionUserProfile } from "@/app/lib/userProfile";

type UserMeta = {
  username?: string;
  display_name?: string;
  role?: string;
  avatar_url?: string;
  [k: string]: unknown;
};

export default function LayoutClient({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = supabaseBrowser;

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [meta, setMeta] = useState<UserMeta>({});
  const [role, setRole] = useState("dokter");
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileStatus, setProfileStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check if current page is auth page
  const isAuthPage = pathname?.startsWith("/login") || pathname?.startsWith("/register") || pathname?.startsWith("/auth");
  
  // Show layout only on authenticated pages (not on auth pages)
  const showLayout = isAuthenticated && !isAuthPage;

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!session) {
        setLoading(false);
        setIsAuthenticated(false);
        if (!isAuthPage) {
          router.replace("/login");
        }
        return;
      }

      const profile = getSessionUserProfile(session as any);
      setEmail(profile.email);
      setMeta(profile.meta as UserMeta);
      setRole(profile.role);
      setProfileName(profile?.username || "");
      setProfileEmail(profile.email);
      setIsAuthenticated(true);
      setLoading(false);
    })();

    // initialize searchQuery from URL if present
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('search') || '';
      setSearchQuery(q);
    } catch {}

    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => {
      if (!sess && !isAuthPage) {
        setIsAuthenticated(false);
        router.replace("/login");
      } else if (sess) {
        setIsAuthenticated(true);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [router, supabase, isAuthPage]);

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

  const toggleProfileDropdown = () => {
    setShowProfileDropdown(!showProfileDropdown);
  };

  const saveProfile = async () => {
    setProfileStatus(null);
    if (!profileName.trim()) {
      setProfileStatus({ type: "error", message: "Nama tidak boleh kosong." });
      return;
    }

    setIsSavingProfile(true);
    const { data: { user }, error } = await supabase.auth.updateUser({
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

  const username = meta.username || email.split("@")[0] || "User";
  const roleLabel = role === "petugas" ? "Petugas" : role === "superadmin" ? "Superadmin" : "Dokter";

  if (loading && !isAuthPage) {
    return (
      <div className={s.app}>
        <main className={s.content}>
          <div className={s.card}>Memuat...</div>
        </main>
      </div>
    );
  }

  // If not authenticated and not on auth page, show children (will redirect in useEffect)
  if (!isAuthenticated && !isAuthPage) {
    return <>{children}</>;
  }

  // If on auth page, show children without layout
  if (isAuthPage) {
    return <>{children}</>;
  }

  // Helper function to check if path is active
  const isPathActive = (targetPath: string) => {
    if (targetPath === '/dashboard') {
      return pathname === '/dashboard';
    }
    // Check if pathname starts with targetPath (for /collections, /history, /settings)
    return pathname?.startsWith(targetPath);
  };

  // If authenticated and not on auth page, show layout with sidebar and topbar
  return (
    <div className={s.app}>
      {/* SIDEBAR */}
      <aside className={s.sidebar} id="sidebar">
        <div className={s.sbInner}>
          <div className={s.brand}>
            <Image
              src="/logo.png" alt="Logo PathoNote" width={40} height={40} className={s.brandImg}
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
            <div className={s.brandName}>PathoNote</div>
          </div>
          <nav className={s.nav} aria-label="Sidebar">
            <a className={`${s.navItem} ${isPathActive('/dashboard') ? s.active : ''}`} href="/dashboard"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9,22 9,12 15,12 15,22"></polyline></svg><span>Dashboard</span></a>
            <a className={`${s.navItem} ${isPathActive('/collections') ? s.active : ''}`} href="/collections"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><path d="M3 10h18"></path></svg><span>Collections</span></a>
            <a className={`${s.navItem} ${isPathActive('/history') ? s.active : ''}`} href="/history"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 16"></polyline></svg><span>History</span></a>
            <a className={`${s.navItem} ${isPathActive('/settings') ? s.active : ''}`} href="/settings"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg><span>Settings</span></a>
          </nav>
          <div className={s.sbFooter}>
            <div style={{ opacity: 0.6 }}>© Universitas Harkat Negeri | Developed by Akhmad Yasin</div>
            <div style={{ opacity: 0.6 }}>@ 2025 Neurabot | Base on initial development</div>
          </div>
        </div>
      </aside>

      {/* TOPBAR */}
      <header className={s.topbar}>
        <div className={s.tbWrap}>
          <div className={s.leftGroup}>
            <MobileSidebar currentPath={pathname || ""} />
            <div className={s.search} role="search">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
              <input
                type="search"
                placeholder="Search something..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const q = (e.target as HTMLInputElement).value.trim();
                    if (q) {
                      // Determine search destination based on current page
                      let searchPath = '/collections'; // default
                      if (pathname?.startsWith('/history')) {
                        searchPath = '/history';
                      } else if (pathname?.startsWith('/users')) {
                        searchPath = '/users';
                      } else if (pathname?.startsWith('/dashboard') || pathname?.startsWith('/detail')) {
                        searchPath = '/collections';
                      }
                      router.push(`${searchPath}?search=${encodeURIComponent(q)}`);
                    }
                  }
                }}
              />
            </div>
          </div>
          <div className={s.rightGroup}>
            {role === 'dokter' && (
              pathname === '/voice' ? (
                <button
                  className={s.listenBtn}
                  onClick={() => router.push('/dashboard')}
                  aria-pressed={true}
                  title="Close Panel"
                  style={{ marginRight: 6 }}
                >
                  <span style={{ fontWeight: 700 }}>Close Panel</span>
                </button>
              ) : (
                <button
                  className={s.listenBtn}
                  onClick={() => router.push('/voice')}
                  aria-pressed={false}
                  title="Start Listening"
                  style={{ marginRight: 6 }}
                >
                  <span className="dot" aria-hidden></span>
                  <span style={{ fontWeight: 700 }}>Start Listening</span>
                </button>
              )
            )}
            <div className={s.avatar} onClick={toggleProfileDropdown}>
              <div className={s.avatarIcon} aria-label="Profil pengguna">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"></circle>
                  <path d="M4 20c1.3-3.3 4.1-5 8-5s6.7 1.7 8 5"></path>
                </svg>
              </div>
              <div className={s.meta}>
                <div className={s.name}>{username}</div>
                <div className={s.role}>{roleLabel}</div>
              </div>
              {showProfileDropdown && (
                <div className={s.profileDropdown}>
                  <button className={s.dropdownItem} onClick={(event) => { event.stopPropagation(); openProfileModal(); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> Profile</button>
                  <button className={s.dropdownItem} onClick={(event) => { event.stopPropagation(); onLogout(); }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16,17 21,12 16,7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> Logout</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <ProfileModal
        open={showProfileModal}
        profileName={profileName}
        profileEmail={profileEmail}
        roleLabel={roleLabel}
        profileStatus={profileStatus}
        isSaving={isSavingProfile}
        onClose={closeProfileModal}
        onNameChange={setProfileName}
        onSave={saveProfile}
      />

      {/* KONTEN */}
      <main className={s.content}>
        {children}
      </main>
    </div>
  );
}
