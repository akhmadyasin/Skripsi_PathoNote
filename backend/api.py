# backend/api.py
import os
import time
import re
import uuid
import traceback
from threading import Event
from datetime import datetime, timezone

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from groq import Groq
from dotenv import load_dotenv
from werkzeug.exceptions import HTTPException
from supabase import create_client, Client
import secrets
import string
from datetime import timedelta

# simple in-memory history store (newest first)
history_store = []

def _now_iso():
    return datetime.utcnow().isoformat() + "Z"


# =========================
# Config & Init
# =========================
load_dotenv()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# Initialize Supabase client
supabase: Client = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY and SUPABASE_SERVICE_KEY != "PASTE_YOUR_SERVICE_ROLE_KEY_HERE":
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print("[SUPABASE] Client initialized successfully")
    except Exception as e:
        print(f"[SUPABASE] Failed to initialize client: {e}")
        supabase = None
else:
    print("[SUPABASE] Not configured - share features will be disabled")

app = Flask(__name__, static_folder="static", template_folder="templates")
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

stop_flags = {}  # {sid: Event}


# =========================
# Helpers
# =========================
def strip_think(text: str) -> str:
    """Hapus blok <think>...</think> bila ada."""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE).strip()

def build_prompt(text: str) -> str:
    # Daftar istilah medis sebagai referensi koreksi AI
    anchor_terms = (
        "Lien, Colon, Anus, Mammae, Appendix, Gaster, Hepar, Thyroid, Prostat, Ovarium, Uterus, "
        "Vesica Fellea, Hiperemis, Perforasi, Kistik, Kenyal, Rapuh, Formalin, "
        "Epitel Gepeng, Ulseratif, Spindel, Hiperplastis, Polimorfi, Hiperkromatis, Mitosis, "
        "Udematus, Limfosit, Hemoroid, Carcinoma, Spindel Cell Carcinoma, "
        "Infiltrasi, Nekrosis, Edema, Hemorajik, Splenomegali, Adenokarsinoma"
    )

    return f"""
Anda adalah Dokter Spesialis Patologi Anatomi. Ekstrak teks laporan berikut ke JSON.
Field yang harus dicari:
- JARINGAN, LOKASI, DIDAPAT_DENGAN, CAIRAN_FIKSASI
- DIAGNOSA_KLINIK, KETERANGAN_KLINIK
- MAKROSKOPIK, MIKROSKOPIK, KESIMPULAN

Daftar Istilah Medis (Gunakan sebagai referensi koreksi jika teks terdengar mirip):
{anchor_terms}

Aturan:
1. Output WAJIB JSON saja.
2. Jika tidak ada di teks, isi "".
3. Gunakan bahasa medis yang baku.
4. KOREKSI FONETIK: Jika menemukan kata yang salah tulis namun bunyinya mirip dengan istilah medis (contoh: 'Lion' menjadi 'Lien', 'Calon' menjadi 'Colon', 'Plenomegali' menjadi 'Splenomegali'), perbaikilah secara otomatis berdasarkan konteks laporan.

Teks: {text}
JSON:
"""

def call_llama_api(prompt: str) -> str:
    """Panggil Groq API untuk ekstraksi JSON."""
    if not client:
        raise Exception("Groq client not initialized")
    
    try:
        response = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=MODEL,
            temperature=0.1,  # Lower temperature for more consistent JSON output
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        print(f"[call_llama_api] Error: {e}")
        return ""

def extract_json(text: str) -> dict:
    """Ekstrak JSON dari response AI."""
    import json
    try:
        # Cari JSON dalam response
        start = text.find('{')
        end = text.rfind('}') + 1
        if start >= 0 and end > start:
            json_str = text[start:end]
            return json.loads(json_str)
    except Exception as e:
        print(f"[extract_json] Error parsing JSON: {e}")
    
    # Fallback: return empty dict
    return {}

@app.route('/process-report', methods=['POST'])
def process_report():
    data = request.json
    raw_text = data.get('text')
    user_id = data.get('user_id')
    
    # 1. Panggil AI untuk Ekstraksi Medis
    ai_response = call_llama_api(build_prompt(raw_text))
    structured_data = extract_json(ai_response)

    # 2. Siapkan Payload Lengkap sesuai Tabel SQL
    # Kita bagi jadi beberapa bagian agar rapi
    
    final_payload = {
        "user_id": user_id,
        
        # --- DATA ADMINISTRATIF ---
        "kunjungan": data.get("kunjungan", "AUTO-" + datetime.now().strftime("%Y%m%d%H%M")),
        "tanggal": datetime.now().strftime("%Y-%m-%d"),
        "waktu": datetime.now().strftime("%H:%M:%S"),
        "jenis_pemeriksaan": 1,
        "id_simgos": "layanan.laboratorium.pa.hasil.Model-3", # Sesuai format JSON RS kamu
        "nomor_pa": data.get("nomor_pa", "000000"),
        "pa_sebelumnya": "",
        "asisten": data.get("asisten", "AI-PathoNote"),
        "dokter": 14, # Hardcoded Jazay / Bisa ambil dari profil
        "oleh": 0,
        "status": 1,

        # --- DATA TEKNIS MEDIS (Hasil Ekstraksi AI) ---
        "jaringan": structured_data.get("JARINGAN", ""),
        "lokasi": structured_data.get("LOKASI", ""),
        "didapat_dengan": structured_data.get("DIDAPAT_DENGAN", ""),
        "cairan_fiksasi": structured_data.get("CAIRAN_FIKSASI", ""),
        "diagnosa_klinik": structured_data.get("DIAGNOSA_KLINIK", ""),
        "keterangan_klinik": structured_data.get("KETERANGAN_KLINIK", ""),
        
        # --- OUTPUT UTAMA ---
        "makroskopik": structured_data.get("MAKROSKOPIK", ""),
        "mikroskopik": structured_data.get("MIKROSKOPIK", ""),
        "kesimpulan": structured_data.get("KESIMPULAN", ""),

        # --- DATA SPESIFIK TUMOR / TAMBAHAN (Default Values) ---
        "permintaan_ihc": "",
        "topography": "",
        "morphology": "",
        "grade": 0,
        "perilaku_tumor": 0,
        "imuno_histokimia": "",
        "bukan_tumor": 1, 
        "reevolusi": "",
        "reevaluasi": "",
        "tanggal_imuno": None,

        # --- TRACKING ---
        "status_pengiriman": "pending"
    }

    # 3. Insert ke Supabase
    try:
        response = supabase.table("hasil_patologi").insert(final_payload).execute()
        return jsonify({"status": "success", "data": response.data}), 201
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


def _parse_retry_after_seconds(message: str):
    try:
        m = re.search(r"in\s+(?:(\d+)m)?(\d+(?:\.\d+)?)s", message)
        if not m:
            return None
        minutes = float(m.group(1)) if m.group(1) else 0.0
        seconds = float(m.group(2))
        return minutes * 60.0 + seconds
    except Exception:
        return None


# =========================
# Error handler global
# =========================
@app.errorhandler(Exception)
def handle_exception(e):
    code = 500
    msg = str(e)
    if isinstance(e, HTTPException):
        code = e.code or 500
        msg = e.description
    return jsonify({"error": msg}), code


# =========================
# Routes (Pages)
# =========================
@app.route("/")
def base_page():
    # Layout utama: sidebar + iframe (default: /dashboard)
    return render_template("base.html")


@app.route("/dashboard")
def dashboard_page():
    return render_template("dashboard.html")


@app.route("/voice")
def voice_page():
    return render_template("index.html")


@app.route("/index")
def index_alias():
    return render_template("index.html")


@app.route("/history")
def history_page():
    return render_template("history.html", history=history_store)


@app.route("/settings")
def settings_page():
    return render_template("settings.html")

# Mode hardcoded to 'patologi' - no longer user-selectable


# =========================
# Routes (APIs)
# =========================
@app.route("/test", methods=["GET"])
def test():
    return jsonify({"status": "connected", "message": "Backend is running"})

# ... (di bawah fungsi def test():)

# =========================
# Rute Tes Diagnostik Baru
# =========================
@app.route("/test_groq_http", methods=["GET"])
def test_groq_http():
    print("\n--- [DIAGNOSTIK] Memulai tes via HTTP ---")
    try:
        if not client:
            print("--- [DIAGNOSTIK] Client Groq tidak terinisialisasi.")
            return jsonify({"error": "Groq client not initialized"}), 500

        print("--- [DIAGNOSTIK] Menghubungi Groq via HTTP... ---")
        chat_completion = client.chat.completions.create(
            messages=[{"role": "user", "content": "Hello world"}],
            model=MODEL, # Menggunakan MODEL global yang sudah kita perbaiki
            temperature=0.5,
        )
        
        result = chat_completion.choices[0].message.content
        print(f"--- [DIAGNOSTIK] Berhasil! Respons: {result} ---")
        return jsonify({"status": "sukses", "response": result})

    except Exception as e:
        print(f"--- [DIAGNOSTIK] GAGAL! Error: {type(e).__name__} - {e} ---")
        return jsonify({"error": f"{type(e).__name__}: {e}"}), 500



# =========================
# Routes (APIs)
# =========================
# ... (sisa kode Anda dimulai dari sini)

# ---------- HTTP summarize ----------
@app.route("/summarize", methods=["POST"])
def summarize():
    try:
        data = request.get_json(force=True, silent=True) or {}
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"error": "Teks kosong"}), 400

        if not client:
            return jsonify({"error": "groq_api_key_missing", "message": "GROQ_API_KEY not configured"}), 500

        prompt = build_prompt(text)
        print("[/summarize] text_len=", len(text))

        max_retries = 3
        base_sleep = 3.0
        attempt = 0
        while True:
            try:
                resp = client.chat.completions.create(
                    messages=[{"role": "user", "content": prompt}],
                    model=MODEL,
                    temperature=0.3,
                )
                summary_raw = (resp.choices[0].message.content or "").strip()
                summary = strip_think(summary_raw)
                return jsonify({"summary": summary})
            except Exception as e:
                msg = f"{type(e).__name__}: {e}"
                print("[/summarize] ERROR:", msg)
                low = str(e).lower()
                is_rate = "rate limit" in low or "rate_limit" in low
                is_conn = any(k in low for k in ["connection", "timeout", "timed out", "temporarily"])
                retry_after = _parse_retry_after_seconds(str(e)) or base_sleep
                attempt += 1

                if (is_rate or is_conn) and attempt <= max_retries:
                    sleep_for = retry_after * (2 ** (attempt - 1))
                    print(f"[/summarize] retry in {sleep_for:.1f}s (attempt {attempt}/{max_retries})")
                    time.sleep(sleep_for)
                    continue

                if is_rate:
                    return jsonify({"error": "rate_limit", "message": str(e), "retry_after": max(5, int(retry_after))}), 429
                if is_conn:
                    return jsonify({"error": "upstream_connection", "message": str(e)}), 502
                return jsonify({"error": str(e)}), 500

    except Exception as e:
        print("ERROR /summarize (outer):", f"{type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ---------- SAVE (history) ----------
@app.route("/save", methods=["POST"])
def save_summary():
    try:
        try:
            print("\n[/save] === request headers ===")
            for k, v in request.headers.items():
                print(f"{k}: {v}")
        except Exception:
            print("[/save] failed to print headers")

        try:
            raw = request.get_data(as_text=True)
            print("[/save] raw body (first 2000 chars):", raw[:2000])
        except Exception as e:
            print("[/save] could not read raw body:", e)

        payload = {}
        try:
            payload = request.get_json(force=True, silent=False) or {}
            print("[/save] parsed JSON keys:", list(payload.keys()))
        except Exception as e:
            print("[/save] get_json failed:", type(e).__name__, e)
            return jsonify({"error": "invalid_json", "message": str(e)}), 400

        text = (payload.get("text") or "").strip()
        meta = payload.get("meta") or {}

        if not text:
            print("[/save] empty text -> 400")
            return jsonify({"error": "empty_text"}), 400

        entry = {
            "id": str(uuid.uuid4()),
            "text": text,
            "meta": meta,
            "created_at": _now_iso()
        }

        history_store.insert(0, entry)  # newest first
        print(f"[/save] saved entry id={entry['id']} len={len(text)} created_at={entry['created_at']}")
        return jsonify({"status": "ok", "entry": entry}), 200

    except Exception as e:
        print("ERROR /save (exception):", type(e).__name__, e)
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/save_echo", methods=["POST"])
def save_echo():
    try:
        raw = request.get_data(as_text=True)
        print("[/save_echo] got raw:", raw[:2000])
        return jsonify({"ok": True, "echo": raw[:2000]}), 200
    except Exception as e:
        print("ERROR /save_echo:", e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/history", methods=["GET"])
def api_history():
    return jsonify({"history": history_store})

# ---------- STREAM summarize (SocketIO) ----------
@socketio.on("summarize_stream")
def handle_summarize_stream(data):
    sid = request.sid
    text = (data.get("text") or "").strip()
    if not text:
        emit("summary_stream", {"error": "Teks kosong"})
        return

    if not client:
        emit("summary_stream", {"error": "groq_api_key_missing"})
        return

    prompt = build_prompt(text)
    print(f"[stream] start SID={sid} text_len={len(text)}")

    stop_evt = Event()
    stop_flags[sid] = stop_evt

    try:
        response = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=MODEL,
            temperature=0.3,
            stream=True
        )

        token_count = 0
        collected = []
        for chunk in response:
            if stop_evt.is_set():
                print(f"[stream] stopped by client SID={sid}")
                break

            try:
                choice = chunk.choices[0]
            except Exception:
                continue

            text_piece = None
            delta = getattr(choice, "delta", None)
            if delta and getattr(delta, "content", None):
                text_piece = delta.content
            if not text_piece:
                message_obj = getattr(choice, "message", None)
                if message_obj and getattr(message_obj, "content", None):
                    text_piece = message_obj.content

            if text_piece:
                token_count += len(text_piece)
                collected.append(text_piece)
                emit("summary_stream", {"token": text_piece})

        final_raw = "".join(collected).strip()
        final_fmt = strip_think(final_raw)
        emit("summary_stream", {"final": final_fmt, "end": True})
        print(f"[stream] end SID={sid} tokens={token_count}")

    except Exception as e:
        msg = f"{type(e).__name__}: {e}"
        print(f"[stream] error SID={sid}: {msg}")
        emit("summary_stream", {"error": str(e)})
    finally:
        stop_flags.pop(sid, None)


@socketio.on("stop_stream")
def handle_stop_stream():
    sid = request.sid
    if sid in stop_flags:
        stop_flags[sid].set()
    emit("stop_stream")


@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    if sid in stop_flags:
        stop_flags[sid].set()
    print(f"[socket] disconnect SID={sid}")


# =========================
# Main
# =========================
if __name__ == "__main__":
    socketio.run(app, debug=True, use_reloader=False,
                 host="127.0.0.1", port=int(os.environ.get("PORT", 5001)),
                 allow_unsafe_werkzeug=True) # <-- TAMBAHKAN INI