# backend/api.py
import eventlet
# Wajib dipanggil pertama kali sebelum import library apapun!
eventlet.monkey_patch(thread=True, time=True)

import os
import time
import re
import uuid
import json
import traceback
from threading import Event
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

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
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# simple in-memory history store (newest first)
history_store = []

COLLECTIONS_STORE_PATH = os.path.join(os.path.dirname(__file__), "collections_store.json")


def _now_iso():
    return datetime.utcnow().isoformat() + "Z"


def _load_collections_store() -> list:
    if not os.path.exists(COLLECTIONS_STORE_PATH):
        return []

    try:
        with open(COLLECTIONS_STORE_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
            return data if isinstance(data, list) else []
    except Exception as exc:
        print(f"[collections] Failed to read store: {exc}")
        return []


def _save_collections_store(records: list) -> None:
    try:
        with open(COLLECTIONS_STORE_PATH, "w", encoding="utf-8") as handle:
            json.dump(records, handle, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f"[collections] Failed to write store: {exc}")
        raise


# =========================
# Config & Init
# =========================
load_dotenv()
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
MODEL = os.environ.get("GROQ_MODEL", "qwen/qwen3.6-27b")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# Email configuration
EMAIL_ADDRESS = os.environ.get("EMAIL_ADDRESS", "akhmadyasin704@gmail.com")
EMAIL_PASSWORD = os.environ.get("EMAIL_PASSWORD", "hmbrsrcnlxjrcrvj")
EMAIL_SMTP_SERVER = os.environ.get("EMAIL_SMTP_SERVER", "smtp.gmail.com")
EMAIL_SMTP_PORT = int(os.environ.get("EMAIL_SMTP_PORT", "587"))

print(f"[CONFIG] Email configured: {EMAIL_ADDRESS}")
print(f"[CONFIG] SMTP Server: {EMAIL_SMTP_SERVER}:{EMAIL_SMTP_PORT}")
if not EMAIL_PASSWORD:
    print("[CONFIG] WARNING: Email password not configured!")

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

def call_ai_api(prompt: str) -> str:
    """Panggil model AI via Groq API untuk ekstraksi JSON."""
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
        print(f"[call_ai_api] Error: {e}")
        return ""

def _normalize_json_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(key or "").strip().lower())


def _clean_field_value(value: object) -> str:
    if value is None:
        return ""

    text = str(value).strip()
    if not text:
        return ""

    text = re.sub(r"^['\"`]+|['\"`]+$", "", text)
    text = re.sub(r"\s+", " ", text)
    text = text.replace("(or just \"jaringan\")", "")
    text = text.replace("(likely", "")
    text = text.replace("Maybe", "")
    text = text.replace("I'll just output", "")
    text = re.sub(r"\s+", " ", text).strip(" .,:;-")
    return text


def extract_json(text: str) -> dict:
    """Ekstrak JSON dari response AI, dengan fallback yang lebih toleran."""
    import json
    if not text:
        return {}

    candidate = strip_think(text).strip()
    if not candidate:
        return {}

    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*|\s*```$", "", candidate, flags=re.IGNORECASE | re.MULTILINE).strip()

    for attempt in [candidate]:
        if "{" in attempt and "}" in attempt:
            match = re.search(r"\{.*\}", attempt, flags=re.DOTALL)
            if match:
                attempt = match.group(0)
        try:
            parsed = json.loads(attempt)
            if isinstance(parsed, dict):
                return parsed
        except Exception as e:
            print(f"[extract_json] parse failed: {e}")

    parsed = {}
    for line in candidate.splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().strip('"').strip("'")
        value = value.strip().strip('"').strip("'")
        if key:
            parsed[key] = value

    return parsed


def format_summary_fields(structured_data: dict, raw_text: str | None = None) -> str:
    """Format output ringkasan dari field JSON, atau fallback ke teks transkrip jika JSON kosong."""
    field_map = {
        "jaringan": "JARINGAN",
        "lokasi": "LOKASI",
        "didapatdengan": "DIDAPAT_DENGAN",
        "cairanfiksasi": "CAIRAN_FIKSASI",
        "diagnosaklinik": "DIAGNOSA_KLINIK",
        "keteranganklinik": "KETERANGAN_KLINIK",
        "makroskopik": "MAKROSKOPIK",
        "mikroskopik": "MIKROSKOPIK",
        "kesimpulan": "KESIMPULAN",
    }

    normalized_data: dict[str, str] = {}
    for raw_key, value in (structured_data or {}).items():
        normalized_key = _normalize_json_key(raw_key)
        cleaned_value = _clean_field_value(value)
        if normalized_key in field_map:
            normalized_data[field_map[normalized_key]] = cleaned_value
        elif cleaned_value:
            normalized_data[str(raw_key)] = cleaned_value

    fields = [
        ("JARINGAN", normalized_data.get("JARINGAN", "")),
        ("LOKASI", normalized_data.get("LOKASI", "")),
        ("DIDAPAT DENGAN", normalized_data.get("DIDAPAT_DENGAN", "")),
        ("CAIRAN FIKSASI", normalized_data.get("CAIRAN_FIKSASI", "")),
        ("DIAGNOSA KLINIK", normalized_data.get("DIAGNOSA_KLINIK", "")),
        ("KETERANGAN KLINIK", normalized_data.get("KETERANGAN_KLINIK", "")),
        ("MAKROSKOPIK", normalized_data.get("MAKROSKOPIK", "")),
        ("MIKROSKOPIK", normalized_data.get("MIKROSKOPIK", "")),
        ("KESIMPULAN", normalized_data.get("KESIMPULAN", "")),
    ]

    populated_lines = []
    for label, value in fields:
        clean_value = _clean_field_value(value)
        if clean_value:
            populated_lines.append(f"{label}: {clean_value}")

    if populated_lines:
        return "\n".join(populated_lines)

    if raw_text:
        fallback = re.sub(r"\s+", " ", raw_text).strip()
        if fallback:
            return fallback[:800] if len(fallback) > 800 else fallback

    return "Ringkasan belum tersedia."


# ---------- Helper function untuk mengirim email ----------
def send_email_smtp(to_email: str, subject: str, body: str, is_html: bool = False) -> tuple[bool, str]:
    """
    Mengirim email menggunakan Gmail SMTP.
    Returns: (success: bool, message: str)
    """
    try:
        print(f"[send_email_smtp] Starting email send to: {to_email}")
        print(f"[send_email_smtp] From: {EMAIL_ADDRESS}")
        print(f"[send_email_smtp] SMTP Server: {EMAIL_SMTP_SERVER}:{EMAIL_SMTP_PORT}")
        
        # Create message
        msg = MIMEMultipart('alternative')
        msg['From'] = EMAIL_ADDRESS
        msg['To'] = to_email
        msg['Subject'] = subject
        
        # Attach body
        if is_html:
            msg.attach(MIMEText(body, 'html'))
        else:
            msg.attach(MIMEText(body, 'plain'))
        
        print(f"[send_email_smtp] Message created, connecting to SMTP...")
        
        # Connect to Gmail SMTP and send
        with smtplib.SMTP(EMAIL_SMTP_SERVER, EMAIL_SMTP_PORT) as server:
            print(f"[send_email_smtp] Connected to SMTP, starting TLS...")
            server.starttls()
            print(f"[send_email_smtp] TLS started, logging in...")
            server.login(EMAIL_ADDRESS, EMAIL_PASSWORD)
            print(f"[send_email_smtp] Login successful, sending message...")
            server.send_message(msg)
            print(f"[send_email_smtp] Message sent successfully!")
        
        return True, "Email berhasil dikirim"
    except smtplib.SMTPAuthenticationError as e:
        print(f"[send_email_smtp] Authentication Error: {e}")
        return False, "Email atau sandi aplikasi Gmail tidak valid"
    except smtplib.SMTPException as e:
        print(f"[send_email_smtp] SMTP Error: {e}")
        return False, f"SMTP Error: {str(e)}"
    except Exception as e:
        print(f"[send_email_smtp] General Exception: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False, f"Error mengirim email: {str(e)}"


def _normalize_history_payload(hasil_patologi_id, petugas_id, nama_petugas, metode, tujuan, status):
    # Test hook: _normalize_history_payload(...)
    # - Membersihkan dan menormalisasi payload sebelum disimpan ke `history_pengiriman`.
    # - Pastikan fallback values (nama_petugas, metode_pengiriman, tujuan_pengiriman, status) ditetapkan.
    def _clean_optional_uuid(value):
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return str(value)
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            try:
                return str(uuid.UUID(text))
            except ValueError:
                return None
        return None

    def _clean_text(value, fallback=None):
        # Test hook: _clean_text(value, fallback)
        # - Menghapus whitespace, mengembalikan fallback jika kosong/null.
        if value is None:
            return fallback
        if isinstance(value, str):
            text = value.strip()
            return text or fallback
        return str(value)

    payload = {
        "hasil_patologi_id": _clean_optional_uuid(hasil_patologi_id),
        "petugas_id": _clean_optional_uuid(petugas_id),
        "nama_petugas": _clean_text(nama_petugas, "System"),
        "metode_pengiriman": _clean_text(metode, "api"),
        "tujuan_pengiriman": _clean_text(tujuan, "API RS"),
        "status": _clean_text(status, "success"),
    }
    return payload


def log_pengiriman_history(hasil_patologi_id: str, petugas_id: str, nama_petugas: str, 
                           metode: str, tujuan: str, status: str) -> bool:
    """
    Log pengiriman ke history_pengiriman table.
    If the supplied foreign-key IDs are invalid or absent, retry without them so
    the history entry still gets stored.
    Returns: success (bool)
    """
    # Test hook: log_pengiriman_history(hasil_patologi_id, petugas_id, nama_petugas, metode, tujuan, status)
    # - Memastikan entry tersimpan ke Supabase `history_pengiriman`.
    # - Pada error FK, fungsi mencoba fallback insert tanpa FK.
    try:
        if not supabase:
            print("[log_pengiriman_history] Supabase not configured")
            return False

        payload = _normalize_history_payload(
            hasil_patologi_id,
            petugas_id,
            nama_petugas,
            metode,
            tujuan,
            status,
        )

        print(f"[log_pengiriman_history] Logging: {payload['metode_pengiriman']} to {payload['tujuan_pengiriman']} - {payload['status']}")

        response = supabase.table("history_pengiriman").insert(payload).execute()
        print(f"[log_pengiriman_history] Successfully logged: {response.data}")
        return True
    except Exception as e:
        error_text = str(e)
        print(f"[log_pengiriman_history] Error: {type(e).__name__}: {error_text}")
        if "foreign key" in error_text.lower() or "violat" in error_text.lower():
            try:
                fallback_payload = dict(payload)
                fallback_payload["hasil_patologi_id"] = None
                fallback_payload["petugas_id"] = None
                response = supabase.table("history_pengiriman").insert(fallback_payload).execute()
                print(f"[log_pengiriman_history] Fallback insert succeeded: {response.data}")
                return True
            except Exception as fallback_error:
                print(f"[log_pengiriman_history] Fallback insert failed: {type(fallback_error).__name__}: {fallback_error}")
        traceback.print_exc()
        return False

def get_user_from_access_token(access_token: str):
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise Exception("Supabase settings are not configured.")

    url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/user"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {access_token}",
    }
    request_obj = Request(url, headers=headers, method="GET")
    with urlopen(request_obj) as response:
        return json.load(response)

@app.route('/api/admin/create-user', methods=['POST'])
def create_user_admin():
    if not supabase:
        return jsonify({"error": "Supabase service is not configured."}), 500

    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({"error": "Authorization header missing or invalid."}), 401

    access_token = auth_header.split(' ', 1)[1].strip()
    if not access_token:
        return jsonify({"error": "Access token is required."}), 401

    try:
        current_user = get_user_from_access_token(access_token)
    except HTTPError as e:
        try:
            body = e.read().decode('utf-8')
            error_payload = json.loads(body)
            message = error_payload.get('message') or body
        except Exception:
            message = str(e)
        return jsonify({"error": message}), e.code
    except URLError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        print(f"[create_user_admin] Error verifying current user: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to verify current user."}), 500

    user_meta = current_user.get('user_metadata') or {}
    raw_meta = current_user.get('raw_user_meta_data') or {}
    current_role = (user_meta.get('role') or raw_meta.get('role') or '').lower()
    if current_role != 'superadmin':
        return jsonify({"error": "Only superadmin users may create new accounts."}), 403

    payload = request.get_json(silent=True) or {}
    email = (payload.get('email') or '').strip().lower()
    password = payload.get('password') or ''
    username = (payload.get('username') or '').strip()
    display_name = (payload.get('display_name') or username).strip()
    new_role = (payload.get('role') or '').strip().lower() if isinstance(payload.get('role'), str) else ''

    if not email or not password or not username or not new_role:
        return jsonify({"error": "email, password, username, and role are required."}), 400

    if new_role not in {'dokter', 'petugas'}:
        return jsonify({"error": "role must be either 'dokter' or 'petugas'."}), 400

    try:
        url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/admin/users"
        body = {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {
                "username": username,
                "display_name": display_name,
                "summary_mode": "patologi",
                "role": new_role,
            },
            "raw_user_meta_data": {
                "username": username,
                "display_name": display_name,
                "summary_mode": "patologi",
                "role": new_role,
            },
        }
        headers = {
            "apiKey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        }
        request_obj = Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method='POST')
        with urlopen(request_obj) as response:
            created_user = json.load(response)

        return jsonify({
            "success": True,
            "user": {
                "id": created_user.get('id'),
                "email": created_user.get('email'),
                "user_metadata": created_user.get('user_metadata') or {},
                "raw_user_meta_data": created_user.get('raw_user_meta_data') or {},
            }
        })
    except HTTPError as e:
        try:
            body = e.read().decode('utf-8')
            error_payload = json.loads(body)
            message = error_payload.get('message') or body
        except Exception:
            message = str(e)
        return jsonify({"error": message}), e.code
    except URLError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        print(f"[create_user_admin] Unexpected error: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to create the user."}), 500

@app.route('/api/user-meta/<user_id>', methods=['GET'])
def get_user_meta(user_id):
    if not supabase:
        return jsonify({"error": "Supabase service is not configured."}), 500

    try:
        url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/admin/users/{user_id}"
        headers = {
            "apiKey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        }
        request_obj = Request(url, headers=headers, method='GET')
        with urlopen(request_obj) as response:
            data = json.load(response)

        return jsonify({
            "id": data.get("id"),
            "email": data.get("email"),
            "user_metadata": data.get("user_metadata") or {},
            "raw_user_meta_data": data.get("raw_user_meta_data") or {},
        })
    except HTTPError as e:
        try:
            body = e.read().decode('utf-8')
            error_payload = json.loads(body)
            message = error_payload.get('message') or body
        except Exception:
            message = str(e)
        return jsonify({"error": message}), e.code
    except URLError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        print(f"[get_user_meta] Unexpected error: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to retrieve user metadata."}), 500

@app.route('/api/collections', methods=['POST'])
def create_collection():
    payload = request.get_json(silent=True) or {}

    if not payload:
        return jsonify({"success": False, "error": "Request body cannot be empty."}), 400

    collection_id = str(payload.get("collection_id") or uuid.uuid4())
    created_at = _now_iso()

    record = {
        "id": collection_id,
        "created_at": created_at,
        "updated_at": created_at,
        "status": "received",
        "status_message": "Data berhasil diterima oleh API Anda.",
        "source": payload.get("source") or "app",
        "payload": payload,
        "metadata": {
            "received_via": "POST /api/collections",
            "can_be_pulled_by_rs": True,
        },
    }

    records = _load_collections_store()
    records.insert(0, record)
    _save_collections_store(records)

    try:
        record_payload = payload.get("record") or {}
        petugas_id = payload.get("petugas_id") or payload.get("user_id")
        if petugas_id is not None and not str(petugas_id).strip():
            petugas_id = None

        log_pengiriman_history(
            payload.get("report_id") or payload.get("collection_id") or record_payload.get("id"),
            petugas_id,
            payload.get("nama_petugas") or record_payload.get("nama_petugas") or "System",
            payload.get("metode_pengiriman") or "api",
            payload.get("tujuan_pengiriman") or "API RS",
            "success",
        )
    except Exception as exc:
        print(f"[collections] Failed to log history: {exc}")

    return jsonify({
        "success": True,
        "message": "Collection berhasil disimpan.",
        "collection": record,
    }), 201


@app.route('/api/collections', methods=['GET'])
def list_collections():
    records = _load_collections_store()
    status_filter = request.args.get("status", "").strip().lower()

    if status_filter:
        records = [item for item in records if (item.get("status") or "").lower() == status_filter]

    limit = request.args.get("limit", "50")
    try:
        limit_value = max(1, min(int(limit), 200))
    except ValueError:
        limit_value = 50

    return jsonify({
        "success": True,
        "count": len(records[:limit_value]),
        "collections": records[:limit_value],
    })


@app.route('/api/collections/<collection_id>', methods=['GET'])
def get_collection_detail(collection_id):
    records = _load_collections_store()
    record = next((item for item in records if item.get("id") == collection_id), None)

    if not record:
        return jsonify({"success": False, "error": "Collection tidak ditemukan."}), 404

    return jsonify({"success": True, "collection": record})


@app.route('/api/collections/<collection_id>/status', methods=['PATCH'])
def update_collection_status(collection_id):
    payload = request.get_json(silent=True) or {}
    new_status = (payload.get("status") or "").strip()

    if not new_status:
        return jsonify({"success": False, "error": "Field 'status' wajib diisi."}), 400

    records = _load_collections_store()
    record = next((item for item in records if item.get("id") == collection_id), None)

    if not record:
        return jsonify({"success": False, "error": "Collection tidak ditemukan."}), 404

    record["status"] = new_status
    record["updated_at"] = _now_iso()
    record["status_message"] = payload.get("message") or f"Status diperbarui menjadi {new_status}."
    record.setdefault("history", []).append({
        "timestamp": _now_iso(),
        "status": new_status,
        "message": record["status_message"],
    })

    _save_collections_store(records)

    return jsonify({"success": True, "message": "Status collection berhasil diperbarui.", "collection": record})


@app.route('/process-report', methods=['POST'])
def process_report():
    data = request.json
    raw_text = data.get('text')
    user_id = data.get('user_id')
    
    # 1. Panggil AI untuk Ekstraksi Medis
    ai_response = call_ai_api(build_prompt(raw_text))
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
                structured_data = extract_json(summary)
                formatted_summary = format_summary_fields(structured_data, text)
                return jsonify({"summary": formatted_summary})
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


@app.route("/api/history/<history_id>", methods=["DELETE"])
def api_delete_history(history_id):
    """Delete a history_pengiriman record using service role credentials."""
    try:
        if not supabase:
            return jsonify({"status": "error", "message": "Supabase not configured"}), 500

        response = supabase.table("history_pengiriman").delete().eq("id", history_id).execute()
        if hasattr(response, "error") and response.error:
            return jsonify({"status": "error", "message": response.error.message}), 400

        if not getattr(response, "data", None) or len(response.data) == 0:
            return jsonify({"status": "error", "message": "Record tidak ditemukan"}), 404

        return jsonify({"status": "success", "data": response.data}), 200
    except Exception as e:
        print(f"[/api/history/<id>] EXCEPTION: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/history", methods=["GET"])
def api_history():
    return jsonify({"history": history_store})


# ---------- Email API endpoint ----------
@app.route("/api/send-email", methods=["POST"])
def api_send_email():
    """Send email via Gmail SMTP and log to history_pengiriman"""
    try:
        print(f"\n[/api/send-email] === REQUEST RECEIVED ===")
        
        data = request.get_json(force=True, silent=True) or {}
        print(f"[/api/send-email] Received data: {list(data.keys())}")
        
        to_email = data.get("to_email", "").strip()
        subject = data.get("subject", "Hasil Patologi").strip()
        body = data.get("body", "").strip()
        is_html = data.get("is_html", False)
        hasil_patologi_id = data.get("hasil_patologi_id", "").strip()
        petugas_id = data.get("petugas_id", "").strip()
        nama_petugas = data.get("nama_petugas", "Unknown").strip()
        
        print(f"[/api/send-email] to_email: {to_email}")
        print(f"[/api/send-email] subject: {subject[:50]}...")
        print(f"[/api/send-email] body length: {len(body)}")
        print(f"[/api/send-email] hasil_patologi_id: {hasil_patologi_id}")
        print(f"[/api/send-email] petugas_id: {petugas_id}")
        print(f"[/api/send-email] nama_petugas: {nama_petugas}")
        
        # Validasi input
        if not to_email:
            print(f"[/api/send-email] ERROR: to_email is empty")
            return jsonify({"status": "error", "message": "Email tujuan tidak boleh kosong"}), 400
        
        if not subject:
            print(f"[/api/send-email] ERROR: subject is empty")
            return jsonify({"status": "error", "message": "Subject tidak boleh kosong"}), 400
        
        if not body:
            print(f"[/api/send-email] ERROR: body is empty")
            return jsonify({"status": "error", "message": "Isi email tidak boleh kosong"}), 400
        
        # Validasi format email
        if "@" not in to_email or "." not in to_email:
            print(f"[/api/send-email] ERROR: Invalid email format")
            # Log failed attempt even jika ID tidak lengkap
            log_pengiriman_history(hasil_patologi_id, petugas_id, nama_petugas, "email", to_email, "failed")
            return jsonify({"status": "error", "message": "Format email tidak valid"}), 400
        
        print(f"[/api/send-email] Validation passed, sending email...")
        
        # Kirim email
        success, message = send_email_smtp(to_email, subject, body, is_html)
        
        print(f"[/api/send-email] Email send result: success={success}, message={message}")
        
        # Log ke history_pengiriman selalu jika ada koneksi Supabase
        status_log = "success" if success else "failed"
        print(f"[/api/send-email] About to call log_pengiriman_history with: {hasil_patologi_id}, {petugas_id}, {nama_petugas}, email, {to_email}, {status_log}")
        log_pengiriman_history(hasil_patologi_id, petugas_id, nama_petugas, "email", to_email, status_log)
        
        if success:
            print(f"[/api/send-email] SUCCESS: {message}")
            return jsonify({"status": "success", "message": message}), 200
        else:
            print(f"[/api/send-email] FAILED: {message}")
            return jsonify({"status": "error", "message": message}), 400
            
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"[/api/send-email] EXCEPTION: {error_msg}")
        traceback.print_exc()
        return jsonify({"status": "error", "message": error_msg}), 500


@app.route("/api/test-email", methods=["GET"])
def api_test_email():
    """Test email configuration"""
    try:
        print(f"\n[/api/test-email] === TESTING EMAIL CONFIG ===")
        print(f"[/api/test-email] EMAIL_ADDRESS: {EMAIL_ADDRESS}")
        print(f"[/api/test-email] EMAIL_SMTP_SERVER: {EMAIL_SMTP_SERVER}")
        print(f"[/api/test-email] EMAIL_SMTP_PORT: {EMAIL_SMTP_PORT}")
        print(f"[/api/test-email] EMAIL_PASSWORD exists: {bool(EMAIL_PASSWORD)}")
        
        test_subject = "Test PathoNote Email"
        test_body = "Ini adalah email test dari PathoNote backend.\n\nJika Anda menerima email ini, konfigurasi email sudah bekerja dengan baik!"
        
        success, message = send_email_smtp(EMAIL_ADDRESS, test_subject, test_body, False)
        
        if success:
            return jsonify({"status": "success", "message": f"Email test berhasil: {message}"}), 200
        else:
            return jsonify({"status": "error", "message": f"Email test gagal: {message}"}), 400
            
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"[/api/test-email] EXCEPTION: {error_msg}")
        return jsonify({"status": "error", "message": error_msg}), 500


# ---------- STREAM summarize (SocketIO) ----------

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
        structured_data = extract_json(final_fmt)
        formatted_summary = format_summary_fields(structured_data, text)
        emit("summary_stream", {"final": formatted_summary, "end": True})
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
