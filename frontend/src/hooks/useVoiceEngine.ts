"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../app/lib/supabaseClient";
import { io, Socket } from "socket.io-client";

type ToastType = "success" | "error" | "info";
type Maybe<T> = T | null;

const BACKEND_ORIGIN =
  process.env.NEXT_PUBLIC_BACKEND_ORIGIN || "http://127.0.0.1:5001";
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || BACKEND_ORIGIN;

const LS_TRANSCRIPT_KEY = "vt2_transcript";
const LS_LAST_SUMMARY_KEY = "vt2_last_summary";
const AUTO_CLEAR_HL_MS = 2500;

/** Escape minimal untuk HTML */
function escapeHtml(s: string) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bold/italic + newline ke HTML sederhana */
function mdToHtml(text: string) {
  let s = escapeHtml(text || "");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/\n/g, "<br>");
  return s;
}

/** Diff highlight sederhana */
function renderDiff(
  prev: string,
  next: string,
  el: HTMLElement,
  clearTimerRef: React.MutableRefObject<any>
) {
  if (!el) return;
  if ((prev || "") === (next || "")) {
    el.innerHTML = mdToHtml(next || "");
    return;
  }
  const minLen = Math.min(prev.length, next.length);
  let start = 0;
  while (start < minLen && prev[start] === next[start]) start++;
  let endPrev = prev.length - 1;
  let endNext = next.length - 1;
  while (endPrev >= start && endNext >= start && prev[endPrev] === next[endNext]) {
    endPrev--;
    endNext--;
  }
  const prefix = next.slice(0, start);
  const mid = next.slice(start, endNext + 1);
  const suffix = next.slice(endNext + 1);

  el.innerHTML =
    mdToHtml(prefix) + `<span class="hl-add">${mdToHtml(mid)}</span>` + mdToHtml(suffix);

  if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
  clearTimerRef.current = setTimeout(() => {
    el.innerHTML = mdToHtml(next || "");
    clearTimerRef.current = null;
  }, AUTO_CLEAR_HL_MS);
}

function calculateReadingTime(text: string) {
  const wordCount = (text || "").split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount / 200);
}

export function useVoiceEngine() {
  // ====== Refs & State ======
  const socketRef = useRef<Maybe<Socket>>(null);
  const recognitionRef = useRef<any>(null);

  // UI elements yang akan kamu pasang dari VoicePanel
  const summaryEditorRef = useRef<HTMLDivElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  const lastFinalSummaryRef = useRef<string>("");
  const clearHlTimerRef = useRef<any>(null);

  const manualStopRef = useRef<boolean>(false);
  const fullTranscriptRef = useRef<string>("");

  const autoSummarizeEnabledRef = useRef<boolean>(true);
  const autoSummarizeTimerRef = useRef<any>(null);

  const firstTokenTimerRef = useRef<any>(null);
  const gotFirstTokenRef = useRef<boolean>(false);

  const progressIntervalRef = useRef<any>(null);

  const summarizeInFlightRef = useRef<boolean>(false);

  const lastEmitRef = useRef<number>(0);
  const MIN_SUMMARY_INTERVAL = 700; // ms

  // Public states
  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);

  const [timestamp, setTimestamp] = useState("");
  const [charCount, setCharCount] = useState("");

  const [connLabel, setConnLabel] = useState("🔴 Terputus");
  const [connColor, setConnColor] = useState("#dc3545");

  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<ToastType>("success");
  const [toastVisible, setToastVisible] = useState(false);

  const [progressVisible, setProgressVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  const [saving, setSaving] = useState(false);

  // ====== Toast helpers ======
  function showToast(message: string, type: ToastType = "success") {
    setToastMessage(message);
    setToastType(type);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 3000);
  }

  // ====== Progress helpers ======
  function showProgress() {
    setProgressVisible(true);
    setProgress(0);
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }
    progressIntervalRef.current = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 15;
        return next > 90 ? 90 : next;
      });
    }, 200);
  }
  function hideProgress() {
    setProgressVisible(false);
    setProgress(0);
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }
  function completeProgress() {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setProgress(100);
    setTimeout(() => hideProgress(), 500);
  }

  // ====== Count helpers ======
  function updateCountDisplay(text: string) {
    if (!text) {
      setCharCount("");
      return;
    }
    const wordCount = (text || "").split(/\s+/).filter(Boolean).length;
    const readingTime = calculateReadingTime(text);
    setCharCount(`${text.length} karakter, ${wordCount} kata, ~${readingTime} menit baca`);
  }

  // ====== Punctuation replacement ======
  function replaceSpokenPunctuation(text: string) {
    return (text || "")
      .replace(/\btitik\b/gi, ".")
      .replace(/\bkoma\b/gi, ",")
      .replace(/\btanda tanya\b/gi, "?")
      .replace(/\btanda seru\b/gi, "!")
      .replace(/\btitik dua\b/gi, ":")
      .replace(/\btitik koma\b/gi, ";")
      .replace(/\btanda petik\b/gi, '"')
      .replace(/\btanda kurung\b/gi, "(");
  }

  // ====== Socket.IO setup ======
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      timeout: 8000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnLabel("🟢 Terhubung");
      setConnColor("#28a745");
      summarizeInFlightRef.current = false;
    });
    socket.on("disconnect", () => {
      setConnLabel("🔴 Terputus");
      setConnColor("#dc3545");
      summarizeInFlightRef.current = false;
    });
    socket.on("connect_error", (err) => {
      console.error("socket connect_error:", err);
      setConnLabel("🟡 Error");
      setConnColor("#ffc107");
      summarizeInFlightRef.current = false;
    });

    socket.on("summary_stream", (data: any) => {
      if (data && data.error) {
        summarizeInFlightRef.current = false;
        showToast(data.message || data.error, "error");
        hideProgress();
        return;
      }

      // token stream
      if (data && data.token) {
        const prev = lastFinalSummaryRef.current || "";
        const next = (prev + data.token).trim();
        const el = summaryEditorRef.current!;
        try {
          renderDiff(prev, next, el, clearHlTimerRef);
          void el.offsetWidth;
          el.classList.add("hl-anim");
        } catch (e) {
          console.error("renderDiff error (token) → fallback:", e);
          el.innerHTML = mdToHtml(next);
        }
        lastFinalSummaryRef.current = next;
        updateCountDisplay(next);
        if (!gotFirstTokenRef.current) {
          gotFirstTokenRef.current = true;
          if (firstTokenTimerRef.current) {
            clearTimeout(firstTokenTimerRef.current);
            firstTokenTimerRef.current = null;
          }
        }
        setTimeout(() => {
          el.classList.remove("hl-anim");
        }, 1200);
      }

      // final
      if (data && data.final) {
        const prev = lastFinalSummaryRef.current || "";
        const next = (data.final || "").trim();
        const el = summaryEditorRef.current!;
        try {
          renderDiff(prev, next, el, clearHlTimerRef);
          void el.offsetWidth;
          el.classList.add("hl-anim");
        } catch (e) {
          console.error("renderDiff error → fallback:", e);
          el.innerHTML = mdToHtml(next);
        }
        lastFinalSummaryRef.current = next;
        updateCountDisplay(next);
        setTimeout(() => {
          el.classList.remove("hl-anim");
        }, 1200);
      }

      if (data && data.end) {
        setTimestamp(new Date().toLocaleString());
        summarizeInFlightRef.current = false;
        completeProgress();
        showToast("Ringkasan final diperbarui", "success");
        try {
          localStorage.setItem(LS_LAST_SUMMARY_KEY, lastFinalSummaryRef.current);
        } catch {}
      }
    });

    return () => {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {}
    };
  }, []);

  // ====== SpeechRecognition setup ======
  useEffect(() => {
    if (typeof window === "undefined") return;

    const SR: any =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Browser Anda tidak mendukung Web Speech API. Silakan gunakan Google Chrome.");
      return;
    }

    const recognition = new SR();
    recognition.lang = "id-ID";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        let chunk = event.results[i][0].transcript || "";
        chunk = replaceSpokenPunctuation(chunk);
        if (event.results[i].isFinal) {
          fullTranscriptRef.current += chunk + " ";
        } else {
          interim += chunk;
        }
      }
      const merged = fullTranscriptRef.current + interim;
      setTranscript(merged);
      try {
        localStorage.setItem(LS_TRANSCRIPT_KEY, merged);
      } catch {}
      scheduleAutoSummarize(merged);
    };

    recognition.onstart = () => {
      setIsListening(true);
      // JANGAN reset editor/timestamp/charCount (agar ringkasan tak hilang saat auto-restart)
      try {
        const cached = localStorage.getItem(LS_TRANSCRIPT_KEY);
        if (cached) {
          fullTranscriptRef.current = cached;
          setTranscript(cached);
        }
      } catch {}
    };

    recognition.onend = () => {
      setIsListening(false);
      if (!manualStopRef.current) {
        try {
          recognition.start();
        } catch {}
      }
    };

    recognition.onerror = (event: any) => {
      console.error("SpeechRecognition error:", event);
      showToast(`Gagal memulai/berjalan: ${event.error}`, "error");
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {}
    };
  }, []);

  // ====== Restore transcript & last summary di awal ======
  useEffect(() => {
    try {
      const cached = localStorage.getItem(LS_TRANSCRIPT_KEY);
      if (cached) {
        fullTranscriptRef.current = cached;
        setTranscript(cached);
      }
    } catch {}

    try {
      const last = localStorage.getItem(LS_LAST_SUMMARY_KEY);
      if (last && summaryEditorRef.current) {
        summaryEditorRef.current.innerHTML = mdToHtml(last);
        lastFinalSummaryRef.current = last;
        updateCountDisplay(last);
      }
    } catch {}
  }, []);

  // ====== Backend health (opsional) ======
  useEffect(() => {
    fetch(`${BACKEND_ORIGIN}/test`)
      .then((r) => r.json())
      .then(() => {
        setConnLabel("🟢 Terhubung");
        setConnColor("#28a745");
      })
      .catch(() => {
        setConnLabel("🔴 Terputus");
        setConnColor("#dc3545");
      });
  }, []);

  // ====== Summarize request & scheduling ======
  function requestSummarize(text: string, opts: { showUI?: boolean } = {}) {
    const { showUI = true } = opts;
    if (!text || text.trim() === "") return;

    // Throttle rapid requests
    const now = Date.now();
    if (now - (lastEmitRef.current || 0) < MIN_SUMMARY_INTERVAL) return;
    lastEmitRef.current = now;

    // If a previous stream is running, stop it before starting a new one
    if (summarizeInFlightRef.current) {
      try {
        socketRef.current?.emit("stop_stream");
      } catch {}
      summarizeInFlightRef.current = false;
    }

    summarizeInFlightRef.current = true;

    if (showUI) {
      const el = summaryEditorRef.current;
      if (el) el.innerText = "Memproses ringkasan...";
      setCharCount("Memproses...");
      showProgress();
      if (el) el.classList.add("loading");
    }

    gotFirstTokenRef.current = false;
    if (firstTokenTimerRef.current) {
      clearTimeout(firstTokenTimerRef.current);
      firstTokenTimerRef.current = null;
    }

    try {
      socketRef.current?.emit("summarize_stream", {
        text,

      });
    } catch (e) {
      console.error("socket emit error:", e);
    }

    // watchdog: 3 detik tanpa token → fallback HTTP
    firstTokenTimerRef.current = setTimeout(() => {
      if (!gotFirstTokenRef.current && summarizeInFlightRef.current) {
        try {
          socketRef.current?.emit("stop_stream");
        } catch {}
        summarizeInFlightRef.current = false;

        fetch(`${BACKEND_ORIGIN}/summarize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        })
          .then(async (response) => {
            const raw = await response.text();
            let data: any = {};
            try {
              data = raw ? JSON.parse(raw) : {};
            } catch (e) {
              throw new Error(`Non-JSON ${response.status}: ${raw.slice(0, 200)}`);
            }
            if (!response.ok) {
              throw new Error(data.error || `HTTP ${response.status}`);
            }
            return data;
          })
          .then((data) => {
            const prev = lastFinalSummaryRef.current || "";
            const next = (data.summary || "").trim();
            const el = summaryEditorRef.current!;
            try {
              renderDiff(prev, next, el, clearHlTimerRef);
            } catch (e) {
              console.error("renderDiff error (HTTP) → fallback:", e);
              el.innerHTML = mdToHtml(next);
            }
            lastFinalSummaryRef.current = next;
            updateCountDisplay(next);
            setTimestamp(new Date().toLocaleString());
            showToast("Ringkasan diperbarui (HTTP)", "success");
            try {
              localStorage.setItem(LS_LAST_SUMMARY_KEY, lastFinalSummaryRef.current);
            } catch {}
          })
          .catch((err) => {
            console.error("HTTP summarize error:", err);
            showToast(`Gagal fallback HTTP: ${err.message}`, "error");
          })
          .finally(() => {
            completeProgress();
          });
      }
    }, 3000);
  }

  function scheduleAutoSummarize(latestText?: string) {
    if (!autoSummarizeEnabledRef.current) return;
    if (autoSummarizeTimerRef.current) {
      clearTimeout(autoSummarizeTimerRef.current);
      autoSummarizeTimerRef.current = null;
    }
    const textNow = (latestText ?? fullTranscriptRef.current ?? transcript ?? "").trim();
    autoSummarizeTimerRef.current = setTimeout(() => {
      const t = (latestText ?? fullTranscriptRef.current ?? transcript ?? "").trim();
      if (t.length > 10) requestSummarize(t, { showUI: false });
    }, 1200);
  }

  // ====== Public handlers untuk UI ======
  function startListening() {
    // Reset transcript & cache hanya saat user klik Mulai
    setTranscript("");
    fullTranscriptRef.current = "";
    try {
      localStorage.removeItem(LS_TRANSCRIPT_KEY);
    } catch {}
    const el = summaryEditorRef.current;
    if (el) el.innerHTML = "";
    manualStopRef.current = false;
    setTimestamp("");
    setCharCount("");

    try {
      recognitionRef.current?.start();
    } catch (err: any) {
      console.error("Failed to start recognition:", err);
      showToast("Tidak bisa mulai: izin mikrofon diblokir atau sudah berjalan.", "error");
      setIsListening(false);
    }
  }

  function stopListening() {
    manualStopRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {}
    try {
      socketRef.current?.emit("stop_stream");
    } catch {}
    summarizeInFlightRef.current = false;
    hideProgress();
  }

  function addManualTranscript() {
    const el = manualInputRef.current;
    if (!el) return;
    const text = el.value.trim();
    if (!text) return;
    fullTranscriptRef.current += text + " ";
    const merged = fullTranscriptRef.current;
    setTranscript(merged);
    try {
      localStorage.setItem(LS_TRANSCRIPT_KEY, merged);
    } catch {}
    el.value = "";
    scheduleAutoSummarize();
  }

  async function saveSummary() {
    const el = summaryEditorRef.current;
    const text = (el?.textContent || "").trim();
    if (!text) {
      showToast("Ringkasan kosong — tidak ada yang disimpan.", "error");
      return;
    }
    setSaving(true);
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user) {
        showToast("Harap login untuk menyimpan ringkasan.", "error");
        setSaving(false);
        return;
      }

      const payload = {
        user_id: user.id,
        original_text: (fullTranscriptRef.current || text).trim() || text,
        summary_result: text,

        metadata: {
          saved_at: new Date().toISOString(),
          transcript_length: (fullTranscriptRef.current || "").length,
          summary_length: text.length,
        },
      } as any;

      const { error } = await supabase.from("histories").insert([payload]);
      if (error) {
        console.warn("Supabase insert error:", error);
        showToast("Gagal menyimpan ringkasan ke database.", "error");
        setSaving(false);
        return;
      }

      try { localStorage.setItem(LS_LAST_SUMMARY_KEY, text); } catch {}
      showToast("Ringkasan tersimpan ke History", "success");
      setTimeout(() => { window.location.href = "/history"; }, 300);
    } catch (err) {
      console.error("Save request error:", err);
      showToast("Gagal koneksi ke server — coba lagi.", "error");
      setSaving(false);
    }
  }

  function onSummaryInput() {
    const el = summaryEditorRef.current;
    const txt = (el?.textContent || "").trim();
    updateCountDisplay(txt);
  }

  return {
    // refs yang perlu dipasang ke DOM VoicePanel
    summaryEditorRef,
    manualInputRef,

    // state untuk di-render UI
    transcript,
    isListening,
    timestamp,
    charCount,
    connLabel,
    connColor,
    toastMessage,
    toastType,
    toastVisible,
    progressVisible,
    progress,
    saving,

    // handlers untuk tombol/inputs
    startListening,
    stopListening,
    addManualTranscript,
    saveSummary,
    onSummaryInput,
  };
}
