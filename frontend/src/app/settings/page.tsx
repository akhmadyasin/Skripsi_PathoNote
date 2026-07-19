"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/app/lib/supabaseClient";
import s from "@/app/styles/dashboard.module.css"; // layout (sidebar/topbar)
import h from "@/app/styles/settings.module.css";   // style khusus settings

const SIGNATURE_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_SIGNATURE_BUCKET || "signatures";

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

  aiModel: "qwen3.6-27b",
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
  const supabase = supabaseBrowser;

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

  // form state
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [query, setQuery] = useState("");

  // status
  const [aiStatus, setAiStatus] = useState<"active" | "inactive">("active");
  const [storageText, setStorageText] = useState<string>("â€”");

  // toast
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const [signatureStatus, setSignatureStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  
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
  const checkAI = async () => {
    try {
      // Kalau kamu punya API health, ganti ke endpoint kamu:
      // const res = await fetch("/api/health");
      // setAiStatus(res.ok ? "active" : "inactive");
      // Untuk sekarang, kita coba ping root (akan gagal di dev â†’ jadi "inactive")
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
      const userMeta = (session.user.user_metadata as UserMeta) || {};
      setMeta(userMeta);
      // Load signature preview from metadata
      if (userMeta.signature_url) {
        setSignaturePreview(userMeta.signature_url);
      }
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

  const handleSignatureFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setSignatureStatus({ type: "error", message: "File harus berupa gambar (PNG, JPG, dll)." });
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setSignatureStatus({ type: "error", message: "Ukuran file maksimal 5MB." });
      return;
    }

    setSignatureFile(file);
    const reader = new FileReader();
    reader.onload = (event) => {
      setSignaturePreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
    setSignatureStatus(null);
  };

  const uploadSignature = async () => {
    if (!signatureFile) {
      setSignatureStatus({ type: "error", message: "Pilih file signature terlebih dahulu." });
      return;
    }

    setIsUploadingSignature(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setSignatureStatus({ type: "error", message: "User tidak ditemukan." });
        setIsUploadingSignature(false);
        return;
      }

      // Upload file ke Supabase Storage
      const fileName = `signature-${user.id}.${signatureFile.name.split('.').pop()}`;
      const { data, error: uploadError } = await supabase.storage
        .from(SIGNATURE_BUCKET)
        .upload(`${user.id}/${fileName}`, signatureFile, { upsert: true });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        const message = uploadError.message || "Gagal upload signature.";
        setSignatureStatus({
          type: "error",
          message: message.includes("Bucket not found")
            ? `Bucket Supabase Storage "${SIGNATURE_BUCKET}" tidak ditemukan. Buat bucket dengan nama tersebut di dashboard Supabase.`
            : message,
        });
        setIsUploadingSignature(false);
        return;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(SIGNATURE_BUCKET)
        .getPublicUrl(`${user.id}/${fileName}`);

      // Update user metadata dengan signature URL
      const { data: updatedUser, error: updateError } = await supabase.auth.updateUser({
        data: {
          ...meta,
          signature_url: publicUrl,
        },
      });

      if (updateError) {
        setSignatureStatus({ type: "error", message: updateError.message });
        setIsUploadingSignature(false);
        return;
      }

      const userMeta = (updatedUser.user?.user_metadata as UserMeta) || {};
      setMeta(userMeta);
      setSignatureFile(null);
      setSignatureStatus({ type: "success", message: "Signature berhasil disimpan!" });
      showToast("Signature berhasil disimpan!", "success");
    } catch (error: any) {
      console.error("Error uploading signature:", error);
      setSignatureStatus({ type: "error", message: error.message || "Terjadi kesalahan saat upload." });
    } finally {
      setIsUploadingSignature(false);
    }
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
    <>
      {/* CONTENT */}
      <main className={s.content}>
        <div className={h.settingsContainer}>
          <div className={h.settingsHeader} />

          <section className={h.section}>
            <h3 className={h.sectionTitle}>Tanda Tangan</h3>
            <div className={h.item}>
              <div className={h.info}>
                <div className={h.label}>Unggah Tanda Tangan</div>
                <div className={h.desc}>Upload scan atau foto tanda tangan Anda untuk ditampilkan di PDF.</div>
              </div>
              <div className={h.control}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
                  {signaturePreview && (
                    <div
                      style={{
                        border: "1px solid #e0e0e0",
                        borderRadius: "8px",
                        padding: "12px",
                        maxWidth: "200px",
                        backgroundColor: "#f5f5f5",
                      }}
                    >
                      <img
                        src={signaturePreview}
                        alt="Signature preview"
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100px",
                          objectFit: "contain",
                        }}
                      />
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleSignatureFileChange}
                    style={{
                      padding: "8px",
                      borderRadius: "4px",
                      border: "1px solid #ddd",
                    }}
                  />
                  <button
                    onClick={uploadSignature}
                    disabled={!signatureFile || isUploadingSignature}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: signatureFile && !isUploadingSignature ? "#0070f3" : "#ccc",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: signatureFile && !isUploadingSignature ? "pointer" : "not-allowed",
                    }}
                  >
                    {isUploadingSignature ? "Uploading..." : "Simpan Signature"}
                  </button>
                  {signatureStatus && (
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: "4px",
                        color: signatureStatus.type === "error" ? "#c41e3a" : "#0070f3",
                        backgroundColor: signatureStatus.type === "error" ? "#ffe0e6" : "#e3f2fd",
                        fontSize: "14px",
                      }}
                    >
                      {signatureStatus.message}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className={h.section}>
            <h3 className={h.sectionTitle}>Informasi Sistem</h3>

            <div className={h.item}>
              <div className={h.info}>
                <div className={h.label}>Status Koneksi AI</div>
                <div className={h.desc}>Status koneksi ke layanan AI saat ini.</div>
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
                <div className={h.label}>Model AI yang Digunakan</div>
                <div className={h.desc}>Model AI yang saat ini dipakai untuk proses ringkasan.</div>
              </div>
              <div className={h.control}>
                <span className={`${h.status} ${h.statusActive}`}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="12" cy="12" r="10" /></svg>
                  {settings.aiModel || "qwen3.6-27b"}
                </span>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div className={`${h.toast} ${toast.type === "success" ? h.success : h.error}`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
