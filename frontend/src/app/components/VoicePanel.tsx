// #voicepanel.tsx

"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { io, Socket } from "socket.io-client";
import { diffWords } from "diff";

type ToastType = "success" | "error" | "info";
type Maybe<T> = T | null;

const BACKEND_ORIGIN =
  process.env.NEXT_PUBLIC_BACKEND_ORIGIN || "http://127.0.0.1:5001";

const LS_LAST_SUMMARY_KEY = "vt2_last_summary";
const AUTO_CLEAR_HL_MS = 8000;

function mdToHtml(text: string) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

// Test hook: mdToHtml(text)
// - Convert markdown-lite to simple HTML for summary rendering.

function renderDiff(prev: string, next: string, el: HTMLElement, clearTimerRef: React.MutableRefObject<any>) {
  if (!el) return;
  if ((prev || "") === (next || "")) {
    el.innerHTML = mdToHtml(next || "");
    return;
  }
  // Find unchanged prefix/suffix, highlight only new part
  let start = 0;
  while (start < prev.length && prev[start] === next[start]) start++;
  let endPrev = prev.length - 1;
  let endNext = next.length - 1;
  while (endPrev >= start && endNext >= start && prev[endPrev] === next[endNext]) {
    endPrev--;
    endNext--;
  }
  const prefix = next.slice(0, start);
  const mid = next.slice(start, endNext + 1);
  const suffix = next.slice(endNext + 1);

  // If previous highlight exists, keep it until its timer ends
  // Allow multiple highlights if updates arrive before previous fades
  let html = mdToHtml(prefix);
  if (mid) html += `<span class="hl-add">${mdToHtml(mid)}</span>`;
  html += mdToHtml(suffix);
  el.innerHTML = html;

  // Do NOT clear previous highlights, let CSS animation handle fade
  // No timer to reset innerHTML, so multiple highlights can overlap
}

// Test hook: renderDiff(prev, next, el, clearTimerRef)
// - Apply diff highlight to editor element; verify highlighted segments appear.

function replaceSpokenPunctuation(text: string) {
  return (text || "")
    .replace(/\btitik\b/gi, ".")
    .replace(/\bkoma\b/gi, ",")
    .replace(/\btanda tanya\b/gi, "?")
    .replace(/\btanda seru\b/gi, "!")
    .replace(/\btitik dua\b/gi, ":")
    .replace(/\btitik koma\b/gi, ";");
}

// Test hook: replaceSpokenPunctuation(text)
// - Replace spoken punctuation words with corresponding symbols.

export default function VoicePanel({ isOpen = true }: { isOpen?: boolean }) {
  const socketRef = useRef<Maybe<Socket>>(null);
  const recognitionRef = useRef<any>(null);
  const summaryEditorRef = useRef<HTMLDivElement>(null);
  const fullTranscriptRef = useRef<string>("");
  const lastFinalSummaryRef = useRef<string>("");
  const lastTranscriptLengthRef = useRef<number>(0); // DIGUNAKAN UNTUK MENGECEK PERUBAHAN
  const clearHlTimerRef = useRef<any>(null);
  const autoSummarizeTimerRef = useRef<any>(null);
  const summarizeInFlightRef = useRef<boolean>(false);
  const lastEmitRef = useRef<number>(0);

  const [role, setRole] = useState<"dokter" | "petugas" | "loading">("loading");
  const [allowed, setAllowed] = useState(false);
  
  // MODIFIKASI: Tingkatkan interval ke 3000ms (3 detik)
  const MIN_SUMMARY_INTERVAL = 3000; 

  // Batas minimum karakter baru untuk memicu ringkasan baru
  const MIN_CHAR_DIFFERENCE = 20;

  const [transcript, setTranscript] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isTranscriptionPaused, setIsTranscriptionPaused] = useState(false);
  const [hasStartedSession, setHasStartedSession] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Menyambungkan...");
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);
  const isListeningRef = useRef(false);
  const isTranscriptionPausedRef = useRef(false);
  const allowedRef = useRef(false);
  const roleRef = useRef<"dokter" | "petugas" | "loading">("loading");
  const lastVoiceCommandRef = useRef("");
  const lastVoiceCommandAtRef = useRef(0);
  
  const showToast = (msg: string, type: ToastType = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    if (!isOpen) {
      if (recognitionRef.current) {
        recognitionRef.current.isManuallyStopped = true;
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
      setIsTranscriptionPaused(true);
    }
  }, [isOpen]);

  useEffect(() => {
    allowedRef.current = allowed;
  }, [allowed]);

  useEffect(() => {
    isTranscriptionPausedRef.current = isTranscriptionPaused;
  }, [isTranscriptionPaused]);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  const handleVoiceCommand = (text: string) => {
    const cleaned = (text || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");

    if (!cleaned) return false;

    const now = Date.now();
    if (
      cleaned === lastVoiceCommandRef.current &&
      now - lastVoiceCommandAtRef.current < 1500
    ) {
      return false;
    }

    lastVoiceCommandRef.current = cleaned;
    lastVoiceCommandAtRef.current = now;

    const isStopCommand = /(^|\b)(klik|tekan)?\s*(stop|berhenti|hentikan)\b/.test(cleaned);
    const isContinueCommand = /(^|\b)(klik|tekan)?\s*(continue|lanjut|lanjutkan)\b/.test(cleaned);
    const isSaveCommand = /(^|\b)(klik|tekan)?\s*(save|simpan)\b/.test(cleaned);

    const canUseVoiceCommand = roleRef.current !== "petugas";

    if (isStopCommand) {
      if (!canUseVoiceCommand) {
        showToast("Voice command cannot be processed due to limited access.", "error");
        return true;
      }
      if (isTranscriptionPausedRef.current) {
        showToast("Transcription is paused. Use Continue or Save.", "info");
      } else if (isListeningRef.current) {
        handleStopListening();
      } else {
        showToast("Recording already stopped.", "info");
      }
      return true;
    }

    if (isContinueCommand) {
      if (!canUseVoiceCommand) {
        showToast("Voice command cannot be processed due to limited access.", "error");
        return true;
      }
      if (isListeningRef.current && !isTranscriptionPausedRef.current) {
        showToast("Recording is running.", "info");
      } else {
        void handleSecondaryAction();
      }
      return true;
    }

    if (isSaveCommand) {
      if (!canUseVoiceCommand) {
        showToast("Voice command cannot be processed due to limited access.", "error");
        return true;
      }
      const el = summaryEditorRef.current;
      const summaryText = (el?.textContent || "").trim();
      if (!summaryText) {
        showToast("Summary is empty — nothing to save.", "error");
        return true;
      }
      const saveButton = document.getElementById("saveBtn") as HTMLButtonElement | null;
      saveButton?.click();
      return true;
    }

    return false;
  };

  // Test hook: handleVoiceCommand(text)
  // - Interpret voice commands like stop/continue/save and trigger UI actions.

  const refreshUserRole = async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      const userRole = (user?.user_metadata?.role || "dokter").toString().toLowerCase();
      const normalizedRole = userRole === "petugas" ? "petugas" : "dokter";
      setRole(normalizedRole);
      setAllowed(normalizedRole === "dokter");
      return normalizedRole;
    } catch (err) {
      console.error("[VoicePanel] failed to load user role", err);
      setRole("dokter");
      setAllowed(true);
      return "dokter" as const;
    }
  };

  // Test hook: refreshUserRole()
  // - Fetch current user role from Supabase and set local role/permission state.

  useEffect(() => {
    void refreshUserRole();
  }, []);

  const scheduleAutoSummarize = (_text: string) => {
    // Ringkasan tidak lagi dipicu secara realtime saat transkrip berubah.
    // Ringkasan hanya dibuat saat pengguna menekan tombol stop.
    return;
  };

  // Test hook: scheduleAutoSummarize(text)
  // - (Disabled) placeholder for scheduling summary generation.
  
  useEffect(() => {
    const socket = io(BACKEND_ORIGIN, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => setConnectionStatus("🟢 Connected"));
    socket.on("disconnect", () => setConnectionStatus("🔴 Disconnected"));
    socket.on("connect_error", () => setConnectionStatus("🟡 Failed"));

    socket.on("summary_stream", (data: any) => {
      const editor = summaryEditorRef.current;
      if (!editor) return;
      
      if (data.error) {
        showToast(`Error: ${data.error}`, "error");
        summarizeInFlightRef.current = false;
        return;
      }

      let nextSummary = lastFinalSummaryRef.current;
      if (data.token) nextSummary += data.token;
      if (data.final) nextSummary = data.final.trim();
      
      renderDiff(lastFinalSummaryRef.current, nextSummary, editor, clearHlTimerRef);
      lastFinalSummaryRef.current = nextSummary;
      
      if (data.end) {
        summarizeInFlightRef.current = false;
        localStorage.setItem(LS_LAST_SUMMARY_KEY, nextSummary.trim());
      }
    });
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = "id-ID";
      recognition.continuous = true;
      recognition.interimResults = true;
      
      recognition.onresult = (event: any) => {
        let interim = "";
        let newFinalText = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const chunk = event.results[i][0].transcript || "";
          const normalizedChunk = replaceSpokenPunctuation(chunk);
          
          if (event.results[i].isFinal) {
            handleVoiceCommand(normalizedChunk);
            if (!isTranscriptionPausedRef.current) {
              newFinalText += normalizedChunk + " ";
            }
          } else if (!isTranscriptionPausedRef.current) {
            interim += chunk;
          }
        }

        if (!isTranscriptionPausedRef.current) {
          if (newFinalText) {
            fullTranscriptRef.current += newFinalText;
          }
          const currentTranscript = fullTranscriptRef.current + interim;
          setTranscript(currentTranscript);
          scheduleAutoSummarize(currentTranscript);
        }
      };
      
      recognition.onstart = () => setIsListening(true);
      
      recognition.onend = () => {
        // Jangan langsung matikan isListening jika kita berniat me-restart secara otomatis
        if (recognitionRef.current && !recognitionRef.current.isManuallyStopped) {
          // Beri jeda 400ms agar OS HP punya waktu untuk menutup session mik lama 
          // dan mencegah efek loop feedback suara 'beep' bawaan HP
          setTimeout(() => {
            if (recognitionRef.current && !recognitionRef.current.isManuallyStopped) {
              try {
                recognition.start();
                setIsListening(true);
              } catch (err) {
                console.error("SpeechRecognition restart failed:", err);
              }
            }
          }, 400);
        } else {
          setIsListening(false);
        }
      };
      
      recognition.onerror = (event: any) => {
        const errorCode = event?.error || "unknown";
        console.error("SpeechRecognition error:", errorCode, event);
        
        // JANGAN langsung matikan mik jika error-nya cuma 'no-speech' (user diam terlalu lama di HP)
        if (errorCode === "no-speech") {
          return; 
        }

        setIsListening(false);
        if (recognitionRef.current) recognitionRef.current.isManuallyStopped = true;

        const friendlyMessage =
          errorCode === "network"
            ? "Failed to start speech recognition: check your network connection."
            : `SpeechRecognition error: ${errorCode}`;
        showToast(friendlyMessage, "error");
      };
      recognitionRef.current = recognition;
    } else {
      alert("Your browser does not support Web Speech API. Try using Google Chrome.");
    }
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.isManuallyStopped = true;
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      socket.disconnect();
    };
  }, []);

  const clearSessionState = () => {
    fullTranscriptRef.current = "";
    lastFinalSummaryRef.current = "";
    lastTranscriptLengthRef.current = 0;
    setTranscript("");
    if (summaryEditorRef.current) summaryEditorRef.current.innerHTML = "";
    try {
      localStorage.removeItem("vt2_transcript");
      localStorage.removeItem(LS_LAST_SUMMARY_KEY);
    } catch {}
  };

  const handleStartListening = async (forceRestart = false) => {
    if (roleRef.current === "loading") {
      await refreshUserRole();
    }

    if (roleRef.current !== "dokter") {
      showToast("Voice Panel access is only available for Doctors.", "error");
      return;
    }

    const recognitionAlreadyActive = Boolean(isListeningRef.current || recognitionRef.current?.isManuallyStopped === false);
    setIsTranscriptionPaused(false);
    setIsListening(true);

    if (!recognitionRef.current) {
      return;
    }

    if (recognitionAlreadyActive) {
      return;
    }

    const hasExistingTranscript = (fullTranscriptRef.current || "").trim().length > 0;
    if (forceRestart || !hasExistingTranscript) {
      clearSessionState();
    }

    try {
      recognitionRef.current.isManuallyStopped = false;
      recognitionRef.current.start();
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (!/already started|already active/i.test(msg)) {
        showToast("Gagal melanjutkan perekaman. Coba lagi.", "error");
      }
    }
  };

  // Test hook: handleStartListening(forceRestart)
  // - Start or restart SpeechRecognition session and manage transcript state.

  const handleSecondaryAction = async () => {
    if (isTranscriptionPausedRef.current) {
      await handleStartListening(false);
    } else if (isListeningRef.current) {
      handleStopListening();
    } else {
      await handleStartListening(false);
    }
  };

  // Test hook: handleSecondaryAction()
  // - Toggle between start/stop/continue behavior depending on current state.

  const handleStopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.isManuallyStopped = true;
      setIsTranscriptionPaused(true);
      setIsListening(true);

      const textToSummarize = (fullTranscriptRef.current || "").trim();
      if (textToSummarize) {
        requestSummarize(textToSummarize, true);
      }

      showToast("Transcription UI is paused. Microphone remains active until Save.", "info");
    }
  };

  // Test hook: handleStopListening()
  // - Pause UI transcription, trigger summary request for accumulated transcript.

  const handleRestartListening = () => {
    fullTranscriptRef.current = "";
    lastFinalSummaryRef.current = "";
    lastTranscriptLengthRef.current = 0;
    setTranscript("");
    if (summaryEditorRef.current) summaryEditorRef.current.innerHTML = "";
    try {
      localStorage.removeItem("vt2_transcript");
      localStorage.removeItem(LS_LAST_SUMMARY_KEY);
    } catch {}

    if (recognitionRef.current) {
      recognitionRef.current.isManuallyStopped = false;
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error("Failed to restart recognition:", err);
        showToast("Failed to restart. Try again.", "error");
      }
    }
  };

  // Test hook: handleRestartListening()
  // - Clear session state and attempt to restart recognition.

  const saveToPathology = async (userId: string, text: string) => {
    const response = await fetch(`${BACKEND_ORIGIN}/process-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, user_id: userId }),
    });

    const data = await response.json();
    if (!response.ok || data.status !== "success") {
      throw new Error(data.message || "Failed to save examination results");
    }
    return data;
  };

  // Test hook: saveToPathology(userId, text)
  // - POSTs report text to backend `/process-report` and returns parsed response.

  const requestSummarize = (text: string, showUI: boolean = true) => {
    if (!text || !socketRef.current?.connected) return;

    // If a summary stream is already in flight, stop it so we can start a fresh one
    if (summarizeInFlightRef.current) {
      try {
        socketRef.current.emit("stop_stream");
      } catch {}
      summarizeInFlightRef.current = false;
    }

    summarizeInFlightRef.current = true;
    
    if (showUI && summaryEditorRef.current) {
        summaryEditorRef.current.innerHTML = "<i>Processing summary...</i>";
    }
    
    socketRef.current.emit("summarize_stream", { text });
  };

  // Test hook: requestSummarize(text, showUI)
  // - Emit socket event to backend for streaming summarization.

  const hasExistingTranscript = (fullTranscriptRef.current || "").trim().length > 0 || (transcript || "").trim().length > 0;
  const secondaryButtonLabel = isTranscriptionPaused ? "Continue" : isListening ? "Stop" : "Continue";
  const secondaryButtonTitle = isTranscriptionPaused
    ? "Continue transcription in UI"
    : isListening
      ? "Stop transcription in UI, microphone remains active"
      : "Continue transcription in UI";

  return (
    <>
      <div className="vtt-flex-container">
        { role === "petugas" && (
          <div style={{ marginBottom: 14, padding: '14px 18px', background: '#fff1f2', color: '#991b1b', borderRadius: 14, border: '1px solid #fecdd3' }}>
            Voice Panel access is limited. Officer role cannot start listening.
          </div>
        ) }
        {/* Kolom Kiri */}
        <div className="column transcript-col">
          {/* TAMBAHKAN DIV KOSONG INI SEBAGAI SPACER */}
          <div className="summary-header">&nbsp;</div>

          <div
            className="editor"
            style={{ minHeight: 120, flexGrow: 1, marginBottom: 0, overflow: 'auto', maxHeight: '60vh' }}
          >
            <div
              id="transcript"
              role="region"
              aria-label="Transcript"
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                fontSize: '16px',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                padding: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {transcript}
            </div>
          </div>
          <div className="btn-group" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              id="startBtn"
              onClick={() => {
                setHasStartedSession(true);
                handleStartListening(hasStartedSession);
              }}
              disabled={!allowed || isListening}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: !allowed || isListening ? '#f3f4f6' : '#f4f6fa',
                color: !allowed || isListening ? '#9ca3af' : '#2d3748',
                fontWeight: 500,
                border: '1px solid #d1d9e6',
                borderRadius: 24,
                padding: '8px 22px',
                fontSize: 16,
                cursor: !allowed || isListening ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s, border 0.2s',
                boxShadow: 'none',
                outline: 'none',
              }}
              title={role === "loading" ? "Loading role..." : allowed ? "Start recording" : "Voice Panel is for Doctors only"}
              onMouseOver={e => {
                if (!allowed || isListening) return;
                e.currentTarget.style.background = '#e6eaf3';
                e.currentTarget.style.border = '1.5px solid #bfc9d9';
              }}
              onMouseOut={e => {
                if (!allowed || isListening) return;
                e.currentTarget.style.background = '#f4f6fa';
                e.currentTarget.style.border = '1px solid #d1d9e6';
              }}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: 6}}>
                <circle cx="10" cy="10" r="10" fill="#b2f5ea"/>
                <polygon points="8,6 15,10 8,14" fill="#319795"/>
              </svg>
              {role === "loading" ? 'Loading...' : allowed ? (hasStartedSession ? 'Restart' : 'Start') : 'Limited access'}
            </button>

            <button
              id="stopBtn"
              onClick={() => handleSecondaryAction()}
              disabled={!allowed}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: !allowed || isListening ? (!allowed ? '#f3f4f6' : '#fff5f5') : '#f4f6fa',
                color: !allowed || isListening ? (!allowed ? '#9ca3af' : '#c53030') : '#2d3748',
                fontWeight: 500,
                border: !allowed || isListening ? (!allowed ? '1px solid #d1d9e6' : '1px solid #feb2b2') : '1px solid #d1d9e6',
                borderRadius: 24,
                padding: '8px 22px',
                fontSize: 16,
                cursor: !allowed ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s, border 0.2s',
                boxShadow: 'none',
                outline: 'none',
              }}
              title={secondaryButtonTitle}
              onMouseOver={e => {
                if (!allowed) return;
                if (isListening) {
                  e.currentTarget.style.background = '#ffe3e3';
                  e.currentTarget.style.border = '1.5px solid #fc8181';
                } else {
                  e.currentTarget.style.background = '#e6eaf3';
                  e.currentTarget.style.border = '1.5px solid #bfc9d9';
                }
              }}
              onMouseOut={e => {
                if (!allowed) return;
                if (isListening) {
                  e.currentTarget.style.background = '#fff5f5';
                  e.currentTarget.style.border = '1px solid #feb2b2';
                } else {
                  e.currentTarget.style.background = '#f4f6fa';
                  e.currentTarget.style.border = '1px solid #d1d9e6';
                }
              }}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: 6}}>
                <circle cx="10" cy="10" r="10" fill={isListening ? '#feb2b2' : '#b2f5ea'}/>
                <rect x="7" y="7" width="6" height="6" rx="2" fill={isListening ? '#c53030' : '#319795'}/>
              </svg>
              {secondaryButtonLabel}
            </button>
          </div>
        </div>

        {/* Kolom Kanan */}
        <div className="column summary-col">
          <div className="summary-header">
            <span className="connection-status">{connectionStatus}</span>
          </div>
          <div
            ref={summaryEditorRef}
            id="summaryEditor"
            className="editor"
            contentEditable
            data-placeholder="Summary will appear here..."
            style={{ minHeight: 120, flexGrow: 1, marginBottom: 0, overflow: 'auto', maxHeight: '60vh', padding: 8 }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              id="saveBtn"
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: '#f4f6fa',
                color: '#2d3748',
                fontWeight: 500,
                border: '1px solid #d1d9e6',
                borderRadius: 24,
                padding: '8px 22px',
                fontSize: 16,
                cursor: 'pointer',
                transition: 'background 0.2s, border 0.2s',
                boxShadow: 'none',
                outline: 'none',
              }}
              onMouseOver={e => {
                e.currentTarget.style.background = '#e6eaf3';
                e.currentTarget.style.border = '1.5px solid #bfc9d9';
              }}
              onMouseOut={e => {
                e.currentTarget.style.background = '#f4f6fa';
                e.currentTarget.style.border = '1px solid #d1d9e6';
              }}
              onClick={async () => {
                if (recognitionRef.current) {
                  recognitionRef.current.isManuallyStopped = true;
                  try { recognitionRef.current.stop(); } catch {}
                }
                setIsListening(false);
                setIsTranscriptionPaused(true);

                const el = summaryEditorRef.current;
                const summaryText = (el?.textContent || "").trim();
                const original = (fullTranscriptRef.current || "").trim();
                if (!summaryText) {
                  showToast("Ringkasan kosong — tidak ada yang disimpan.", "error");
                  return;
                }

                // Check auth user
                try {
                  const { data } = await supabase.auth.getUser();
                  const user = data?.user;
                  if (!user) {
                    showToast("Harap login untuk menyimpan ringkasan.", "error");
                    return;
                  }

                  const payload = {
                    user_id: user.id,
                    original_text: original || summaryText,
                    summary_result: summaryText,
                    metadata: {
                      saved_at: new Date().toISOString(),
                      transcript_length: (original || "").length,
                      summary_length: summaryText.length,
                    },
                  } as any;

                  let pathologySaved = false;
                  let collectionSaved = false;
                  let pathologyError: string | null = null;
                  let collectionError: string | null = null;

                  try {
                    await saveToPathology(user.id, summaryText);
                    pathologySaved = true;
                  } catch (err: any) {
                    pathologyError = err?.message || String(err);
                    console.error("❌ Pathology save failed:", err);
                  }

                  try {
                    const response = await supabase.from("collections").insert([payload]);
                    console.log("[VoicePanel] Full response:", response);
                    const { error, data: insertData, status } = response;
                    if (error) {
                      collectionError = error.message;
                      console.error("❌ Supabase insert error:", error);
                      console.error("Error details:", {
                        message: error.message,
                        code: error.code,
                        details: error.details,
                        hint: error.hint,
                      });
                    } else {
                      collectionSaved = true;
                      console.log("[VoicePanel] Insert successful! Status:", status, "Data:", insertData);
                    }
                  } catch (err: any) {
                    collectionError = err?.message || String(err);
                    console.error("❌ Exception during save:", err);
                  }

                  if (!collectionSaved && !pathologySaved) {
                    showToast("Gagal menyimpan ke Collections dan Hasil Patologi.", "error");
                    return;
                  }

                  if (!collectionSaved) {
                    showToast(`Hasil Patologi tersimpan, tetapi Collections gagal: ${collectionError}`, "info");
                    return;
                  }

                  if (!pathologySaved) {
                    showToast(`Collections tersimpan, tetapi Hasil Patologi gagal: ${pathologyError}`, "info");
                    try { localStorage.setItem(LS_LAST_SUMMARY_KEY, summaryText); } catch {}
                    setTimeout(() => { window.location.href = "/collections"; }, 350);
                    return;
                  }

                  try { localStorage.setItem(LS_LAST_SUMMARY_KEY, summaryText); } catch {}
                  showToast("Ringkasan tersimpan ke Collections dan Hasil Patologi", "success");
                  setTimeout(() => { window.location.href = "/collections"; }, 350);
                } catch (err) {
                  console.error("Save to Supabase error:", err);
                  showToast("Gagal menyimpan — coba lagi.", "error");
                }
              }}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: 6}}>
                <circle cx="10" cy="10" r="10" fill="#bee3f8"/>
                <path d="M7 10.5L9.5 13L13 7" stroke="#3182ce" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Save
            </button>
          </div>
        </div>
      </div>
      {toast && (
        <div className={`toast show ${toast.type}`}>
          {toast.msg}
        </div>
      )}
    </>
  );
}
