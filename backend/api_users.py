from flask import jsonify
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json


def register_admin_routes(app, supabase, SUPABASE_URL, SUPABASE_SERVICE_KEY):
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
        except Exception as e:
            return jsonify({"error": str(e)}), 401

        user_meta = current_user.get('user_metadata') or {}
        raw_meta = current_user.get('raw_user_meta_data') or {}
        current_role = (user_meta.get('role') or raw_meta.get('role') or '').lower()
        if current_role != 'superadmin':
            return jsonify({"error": "Only superadmin users may view user lists."}), 403

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

            users = []
            for item in data or []:
                meta = item.get('user_metadata') or {}
                raw_meta_item = item.get('raw_user_meta_data') or {}
                merged = {**raw_meta_item, **meta}
                users.append({
                    "id": item.get('id'),
                    "email": item.get('email'),
                    "username": merged.get('username') or '',
                    "display_name": merged.get('display_name') or '',
                    "role": (merged.get('role') or '').lower() or 'dokter',
                    "created_at": item.get('created_at'),
                    "last_sign_in_at": item.get('last_sign_in_at'),
                    "email_confirmed_at": item.get('email_confirmed_at'),
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
            return jsonify({"error": "Failed to list users."}), 500
