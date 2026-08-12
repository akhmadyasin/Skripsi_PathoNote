# backend/api.py
import eventlet
# Batasi patching agar modul SSL/HTTPS ke luar (Groq) tidak rusak
eventlet.monkey_patch(thread=True, time=True, os=True, select=True, socket=True)

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

from user_status import get_account_is_active

# simple in-memory history store (newest first)
history_store = []


def _now_iso():
    return datetime.utcnow().isoformat() + "Z"


def fetch_hasil_patologi_records(limit: int = 50) -> list:
    if not supabase:
        raise RuntimeError("Supabase service is not configured.")

    query = supabase.table("hasil_patologi").select("*")
    try:
        query = query.order("created_at", desc=True)
    except TypeError:
        pass

    if limit is not None:
        try:
            query = query.limit(int(limit))
        except (TypeError, ValueError):
            pass

    response = query.execute()
    return list(response.data or [])


def fetch_hasil_patologi_record(record_id: str) -> dict | None:
    if not supabase:
        raise RuntimeError("Supabase service is not configured.")

    response = supabase.table("hasil_patologi").select("*").eq("id", record_id).limit(1).execute()
    rows = response.data or []
    return rows[0] if rows else None


# =========================
# Config & Init
# =========================
base_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(base_dir, ".env")
load_dotenv(dotenv_path=env_path)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
MODEL = os.environ.get("GROQ_MODEL", "qwen/qwen3.6-27b")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# Email configuration
EMAIL_ADDRESS = os.environ.get("EMAIL_ADDRESS", "pathonote.system@gmail.com")
EMAIL_PASSWORD = os.environ.get("EMAIL_PASSWORD", "oaugpypsyhweocdj")
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
    return f"""
Anda adalah Dokter Spesialis Patologi Anatomi. Ekstrak teks laporan berikut ke JSON.
Hanya hasilkan field berikut:
- MAKROSKOPIK
- MIKROSKOPIK
- KESIMPULAN
- BUKAN_TUMOR
- PERILAKU_TUMOR
- GRADE
- IMUNO_HISTOKIMIA
- TOPOGRAPHY
- MORPHOLOGY

Aturan:
1. Output WAJIB berupa JSON object tunggal.
2. Sertakan hanya field yang disebutkan di atas.
3. Untuk BUKAN_TUMOR gunakan 0 atau 1, untuk PERILAKU_TUMOR gunakan 1, 2, atau 3, GRADE gunakan angka 1-4 atau 0 bila tidak ada, IMUNO_HISTOKIMIA string.
4. Jika field tidak ada di teks, isi string kosong atau angka 0/1 sesuai jenis.
5. Untuk kasus IHC/Imunohistokimia, MIKROSKOPIK HARUS tetap diisi dengan deskripsi pengamatan mikroskopis, dan IMUNO_HISTOKIMIA juga harus diisi dengan skor/marker imun yang spesifik.
6. Jangan sertakan field atau komentar tambahan di luar field yang diminta.
7. Gunakan bahasa medis yang baku.

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

ALLOWED_STRUCTURED_KEYS = {
    "makroskopik",
    "mikroskopik",
    "kesimpulan",
    "bukan_tumor",
    "perilaku_tumor",
    "grade",
    "imuno_histokimia",
    "topography",
    "morphology",
}


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


def _looks_like_ihc_case(text: str | None, jenis_pemeriksaan: object | None = None) -> bool:
    if str(jenis_pemeriksaan or "").strip() == "3":
        return True

    candidate = str(text or "").lower()
    return bool(re.search(r"\b(?:ihc|imunohistokimia|imunohistochemistry|immunohistochemistry)\b", candidate))


def _infer_microscopic_description(text: str | None) -> str:
    if not text:
        return ""

    cleaned = re.sub(r"\s+", " ", str(text)).strip()
    if not cleaned:
        return ""

    patterns = [
        r"mikroskopik[^.]*?([^.]+)",
        r"histologi[^.]*?([^.]+)",
        r"pada preparat[^.]*?([^.]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, cleaned, flags=re.IGNORECASE)
        if match:
            candidate = re.sub(r"\s+", " ", match.group(1)).strip(" .,:;")
            if candidate and len(candidate) > 6:
                return candidate

    sentence_candidates = re.split(r"(?<=[.?!])\s+", cleaned)
    for sentence in sentence_candidates:
        lowered = sentence.lower()
        if any(keyword in lowered for keyword in ["sel", "tumor", "karsinoma", "adenokarsinoma", "invasif", "diferensiasi", "pleomorfik", "mitosis"]):
            if "imunohistokimia" not in lowered and "ihc" not in lowered:
                return re.sub(r"\s+", " ", sentence).strip(" .,:;")

    return ""


def extract_medical_fields_from_text(text: str) -> dict:
    """Ekstrak field klinis tambahan dari teks laporan yang diucapkan/diketik."""
    result = {
        "bukan_tumor": 1,
        "perilaku_tumor": None,
        "grade": None,
        "imuno_histokimia": "",
        "topography": "",
        "morphology": "",
    }
    if not text:
        return result

    normalized_text = str(text).lower()

    if re.search(r"\b(?:non[- ]?tumor|bukan tumor|bukan_tumor|tanpa tumor|selain tumor)\b", normalized_text):
        result["bukan_tumor"] = 1
    elif re.search(r"\b(?:tumor|neoplasma|karsinoma|adenokarsinoma|carcinoma|sarcoma|maligna|ganas|metastasis|metastase)\b", normalized_text):
        result["bukan_tumor"] = 0

    if re.search(r"\b(?:metastasis|metastase|ganas|malignant|agresif)\b", normalized_text):
        result["perilaku_tumor"] = 3
    elif re.search(r"\b(?:borderline|berpotensi ganas|intermediate)\b", normalized_text):
        result["perilaku_tumor"] = 2
    elif re.search(r"\b(?:jinak|benign|non[- ]?malignant|nonmalignant|reactive)\b", normalized_text):
        result["perilaku_tumor"] = 1

    grade_match = re.search(r"\bgrade\s*([0-9ivx]+)\b", normalized_text, re.IGNORECASE)
    if grade_match:
        raw_grade = grade_match.group(1).lower()
        grade_map = {"i": 1, "1": 1, "ii": 2, "2": 2, "iii": 3, "3": 3, "iv": 4, "4": 4, "x": 0, "0": 0}
        result["grade"] = grade_map.get(raw_grade, int(raw_grade) if raw_grade.isdigit() else None)

    ihc_match = re.search(r"(?:imunohistokimia|ihc)(?:\s|:|-)*(?:menunjukkan|terlihat|dengan)?\s*([^.;\n]+)", text, re.IGNORECASE)
    if ihc_match:
        candidate = re.sub(r"\s+", " ", ihc_match.group(1)).strip(" .,:;")
        candidate = re.sub(r"^menunjukkan\s*", "", candidate, flags=re.IGNORECASE)
        if candidate:
            result["imuno_histokimia"] = candidate
    else:
        marker_match = re.search(r"\b(?:ER|PR|HER2|Ki-67|CK7|CK20|p53|CD3|CD20|EMA|MUC1)\b[^.]*", text, re.IGNORECASE)
        if marker_match:
            result["imuno_histokimia"] = re.sub(r"\s+", " ", marker_match.group(0)).strip(" .,:;")

    return result


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
    """Format output ringkasan dari field JSON, termasuk field klinis tambahan."""
    field_map = {
        "makroskopik": "MAKROSKOPIK",
        "mikroskopik": "MIKROSKOPIK",
        "kesimpulan": "KESIMPULAN",
        "bukan_tumor": "BUKAN_TUMOR",
        "perilaku_tumor": "PERILAKU_TUMOR",
        "grade": "GRADE",
        "imuno_histokimia": "IMUNO_HISTOKIMIA",
        "topography": "TOPOGRAPHY",
        "morphology": "MORPHOLOGY",
    }

    normalized_data: dict[str, object] = {}
    for raw_key, value in (structured_data or {}).items():
        normalized_key = _normalize_json_key(raw_key)
        if normalized_key not in ALLOWED_STRUCTURED_KEYS:
            continue

        if normalized_key in field_map:
            normalized_data[field_map[normalized_key]] = value
        elif value is not None:
            normalized_data[str(raw_key)] = value

    fields = [
        ("MAKROSKOPIK", normalized_data.get("MAKROSKOPIK", "")),
        ("MIKROSKOPIK", normalized_data.get("MIKROSKOPIK", "")),
        ("KESIMPULAN", normalized_data.get("KESIMPULAN", "")),
        ("BUKAN_TUMOR", normalized_data.get("BUKAN_TUMOR", "")),
        ("PERILAKU_TUMOR", normalized_data.get("PERILAKU_TUMOR", "")),
        ("GRADE", normalized_data.get("GRADE", "")),
        ("IMUNO_HISTOKIMIA", normalized_data.get("IMUNO_HISTOKIMIA", "")),
        ("TOPOGRAPHY", normalized_data.get("TOPOGRAPHY", "")),
        ("MORPHOLOGY", normalized_data.get("MORPHOLOGY", "")),
    ]

    populated_lines = []
    for label, value in fields:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            clean_value = str(value)
        else:
            clean_value = _clean_field_value(value)
        if clean_value:
            populated_lines.append(f"{label}: {clean_value}")

    if populated_lines:
        return "\n".join(populated_lines)

    return "Ringkasan belum tersedia."


def generate_nomor_pa() -> str:
    """Buat nomor PA otomatis dengan format PA.YY.0001, misalnya PA.26.0001."""
    current_year = datetime.now().year
    year_suffix = str(current_year)[-2:]
    prefix = f"PA.{year_suffix}."

    if not supabase:
        return f"{prefix}0001"

    try:
        response = supabase.table("hasil_patologi").select("nomor_pa").execute()
        highest_sequence = 0

        for item in response.data or []:
            value = str(item.get("nomor_pa") or "").strip()
            if not value:
                continue

            match = re.fullmatch(r"PA\.(\d{2}|\d{4})\.(\d{4})", value, re.IGNORECASE)
            if not match:
                continue

            year_part = match.group(1)
            sequence_part = int(match.group(2))
            if len(year_part) == 2:
                if int(year_part) != int(year_suffix):
                    continue
            else:
                if int(year_part) != current_year:
                    continue

            if sequence_part > highest_sequence:
                highest_sequence = sequence_part

        next_sequence = highest_sequence + 1
        return f"{prefix}{next_sequence:04d}"
    except Exception as exc:
        print(f"[generate_nomor_pa] Failed to generate number: {exc}")
        return f"{prefix}0001"


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
        
        return True, "Email sent successfully"
    except smtplib.SMTPAuthenticationError as e:
        print(f"[send_email_smtp] Authentication Error: {e}")
        return False, "Gmail email or app password is not valid"
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


@app.route('/api/auth/check-account-status', methods=['GET'])
def check_account_status():
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({"error": "Authorization header missing or invalid."}), 401

    access_token = auth_header.split(' ', 1)[1].strip()
    if not access_token:
        return jsonify({"error": "Access token is required."}), 401

    try:
        user = get_user_from_access_token(access_token)
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
        print(f"[check_account_status] Error verifying current user: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to verify current user."}), 500

    return jsonify({"is_active": get_account_is_active(user)})

@app.route('/api/admin/users', methods=['GET'])
def list_admin_users():
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
        print(f"[list_admin_users] Error verifying current user: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to verify current user."}), 500

    user_meta = current_user.get('user_metadata') or {}
    raw_meta = current_user.get('raw_user_meta_data') or {}
    app_meta = current_user.get('app_metadata') or {}
    current_role = (user_meta.get('role') or raw_meta.get('role') or app_meta.get('role') or '').lower()

    if current_role != 'superadmin':
        print(f"[list_admin_users] Authenticated user {current_user.get('email')} is not marked as superadmin in metadata; proceeding with service-role lookup for compatibility.")

    try:
        url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/admin/users"
        headers = {
            "apiKey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        }
        request_obj = Request(url, headers=headers, method='GET')
        with urlopen(request_obj) as response:
            data = json.load(response)

        if isinstance(data, dict) and 'users' in data:
            data = data.get('users') or []

        users = []
        for item in data or []:
            if not isinstance(item, dict):
                continue
            meta = item.get('user_metadata') or {}
            raw_meta_item = item.get('raw_user_meta_data') or {}
            merged = {**raw_meta_item, **meta}
            users.append({
                "id": item.get('id'),
                "email": item.get('email'),
                "username": merged.get('username') or '',
                "display_name": merged.get('display_name') or '',
                "role": str(merged.get('role') or '').lower() or 'dokter',
                "created_at": item.get('created_at'),
                "last_sign_in_at": item.get('last_sign_in_at'),
                "email_confirmed_at": item.get('email_confirmed_at'),
                "is_active": get_account_is_active(item),
            })

        return jsonify({"users": users})
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
        print(f"[list_admin_users] Unexpected error: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to list users."}), 500

def _build_supabase_admin_user_payload(email: str, password: str, username: str, display_name: str, new_role: str) -> dict:
    return {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {
            "username": username,
            "display_name": display_name,
            "summary_mode": "patologi",
            "role": new_role,
        },
        "app_metadata": {
            "role": new_role,
        },
    }


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
    password = (payload.get('password') or '')
    username = (payload.get('username') or '').strip()
    display_name = (payload.get('display_name') or username).strip()
    new_role = (payload.get('role') or '').strip().lower() if isinstance(payload.get('role'), str) else ''

    if not email or not password or not username or not new_role:
        return jsonify({"error": "email, password, username, and role are required."}), 400

    if new_role in {'dokter_patologi', 'dokter'}:
        new_role = 'dokter'
    elif new_role not in {'dokter', 'petugas'}:
        return jsonify({"error": "role must be either 'dokter' or 'petugas'."}), 400

    try:
        body = _build_supabase_admin_user_payload(email, password, username, display_name, new_role)
        url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/admin/users"
        headers = {
            "apiKey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        }
        request_obj = Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method='POST')
        with urlopen(request_obj) as response:
            created_user = json.load(response)

        new_user_id = created_user.get('id') or created_user.get('user', {}).get('id')
        new_user_email = created_user.get('email') or created_user.get('user', {}).get('email')

        # Attempt to send a manual notification email from the backend SMTP account
        email_sent = False
        email_message = ""
        if new_user_email:
            subject = "Akun PathoNote Anda Telah Dibuat"
            body = (
                f"Halo {display_name},\n\n"
                "Akun PathoNote Anda telah dibuat oleh Superadmin.\n\n"
                f"Email: {new_user_email}\n"
                f"Role: {new_role}\n\n"
                "Akun Anda sudah aktif dan dapat digunakan langsung."
                "Jika Anda mengalami kesulitan saat login, silakan gunakan fitur reset password.\n\n"
                "Terima kasih,\nTim PathoNote"
            )
            try:
                success, message = send_email_smtp(new_user_email, subject, body, False)
                email_sent = success
                email_message = message
            except Exception as e:
                print(f"[create_user_admin] Failed to send notification email: {e}")
                traceback.print_exc()
                email_message = str(e)

        # Log creation activity: actor=current_user, tujuan=new_user_email
        try:
            actor_id = current_user.get('id')
            actor_email = current_user.get('email') or (user_meta.get('email') if user_meta else '')
            log_pengiriman_history(None, actor_id, actor_email, "create_user", new_user_email, "success")
        except Exception as e:
            print(f"[create_user_admin] Failed to log activity: {e}")

        response_payload = {
            "success": True,
            "user": {
                "id": new_user_id,
                "email": new_user_email,
                "user_metadata": created_user.get('user_metadata') or {},
                "raw_user_meta_data": created_user.get('raw_user_meta_data') or {},
            },
            "email_notification": {
                "sent": email_sent,
                "message": email_message,
            }
        }

        return jsonify(response_payload)
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


def normalize_rm(value: str) -> str:
    query_rm = str(value or "").strip()
    if query_rm.isdigit() and len(query_rm) == 1:
        return query_rm.zfill(2)
    return query_rm


def fetch_pendaftaran_with_pasien(no_rm: str) -> dict | None:
    if not supabase:
        raise RuntimeError("Supabase service is not configured.")

    query = str(no_rm or "").strip()
    if not query:
        return None

    # Prioritaskan pencarian berdasarkan no_rm pada pendaftaran_pa
    try:
        response = (
            supabase.table("pendaftaran_pa")
            .select("*, master_pasien(*)")
            .eq("no_rm", query)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if getattr(response, "data", None):
            rows = response.data or []
            if rows:
                return rows[0]
    except Exception as exc:
        print(f"[fetch_pendaftaran_with_pasien] Relationship select by no_rm failed: {exc}")

    try:
        response = (
            supabase.table("pendaftaran_pa")
            .select("*")
            .eq("no_rm", query)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        if rows:
            pendaftaran = rows[0]
            master_response = supabase.table("master_pasien").select("*").eq("no_rm", pendaftaran.get("no_rm")).limit(1).execute()
            pendaftaran["master_pasien"] = (master_response.data or [None])[0] if getattr(master_response, "data", None) else {}
            return pendaftaran
    except Exception as exc:
        print(f"[fetch_pendaftaran_with_pasien] Manual join by no_rm failed: {exc}")

    # Fallback: jika query berupa no_kunjungan, cari berdasarkan bidang no_kunjungan
    try:
        response = (
            supabase.table("pendaftaran_pa")
            .select("*, master_pasien(*)")
            .eq("no_kunjungan", query)
            .limit(1)
            .execute()
        )
        if getattr(response, "data", None):
            rows = response.data or []
            if rows:
                return rows[0]
    except Exception as exc:
        print(f"[fetch_pendaftaran_with_pasien] Relationship select by no_kunjungan failed: {exc}")

    try:
        response = supabase.table("pendaftaran_pa").select("*").eq("no_kunjungan", query).limit(1).execute()
        rows = response.data or []
        if not rows:
            return None
        pendaftaran = rows[0]
        master_response = supabase.table("master_pasien").select("*").eq("no_rm", pendaftaran.get("no_rm")).limit(1).execute()
        pendaftaran["master_pasien"] = (master_response.data or [None])[0] if getattr(master_response, "data", None) else {}
        return pendaftaran
    except Exception as exc:
        print(f"[fetch_pendaftaran_with_pasien] Manual join by no_kunjungan failed: {exc}")
        return None


@app.route("/api/pasien/<no_rm>", methods=["GET"])
def get_master_pasien(no_rm):
    """
    Mengambil data administrasi pasien secara otomatis dari master_pasien.
    Mendukung input angka pendek (misal: '1' atau '01').
    """
    if not supabase:
        return jsonify({"error": "Supabase service is not configured."}), 500

    try:
        query_rm = normalize_rm(no_rm)

        res = supabase.table("master_pasien").select("*").eq("no_rm", query_rm).execute()
        if res.data and len(res.data) > 0:
            return jsonify({"success": True, "data": res.data[0]}), 200

        return jsonify({"success": False, "message": "Data pasien tidak ditemukan pada SIMRS."}), 404
    except Exception as e:
        print(f"Error fetching master_pasien: {e}")
        traceback.print_exc()
        return jsonify({"error": f"Gagal mengambil data pasien: {str(e)}"}), 500


@app.route("/api/pasien/<no_rm>/riwayat", methods=["GET"])
def get_pasien_riwayat(no_rm):
    """
    Mengambil data pasien dari master_pasien dan semua hasil_patologi yang terkait
    lewat tabel pendaftaran_pa berdasarkan no_rm / no_kunjungan pasien.
    """
    if not supabase:
        return jsonify({"error": "Supabase service is not configured."}), 500

    try:
        query_rm = normalize_rm(no_rm)
        patient_response = supabase.table("master_pasien").select("*").eq("no_rm", query_rm).limit(1).execute()
        patient_data = list(patient_response.data or [])

        if not patient_data:
            return jsonify({"success": False, "message": "Data pasien tidak ditemukan pada SIMRS."}), 404

        pendaftaran_response = (
            supabase.table("pendaftaran_pa")
            .select("id")
            .eq("no_rm", query_rm)
            .order("created_at", desc=True)
            .execute()
        )
        pendaftaran_rows = list(pendaftaran_response.data or [])

        if not pendaftaran_rows:
            pendaftaran_fallback = (
                supabase.table("pendaftaran_pa")
                .select("id")
                .eq("no_kunjungan", query_rm)
                .order("created_at", desc=True)
                .execute()
            )
            pendaftaran_rows = list(pendaftaran_fallback.data or [])

        pendaftaran_ids = [row.get("id") for row in pendaftaran_rows if row.get("id")]

        riwayat_data = []
        if pendaftaran_ids:
            riwayat_response = (
                supabase.table("hasil_patologi")
                .select("*, pendaftaran_pa(*, master_pasien(*))")
                .in_("pendaftaran_id", pendaftaran_ids)
                .order("created_at", desc=True)
                .execute()
            )
            riwayat_data = list(riwayat_response.data or [])

        return jsonify({
            "success": True,
            "pasien": patient_data[0],
            "riwayat": riwayat_data,
        }), 200
    except Exception as e:
        print(f"Error fetching pasien riwayat: {e}")
        traceback.print_exc()
        return jsonify({"error": f"Gagal mengambil riwayat pasien: {str(e)}"}), 500


@app.route("/api/pendaftaran/<no_rm>", methods=["GET"])
def get_pendaftaran_by_no_rm(no_rm):
    if not supabase:
        return jsonify({"error": "Supabase service is not configured."}), 500

    try:
        record = fetch_pendaftaran_with_pasien(no_rm)
        if not record:
            return jsonify({"success": False, "message": "Data pendaftaran tidak ditemukan."}), 404

        pasien = record.get("master_pasien") or {}
        combined = {
            "pendaftaran_id": record.get("id"),
            "no_kunjungan": record.get("no_kunjungan"),
            "no_rm": record.get("no_rm"),
            "nomor_pa": record.get("nomor_pa") or "",
            "nama_pasien": pasien.get("nama_pasien", ""),
            "jenis_kelamin": pasien.get("jenis_kelamin", ""),
            "tgl_lahir": pasien.get("tgl_lahir", ""),
            "umur": pasien.get("umur", ""),
            "alamat": pasien.get("alamat", ""),
            "dokter_perujuk": pasien.get("dokter_perujuk", "") or record.get("dokter_perujuk", ""),
            "unit_pengantar": record.get("unit_pengantar", "") or pasien.get("unit_pengantar", ""),
            "cairan_fiksasi": record.get("cairan_fiksasi", ""),
            "diagnosa_klinik": record.get("diagnosa_klinik", ""),
            "keterangan_klinik": record.get("keterangan_klinik", ""),
            "jaringan": record.get("jaringan", ""),
            "lokasi": record.get("lokasi", ""),
            "asisten": record.get("asisten", ""),
            "didapat_dengan": record.get("didapat_dengan", ""),
            "pa_sebelumnya": record.get("pa_sebelumnya", ""),
        }
        return jsonify({"success": True, "data": combined}), 200
    except Exception as exc:
        print(f"[get_pendaftaran_by_no_kunjungan] Error: {exc}")
        traceback.print_exc()
        return jsonify({"error": f"Gagal mengambil data pendaftaran: {str(exc)}"}), 500


@app.route('/api/collections', methods=['GET'])
def api_collections():
    """Return joined hasil_patologi + pendaftaran_pa + master_pasien records.

    Optional query params:
    - user_id: filter by hasil_patologi.user_id
    - limit: integer limit
    """
    if not supabase:
        return jsonify({"error": "Supabase service is not configured."}), 500

    try:
        user_id = request.args.get('user_id') or None
        limit = request.args.get('limit')
        print(f"[api_collections] request args: user_id={user_id} limit={limit}")
        try:
            limit_val = int(limit) if limit else None
        except Exception:
            limit_val = None

        query = supabase.table('hasil_patologi').select('*')
        try:
            query = query.order('created_at', desc=True)
        except Exception:
            pass
        if limit_val:
            try:
                query = query.limit(limit_val)
            except Exception:
                pass

        if user_id:
            query = query.eq('user_id', user_id)

        resp = query.execute()
        # Log supabase error if any
        if getattr(resp, 'error', None):
            try:
                print(f"[api_collections] supabase.error: {resp.error.message}")
            except Exception:
                print(f"[api_collections] supabase.error: {resp.error}")
        records = list(resp.data or [])
        print(f"[api_collections] fetched {len(records)} hasil_patologi records")

        combined = []
        for r in records:
            pendaftaran = None
            pasien = None
            pid = r.get('pendaftaran_id')
            if pid:
                try:
                    presp = supabase.table('pendaftaran_pa').select('*').eq('id', pid).limit(1).execute()
                    pendaftaran = (presp.data or [None])[0] if getattr(presp, 'data', None) else None
                except Exception as e:
                    print(f"[api_collections] failed to fetch pendaftaran for {pid}: {e}")

            if pendaftaran:
                no_rm = pendaftaran.get('no_rm')
                if no_rm:
                    try:
                        mresp = supabase.table('master_pasien').select('*').eq('no_rm', no_rm).limit(1).execute()
                        pasien = (mresp.data or [None])[0] if getattr(mresp, 'data', None) else None
                    except Exception as e:
                        print(f"[api_collections] failed to fetch master_pasien for {no_rm}: {e}")

            item = dict(r)
            # merge selected pendaftaran fields
            if pendaftaran:
                item['no_kunjungan'] = pendaftaran.get('no_kunjungan')
                item['no_rm'] = pendaftaran.get('no_rm')
                item['nomor_pa'] = pendaftaran.get('nomor_pa') or item.get('nomor_pa')
                item['jaringan'] = pendaftaran.get('jaringan') or item.get('jaringan')
                item['lokasi'] = pendaftaran.get('lokasi') or item.get('lokasi')
                item['diagnosa_klinik'] = pendaftaran.get('diagnosa_klinik') or item.get('diagnosa_klinik')
                item['cairan_fiksasi'] = pendaftaran.get('cairan_fiksasi') or item.get('cairan_fiksasi')
                item['unit_pengantar'] = pendaftaran.get('unit_pengantar') or item.get('unit_pengantar')
                item['dokter_perujuk'] = pendaftaran.get('dokter_perujuk') or item.get('dokter_perujuk')

            if pasien:
                item['nama_pasien'] = pasien.get('nama_pasien')
                item['tgl_lahir'] = pasien.get('tgl_lahir')
                item['jenis_kelamin'] = pasien.get('jenis_kelamin')
                item['alamat'] = pasien.get('alamat')

            combined.append(item)

        return jsonify({"success": True, "data": combined}), 200
    except Exception as exc:
        print(f"[api_collections] Exception: {exc}")
        traceback.print_exc()
        return jsonify({"success": False, "message": str(exc)}), 500


@app.route('/api/admin/toggle-user-status/<user_id>', methods=['PATCH'])
def toggle_user_status_admin(user_id):
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
        print(f"[toggle_user_status_admin] Error verifying current user: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to verify current user."}), 500

    user_meta = current_user.get('user_metadata') or {}
    raw_meta = current_user.get('raw_user_meta_data') or {}
    current_role = (user_meta.get('role') or raw_meta.get('role') or '').lower()
    if current_role != 'superadmin':
        return jsonify({"error": "Only superadmin users may change account status."}), 403

    payload = request.get_json(silent=True) or {}
    target_is_active = payload.get('is_active')
    if target_is_active is None:
        target_is_active = True

    try:
        url = f"{SUPABASE_URL.rstrip('/')}/auth/v1/admin/users/{user_id}"
        headers = {
            "apiKey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        }

        get_request = Request(url, headers=headers, method='GET')
        with urlopen(get_request) as get_response:
            get_data = json.load(get_response)

        user_payload = {
            "user_metadata": {
                **(get_data.get('user_metadata') or {}),
                "is_active": bool(target_is_active),
            },
            "app_metadata": {
                **(get_data.get('app_metadata') or {}),
                "is_active": bool(target_is_active),
            },
        }
        if get_data.get('raw_user_meta_data'):
            user_payload["raw_user_meta_data"] = {
                **(get_data.get('raw_user_meta_data') or {}),
                "is_active": bool(target_is_active),
            }

        update_request = Request(url, data=json.dumps(user_payload).encode('utf-8'), headers=headers, method='PUT')
        with urlopen(update_request) as response:
            body = response.read().decode('utf-8')
            try:
                data = json.loads(body) if body else {}
            except Exception:
                data = {}

        deleted_user_email = get_data.get('email', '')
        try:
            actor_id = current_user.get('id')
            actor_email = current_user.get('email') or (user_meta.get('email') if user_meta else '')
            log_pengiriman_history(None, actor_id, actor_email, "toggle_user_status", deleted_user_email, "success")
        except Exception as e:
            print(f"[toggle_user_status_admin] Failed to log activity: {e}")

        return jsonify({
            "success": True,
            "user_id": user_id,
            "is_active": bool(target_is_active),
            "detail": data,
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
        print(f"[toggle_user_status_admin] Unexpected error: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"error": "Failed to change user status."}), 500

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

@app.route('/api/collections/legacy', methods=['POST'])
def create_collection_legacy():
    return jsonify({
        "success": False,
        "error": "Endpoint koleksi lama dialihkan. Gunakan /api/hasil-patologi untuk akses langsung ke tabel hasil_patologi.",
    }), 410


@app.route('/api/collections/legacy', methods=['GET'])
def list_collections_legacy():
    return jsonify({
        "success": False,
        "error": "Endpoint koleksi lama dialihkan. Gunakan /api/hasil-patologi untuk akses langsung ke tabel hasil_patologi.",
    }), 410


@app.route('/api/collections/legacy/<collection_id>', methods=['GET'])
def get_collection_detail_legacy(collection_id):
    return jsonify({
        "success": False,
        "error": "Endpoint koleksi lama dialihkan. Gunakan /api/hasil-patologi untuk akses langsung ke tabel hasil_patologi.",
    }), 410


@app.route('/api/collections/legacy/<collection_id>/status', methods=['PATCH'])
def update_collection_status_legacy(collection_id):
    return jsonify({
        "success": False,
        "error": "Endpoint koleksi lama dialihkan. Gunakan /api/hasil-patologi untuk akses langsung ke tabel hasil_patologi.",
    }), 410

# Ambil murni dari file .env tanpa hardcoded fallback
API_KEY_SECRET = os.getenv("API_KEY_SECRET")

# Pengaman: matikan server saat startup jika .env belum diisi
if not API_KEY_SECRET:
  raise RuntimeError("CRITICAL: API_KEY_SECRET belum diset di file .env!")

@app.route('/api/hasil-patologi', methods=['GET'])
def list_hasil_patologi():
    # 1. Tambahkan proteksi API Key di paling atas
    api_key = request.headers.get('X-API-KEY')
    if not api_key or api_key != API_KEY_SECRET:
        return jsonify({
            "success": False,
            "error": "Unauthorized access: Invalid or missing API key."
        }), 401

    # 2. Logika bawaan lu (tetap sama)
    limit = request.args.get("limit", "50")
    try:
        limit_value = max(1, min(int(limit), 200))
    except ValueError:
        limit_value = 50

    try:
        records = fetch_hasil_patologi_records(limit=limit_value)
    except Exception as exc:
        print(f"[hasil_patologi] Failed to fetch records: {exc}")
        return jsonify({"success": False, "error": str(exc)}), 500

    return jsonify({
        "success": True,
        "count": len(records),
        "records": records,
    })


@app.route('/api/hasil-patologi/me', methods=['GET'])
def list_my_hasil_patologi():
    """Return hasil_patologi rows for the authenticated user.
    All roles can access the full collection list so doctor visibility matches
    the other roles in the collections page.
    The client must send `Authorization: Bearer <access_token>` header.
    This endpoint uses the service-role client to bypass RLS and return
    rows safely after verifying the token.
    """
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({"success": False, "error": "Authorization header missing or invalid."}), 401

    access_token = auth_header.split(' ', 1)[1].strip()
    if not access_token:
        return jsonify({"success": False, "error": "Access token required."}), 401

    try:
        current_user = get_user_from_access_token(access_token)
    except HTTPError as e:
        try:
            body = e.read().decode('utf-8')
            error_payload = json.loads(body)
            message = error_payload.get('message') or body
        except Exception:
            message = str(e)
        return jsonify({"success": False, "error": message}), e.code
    except URLError as e:
        return jsonify({"success": False, "error": str(e)}), 502
    except Exception as e:
        print(f"[list_my_hasil_patologi] Failed to verify user from token: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": "Failed to verify user."}), 500

    user_id = current_user.get('id')
    if not user_id:
        return jsonify({"success": False, "error": "User id not found in token."}), 400

    user_meta = current_user.get('user_metadata') or {}
    raw_meta = current_user.get('raw_user_meta_data') or {}
    app_meta = current_user.get('app_metadata') or {}
    current_role = (user_meta.get('role') or raw_meta.get('role') or app_meta.get('role') or '').lower()

    if not supabase:
        return jsonify({"success": False, "error": "Supabase not configured."}), 500

    try:
        query = supabase.table('hasil_patologi').select('*, pendaftaran_pa(*, master_pasien(*))').order('created_at', desc=True).limit(200)
        response = query.execute()
        if getattr(response, 'error', None):
            print(f"[list_my_hasil_patologi] Supabase error: {response.error}")
        records = list(response.data or [])
        return jsonify({"success": True, "count": len(records), "records": records})
    except Exception as e:
        print(f"[list_my_hasil_patologi] Failed to fetch records: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/hasil-patologi/me/<record_id>', methods=['GET'])
def get_my_hasil_patologi_detail(record_id):
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({"success": False, "error": "Authorization header missing or invalid."}), 401

    access_token = auth_header.split(' ', 1)[1].strip()
    if not access_token:
        return jsonify({"success": False, "error": "Access token required."}), 401

    try:
        current_user = get_user_from_access_token(access_token)
    except HTTPError as e:
        try:
            body = e.read().decode('utf-8')
            error_payload = json.loads(body)
            message = error_payload.get('message') or body
        except Exception:
            message = str(e)
        return jsonify({"success": False, "error": message}), e.code
    except URLError as e:
        return jsonify({"success": False, "error": str(e)}), 502
    except Exception as e:
        print(f"[get_my_hasil_patologi_detail] Failed to verify user from token: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": "Failed to verify user."}), 500

    user_id = current_user.get('id')
    if not user_id:
        return jsonify({"success": False, "error": "User id not found in token."}), 400

    if not supabase:
        return jsonify({"success": False, "error": "Supabase not configured."}), 500

    user_meta = current_user.get('user_metadata') or {}
    raw_meta = current_user.get('raw_user_meta_data') or {}
    app_meta = current_user.get('app_metadata') or {}
    current_role = (user_meta.get('role') or raw_meta.get('role') or app_meta.get('role') or '').lower()

    try:
        query = supabase.table('hasil_patologi').select('*, pendaftaran_pa(*, master_pasien(*))').eq('id', record_id).limit(1)
        response = query.execute()
        if getattr(response, 'error', None):
            print(f"[get_my_hasil_patologi_detail] Supabase error: {response.error}")
        records = list(response.data or [])
        if not records:
            return jsonify({"success": False, "error": "Record not found."}), 404
        return jsonify({"success": True, "record": records[0]})
    except Exception as e:
        print(f"[get_my_hasil_patologi_detail] Failed to fetch record: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/hasil-patologi/<record_id>", methods=["GET"])
def get_hasil_patologi_detail(record_id):
  api_key = request.headers.get("X-API-KEY")
  if not api_key or api_key != API_KEY_SECRET:
    return (
        jsonify({
            "success": False,
            "error": (
                "Unauthorized access: Invalid or missing API key."
                " ditemukan."
            ),
        }),
        401,
    )

  try:
    record = fetch_hasil_patologi_record(record_id)
  except Exception as exc:
    print(f"[hasil_patologi] Failed to fetch record {record_id}: {exc}")
    return jsonify({"success": False, "error": str(exc)}), 500

  if not record:
    return jsonify({"success": False, "error": "Record tidak ditemukan."}), 404

  return jsonify({"success": True, "record": record})

@app.route('/api/hasil-patologi/<record_id>', methods=['DELETE'])
def delete_hasil_patologi(record_id):
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return jsonify({"success": False, "error": "Authorization header missing or invalid."}), 401

    access_token = auth_header.split(' ', 1)[1].strip()
    if not access_token:
        return jsonify({"success": False, "error": "Access token required."}), 401

    try:
        current_user = get_user_from_access_token(access_token)
    except HTTPError as e:
        try:
            body = e.read().decode('utf-8')
            error_payload = json.loads(body)
            message = error_payload.get('message') or body
        except Exception:
            message = str(e)
        return jsonify({"success": False, "error": message}), e.code
    except URLError as e:
        return jsonify({"success": False, "error": str(e)}), 502
    except Exception as e:
        print(f"[delete_hasil_patologi] Failed to verify user: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": "Failed to verify user."}), 500

    user_id = current_user.get('id')
    if not user_id:
        return jsonify({"success": False, "error": "User id not found in token."}), 400

    try:
        if not supabase:
            return jsonify({"success": False, "error": "Supabase service is not configured."}), 500

        record_response = supabase.table("hasil_patologi").select("id, user_id").eq("id", record_id).limit(1).execute()
        rows = list(record_response.data or [])
        if not rows:
            return jsonify({"success": False, "error": "Record not found."}), 404

        record = rows[0]
        user_meta = current_user.get('user_metadata') or {}
        raw_meta = current_user.get('raw_user_meta_data') or {}
        app_meta = current_user.get('app_metadata') or {}
        current_role = (user_meta.get('role') or raw_meta.get('role') or app_meta.get('role') or '').lower()

        if current_role == 'dokter' and str(record.get('user_id') or '') != str(user_id):
            return jsonify({"success": False, "error": "Anda hanya dapat menghapus data milik akun Anda sendiri."}), 403

        if current_role not in {'dokter', 'petugas', 'superadmin'}:
            return jsonify({"success": False, "error": "Role tidak diizinkan untuk menghapus collection."}), 403

        try:
            history_response = supabase.table("history_pengiriman").select("id, hasil_patologi_id").execute()
            history_rows = history_response.data or []
            for row in history_rows:
                if row.get("hasil_patologi_id") == record_id:
                    supabase.table("history_pengiriman").delete().eq("id", row.get("id")).execute()
        except Exception as history_exc:
            print(f"[hasil_patologi] History cleanup skipped: {history_exc}")

        delete_response = supabase.table("hasil_patologi").delete().eq("id", record_id).execute()
        if getattr(delete_response, "error", None):
            return jsonify({"success": False, "error": delete_response.error.message}), 400

        return jsonify({"success": True, "deleted": True}), 200
    except Exception as exc:
        print(f"[hasil_patologi] Failed to delete record {record_id}: {exc}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(exc)}), 500


@app.route('/process-report', methods=['POST'])
def process_report():
    data = request.json or {}
    raw_text = data.get('text') or ''
    user_id = data.get('user_id')
    no_kunjungan = str(data.get('no_kunjungan') or '').strip()

    # Prefer server-side verified user_id from Authorization bearer token when available.
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        access_token = auth_header.split(' ', 1)[1].strip()
        try:
            verified_user = get_user_from_access_token(access_token)
            if verified_user and isinstance(verified_user, dict):
                verified_id = verified_user.get('id')
                if verified_id:
                    if user_id and str(user_id) != str(verified_id):
                        print(f"[process_report] Overriding provided user_id {user_id} with verified id {verified_id}")
                    user_id = verified_id
        except Exception as e:
            print(f"[process_report] Could not verify access token for process-report: {e}")

    if not no_kunjungan:
        return jsonify({"status": "error", "message": "no_kunjungan is required."}), 400

    pendaftaran = fetch_pendaftaran_with_pasien(no_kunjungan)
    if not pendaftaran:
        return jsonify({
            "status": "error",
            "message": f"Nomor Kunjungan '{no_kunjungan}' tidak ditemukan di pendaftaran_pa."
        }), 400

    pendaftaran_id = pendaftaran.get('id')
    if not pendaftaran_id:
        return jsonify({"status": "error", "message": "pendaftaran_id tidak tersedia untuk pendaftaran tersebut."}), 500

    # 1. Panggil AI untuk Ekstraksi Medis
    ai_response = call_ai_api(build_prompt(raw_text))
    structured_data = extract_json(ai_response)
    computed_medical_fields = extract_medical_fields_from_text(raw_text)
    is_ihc_case = _looks_like_ihc_case(raw_text, data.get("jenis_pemeriksaan"))

    if is_ihc_case:
        inferred_microscopic = _infer_microscopic_description(raw_text)
        if inferred_microscopic and not (structured_data.get("MIKROSKOPIK") or structured_data.get("mikroskopik")):
            structured_data["MIKROSKOPIK"] = inferred_microscopic
            structured_data["mikroskopik"] = inferred_microscopic
        if computed_medical_fields.get("imuno_histokimia") and not (structured_data.get("IMUNO_HISTOKIMIA") or structured_data.get("imuno_histokimia")):
            structured_data["IMUNO_HISTOKIMIA"] = computed_medical_fields["imuno_histokimia"]
            structured_data["imuno_histokimia"] = computed_medical_fields["imuno_histokimia"]

    # 2. Siapkan Payload Lengkap sesuai Tabel SQL
    # Kita bagi jadi beberapa bagian agar rapi

    requested_nomor_pa = str(data.get("nomor_pa") or pendaftaran.get("nomor_pa") or "").strip()
    if not requested_nomor_pa or requested_nomor_pa == "000000":
        requested_nomor_pa = generate_nomor_pa()

    ihc_request_value = str(data.get("permintaan_ihc") or "").strip() or ("IHC" if is_ihc_case else "")

    def _coerce_int(value: object, default: int = 0) -> int:
        if value is None:
            return default
        if isinstance(value, bool):
            return int(value)
        if isinstance(value, (int, float)):
            return int(value)
        text = str(value).strip()
        if not text:
            return default
        try:
            return int(float(text))
        except ValueError:
            return default

    final_payload = {
        "pendaftaran_id": pendaftaran_id,
        "user_id": user_id,
        "makroskopik": structured_data.get("MAKROSKOPIK", "") or structured_data.get("makroskopik", ""),
        "mikroskopik": structured_data.get("MIKROSKOPIK", "") or structured_data.get("mikroskopik", ""),
        "kesimpulan": structured_data.get("KESIMPULAN", "") or structured_data.get("kesimpulan", ""),
        "bukan_tumor": _coerce_int(computed_medical_fields.get("bukan_tumor", 1), default=1),
        "perilaku_tumor": _coerce_int(computed_medical_fields.get("perilaku_tumor") if computed_medical_fields.get("perilaku_tumor") is not None else (structured_data.get("PERILAKU_TUMOR", 0) or structured_data.get("perilaku_tumor", 0)), default=0),
        "grade": _coerce_int(computed_medical_fields.get("grade") if computed_medical_fields.get("grade") is not None else (structured_data.get("GRADE", 0) or structured_data.get("grade", 0)), default=0),
        "imuno_histokimia": computed_medical_fields.get("imuno_histokimia", "") or structured_data.get("IMUNO_HISTOKIMIA", "") or structured_data.get("imuno_histokimia", ""),
        "topography": structured_data.get("TOPOGRAPHY", "") or structured_data.get("topography", ""),
        "morphology": structured_data.get("MORPHOLOGY", "") or structured_data.get("morphology", ""),
        "status": 1,
        "status_pengiriman": "draft",
    }

    try:
        response = supabase.table("hasil_patologi").insert(final_payload).execute()
        if getattr(response, "error", None):
            return jsonify({"status": "error", "message": str(response.error)}), 500

        if pendaftaran_id:
            pendaftaran_update_payload = {"permintaan_ihc": ihc_request_value}
            try:
                update_response = supabase.table("pendaftaran_pa").update(pendaftaran_update_payload).eq("id", pendaftaran_id).execute()
                if getattr(update_response, "error", None):
                    print(f"[process_report] Non-blocking pendaftaran_pa update warning: {update_response.error}")
            except Exception as update_exc:
                print(f"[process_report] Non-blocking pendaftaran_pa update warning: {update_exc}")

        return jsonify({"status": "success", "data": response.data}), 201
    except Exception as e:
        print(f"[process_report] Failed to validate/insert: {e}")
        traceback.print_exc()
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
            return jsonify({"status": "error", "message": "Invalid email format"}), 400
        
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
            return jsonify({"status": "error", "message": f"Email test failed: {message}"}), 400
            
    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"[/api/test-email] EXCEPTION: {error_msg}")
        return jsonify({"status": "error", "message": error_msg}), 500


@app.route("/api/log-activity", methods=["POST"])
def api_log_activity():
    """Compatibility endpoint for activity logging. It no longer writes to history_pengiriman."""
    try:
        if not supabase:
            return jsonify({"status": "error", "message": "Supabase not configured"}), 500

        return jsonify({"status": "success", "message": "activity logging disabled"}), 200
    except Exception as e:
        print(f"[/api/log-activity] EXCEPTION: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


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
