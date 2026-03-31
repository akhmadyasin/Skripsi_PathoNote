"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";
import s from "@/app/styles/dashboard.module.css"; // layout (sidebar/topbar)
import h from "@/app/styles/settings.module.css";   // style khusus settings

type UserMeta = {
  username?: string;
  avatar_url?: string;
  [k: string]: any;
};

type Settings = {
  voiceLanguage: string;
  microphoneSensitivity: number;
  autoVoiceDetection: boolean;
  noiseFilter: boolean;

  aiModel: string;
  aiCreativity: number;
  autoSummarize: boolean;
  summarizeDelay: number;

  appTheme: "dark" | "light" | "auto";
  soundNotifications: boolean;
  saveHistory: boolean;
  historyRetention: number;

  groqApiKey: string;
};

const DEFAULTS: Settings = {
  voiceLanguage: "id-ID",
  microphoneSensitivity: 50,
  autoVoiceDetection: true,
  noiseFilter: true,

  aiModel: "llama-3.3-70b-versatile",
  aiCreativity: 30,
  autoSummarize: true,
  summarizeDelay: 2,

  appTheme: "dark",
  soundNotifications: true,
  saveHistory: true,
  historyRetention: 30,

  groqApiKey: "",
};

// Base URL for the Flask backend API
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:5001";

export default function SettingsPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  // auth/session
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>("");
  const [meta, setMeta] = useState<UserMeta>({});
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  // form state
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [query, setQuery] = useState("");

  // status
  const [aiStatus, setAiStatus] = useState<"active" | "inactive">("active");
  const [micStatus, setMicStatus] = useState<"active" | "inactive">("inactive");
  const [storageText, setStorageText] = useState<string>("—");

  // toast
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };



  // load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("voiceToTextSettings");
      if (raw) {
        const merged = { ...DEFAULTS, ...JSON.parse(raw) };
        setSettings(merged);
      }
    } catch {
      // ignore
    }
  }, []);

  // system checks
  const checkMic = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicStatus("active");
    } catch {
      setMicStatus("inactive");
    }
  };
  const checkAI = async () => {
    try {
      // Kalau kamu punya API health, ganti ke endpoint kamu:
      // const res = await fetch("/api/health");
      // setAiStatus(res.ok ? "active" : "inactive");
      // Untuk sekarang, kita coba ping root (akan gagal di dev → jadi "inactive")
      const res = await fetch("/", { method: "HEAD" });
      setAiStatus(res.ok ? "active" : "inactive");
    } catch {
      setAiStatus("inactive");
    }
  };
  const checkStorage = async () => {
    // Estimasi storage (tidak semua browser support)
    const anyNav = navigator as any;
    if (anyNav?.storage?.estimate) {
      const est = await anyNav.storage.estimate();
      const used = ((est.usage || 0) / 1024 / 1024).toFixed(1);
      const quota = ((est.quota || 0) / 1024 / 1024).toFixed(1);
      setStorageText(`${used}MB / ${quota}MB`);
    } else {
      setStorageText("Tidak tersedia");
    }
  };

  useEffect(() => {
    checkMic();
    checkAI();
    checkStorage();
    const id = setInterval(() => {
      checkAI();
      checkStorage();
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // auth session management
  useEffect(() => {
    let mounted = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
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

  // handlers
  const save = () => {
    localStorage.setItem("voiceToTextSettings", JSON.stringify(settings));
    showToast("Pengaturan berhasil disimpan!", "success");
  };
  const reset = () => {
    if (confirm("Reset semua pengaturan ke default?")) {
      localStorage.removeItem("voiceToTextSettings");
      setSettings(DEFAULTS);
      showToast("Pengaturan telah direset ke default.", "success");
    }
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

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showProfileDropdown]);




  // derived values
  const username = meta.username || email.split("@")[0] || "User";
  const avatar = meta.avatar_url || "https://i.pravatar.cc/64?img=12";

  const onRange = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((prev) => ({ ...prev, [k]: Number(e.target.value) }));

  const onCheck = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings((prev) => ({ ...prev, [k]: e.target.checked }));

  const onText = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setSettings((prev) => ({ ...prev, [k]: e.target.value }));

  // search filter sections
  const matchesQuery = (text: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return text.toLowerCase().includes(q);
  };

  if (loading) {
    return (
      <div className={s.app}>
        <main className={s.content}>
          <div className={s.card}>Loading settings...</div>
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
            <Image src="/logo_neurabot.jpg" alt="Logo Neurabot" width={36} height={36} className={s.brandImg} />
            <div className={s.brandName}>Neurabot</div>
          </div>

          <nav className={s.nav} aria-label="Sidebar">
            <a className={s.navItem} href="/dashboard">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9,22 9,12 15,12 15,22"></polyline>
              </svg>
              <span>Dashboard</span>
            </a>
            <a className={s.navItem} href="/history">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12,6 12,12 16,14"></polyline>
              </svg>
              <span>History</span>
            </a>
            <a className={`${s.navItem} ${s.active}`} href="/settings">
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
                placeholder="Search settings..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search settings"
              />
            </div>
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
        <div className={h.settingsContainer}>
          <h2>Settings</h2>

          {/* Voice Settings */}
          {matchesQuery("pengaturan suara bahasa sensitivitas otomatis noise") && (
            <section className={h.section}>
              <h3>Voice Settings</h3>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Recognition Language</div>
                  <div className={h.desc}>Choose the language for voice recognition</div>
                </div>
                <div className={h.control}>
                  <div className={h.selectWrap}>
                    <select id="voiceLanguage" value={settings.voiceLanguage} onChange={onText("voiceLanguage")}>
                      <option value="id-ID">Bahasa Indonesia</option>
                      <option value="en-US">English (US)</option>
                      <option value="en-GB">English (UK)</option>
                      <option value="ms-MY">Bahasa Malaysia</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Microphone Sensitivity</div>
                  <div className={h.desc}>Adjust how sensitive the system detects voice</div>
                </div>
                <div className={h.control}>
                  <div className={h.rangeWrap}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={settings.microphoneSensitivity}
                      onChange={onRange("microphoneSensitivity")}
                      className={h.range}
                    />
                    <span className={h.rangeValue}>{settings.microphoneSensitivity}%</span>
                  </div>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Auto Voice Detection</div>
                  <div className={h.desc}>Start recording automatically when voice is detected</div>
                </div>
                <div className={h.control}>
                  <label className={h.toggle}>
                    <input
                      type="checkbox"
                      checked={settings.autoVoiceDetection}
                      onChange={onCheck("autoVoiceDetection")}
                    />
                    <span className={h.slider} />
                  </label>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Noise Filter</div>
                  <div className={h.desc}>Enable filter to reduce background noise</div>
                </div>
                <div className={h.control}>
                  <label className={h.toggle}>
                    <input type="checkbox" checked={settings.noiseFilter} onChange={onCheck("noiseFilter")} />
                    <span className={h.slider} />
                  </label>
                </div>
              </div>
            </section>
          )}

          {/* AI Settings */}
          {matchesQuery("ai model kreativitas ringkasan delay") && (
            <section className={h.section}>
              <h3>AI Settings</h3>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>AI Model</div>
                  <div className={h.desc}>Choose the AI model for text summarization</div>
                </div>
                <div className={h.control}>
                  <div className={h.selectWrap}>
                    <select id="aiModel" value={settings.aiModel} onChange={onText("aiModel")}>
                      <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Default)</option>
                      <option value="llama-3.1-70b-versatile">Llama 3.1 70B</option>
                      <option value="llama-3.1-8b-instant">Llama 3.1 8B (Fast)</option>
                      <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>AI Creativity</div>
                  <div className={h.desc}>Adjust how creative the AI is in summarization</div>
                </div>
                <div className={h.control}>
                  <div className={h.rangeWrap}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={settings.aiCreativity}
                      onChange={onRange("aiCreativity")}
                      className={h.range}
                    />
                    <span className={h.rangeValue}>{settings.aiCreativity}%</span>
                  </div>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Auto Summarize</div>
                  <div className={h.desc}>Automatically summarize text when finished speaking</div>
                </div>
                <div className={h.control}>
                  <label className={h.toggle}>
                    <input type="checkbox" checked={settings.autoSummarize} onChange={onCheck("autoSummarize")} />
                    <span className={h.slider} />
                  </label>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Summarize Delay</div>
                  <div className={h.desc}>Wait seconds before starting to summarize</div>
                </div>
                <div className={h.control}>
                  <div className={h.rangeWrap}>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={settings.summarizeDelay}
                      onChange={onRange("summarizeDelay")}
                      className={h.range}
                    />
                    <span className={h.rangeValue}>{settings.summarizeDelay}s</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Summary mode moved to registration flow. */}

          {/* General Settings */}
          {matchesQuery("umum tema notifikasi simpan riwayat penyimpanan api key") && (
            <section className={h.section}>
              <h3>General Settings</h3>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Tema Aplikasi</div>
                  <div className={h.desc}>Pilih tema tampilan aplikasi</div>
                </div>
                <div className={h.control}>
                  <div className={h.selectWrap}>
                    <select id="appTheme" value={settings.appTheme} onChange={onText("appTheme")}>
                      <option value="dark">Dark (Default)</option>
                      <option value="light">Light</option>
                      <option value="auto">Auto (Sesuai Sistem)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Notifikasi Suara</div>
                  <div className={h.desc}>Putar suara notifikasi saat selesai meringkas</div>
                </div>
                <div className={h.control}>
                  <label className={h.toggle}>
                    <input type="checkbox" checked={settings.soundNotifications} onChange={onCheck("soundNotifications")} />
                    <span className={h.slider} />
                  </label>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Simpan Riwayat</div>
                  <div className={h.desc}>Otomatis menyimpan riwayat transkrip dan ringkasan</div>
                </div>
                <div className={h.control}>
                  <label className={h.toggle}>
                    <input type="checkbox" checked={settings.saveHistory} onChange={onCheck("saveHistory")} />
                    <span className={h.slider} />
                  </label>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>Durasi Penyimpanan</div>
                  <div className={h.desc}>Berapa lama riwayat disimpan (hari)</div>
                </div>
                <div className={h.control}>
                  <div className={h.rangeWrap}>
                    <input
                      type="range"
                      min={1}
                      max={365}
                      value={settings.historyRetention}
                      onChange={onRange("historyRetention")}
                      className={h.range}
                    />
                    <span className={h.rangeValue}>{settings.historyRetention} hari</span>
                  </div>
                </div>
              </div>

              <div className={h.item}>
                <div className={h.info}>
                  <div className={h.label}>API Key Groq</div>
                  <div className={h.desc}>Masukkan API key untuk mengakses layanan AI</div>
                </div>
                <div className={h.control}>
                  <input
                    type="password"
                    id="groqApiKey"
                    className={h.input}
                    placeholder="Masukkan API key..."
                    value={settings.groqApiKey}
                    onChange={onText("groqApiKey")}
                  />
                </div>
              </div>
            </section>
          )}

          {/* Status */}
          <section className={h.section}>
            <h3>System Status</h3>

            <div className={h.item}>
              <div className={h.info}>
                <div className={h.label}>Koneksi AI</div>
                <div className={h.desc}>Status koneksi ke layanan AI</div>
              </div>
              <div className={h.control}>
                <span className={`${h.status} ${aiStatus === "active" ? h.statusActive : h.statusInactive}`}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                  {aiStatus === "active" ? "Terhubung" : "Terputus"}
                </span>
              </div>
            </div>

            <div className={h.item}>
              <div className={h.info}>
                <div className={h.label}>Mikrofon</div>
                <div className={h.desc}>Status akses mikrofon</div>
              </div>
              <div className={h.control}>
                <span className={`${h.status} ${micStatus === "active" ? h.statusActive : h.statusInactive}`}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                  {micStatus === "active" ? "Tersedia" : "Tidak Tersedia"}
                </span>
              </div>
            </div>

            <div className={h.item}>
              <div className={h.info}>
                <div className={h.label}>Penyimpanan Lokal</div>
                <div className={h.desc}>Ruang penyimpanan yang tersedia</div>
              </div>
              <div className={h.control}>
                <span className={`${h.status} ${h.statusActive}`}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                  {storageText}
                </span>
              </div>
            </div>
          </section>

          {/* Actions */}
          <div className={h.actionsBar}>
            <button className={h.btnReset} onClick={reset}>Reset ke Default</button>
            <button className={h.btnSave} onClick={save}>Simpan Pengaturan</button>
          </div>
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className={`${h.toast} ${toast.type === "success" ? h.success : h.error}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}