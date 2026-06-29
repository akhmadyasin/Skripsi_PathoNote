API for Rumah Sakit — PathoNote

Purpose
- This document explains how an external hospital (RS) can pull collections from your custom API and update status.

Base URL
- Use your deployed backend origin, e.g. `http://your-backend:5001`.
- If you expose via frontend proxy, RS can call `http://your-frontend:3000/api/...`.

Endpoints

1) POST /api/collections
- Description: Submit a collection to your API (already implemented).
- Body (JSON):
```
{
  "collection_id": "<id>",
  "report_id": "<id>",
  "source": "rs|detail_page|...",
  "record": { ...hasil_patologi object... },
  "petugas_id": "<uuid>" ,            // optional, if available
  "nama_petugas": "Nama Petugas",    // optional
  "metode_pengiriman": "api",
  "tujuan_pengiriman": "API RS"
}
```
- Response: 201 on success with `collection` object.
- Notes: Backend writes a `history_pengiriman` entry automatically.

2) GET /api/collections
- Description: List collections (useful for RS to "pull" new items).
- Query params:
  - `status` (optional) — filter by status, e.g. `?status=pending`
  - `limit` (optional) — default 50
- Response: `{ success: true, count: N, collections: [ ... ] }`

3) GET /api/collections/{id}
- Description: Get detail for a specific collection.
- Response: `{ success: true, collection: { ... } }`

4) PATCH /api/collections/{id}/status
- Description: Update collection status after RS processes it.
- Body example:
```
{ "status": "terkirim", "message": "Diproses RS X" }
```
- Response: `{ success: true, collection: { ... } }`

Auth & Security
- Recommended: server-to-server API key (Bearer token) or JWT. RS should call from their backend, never embed service-role keys in browser JS.
- If RS needs direct DB access to Supabase, do this via their backend using an appropriate server key; do not share service-role secrets with browsers.
- CORS: ensure backend allows RS origin or use server-to-server requests to avoid CORS issues.

Client examples

- Fetch pending collections (JS):
```js
const API_BASE = 'https://your-backend:5001';
const res = await fetch(`${API_BASE}/api/collections?status=pending`, {
  headers: { Authorization: 'Bearer <API_KEY>' }
});
const body = await res.json();
console.log(body.collections);
```

- Mark an item processed (JS):
```js
await fetch(`${API_BASE}/api/collections/${id}/status`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer <API_KEY>' },
  body: JSON.stringify({ status: 'terkirim', message: 'Processed by RS' })
});
```

- cURL example (list):
```bash
curl -H "Authorization: Bearer <API_KEY>" "https://your-backend:5001/api/collections?status=pending"
```

History visibility & troubleshooting
- The backend logs entries to the `history_pengiriman` table automatically on POST and on PATCH status updates.
- If RS doesn’t see history rows:
  - Ensure the POST included `petugas_id` (UUID) or backend fallback inserted the entry without FK fields.
  - Check Supabase RLS policies — entries might exist but be hidden by RLS for the current user. Verify with an admin/service-role query.
  - Check backend logs (stdout) for `log_pengiriman_history` debug prints.

Recommended RS UI workflow
1. Button "Ambil collection" -> call `GET /api/collections?status=pending`.
2. Show list; per-item actions: "Lihat" (GET id), "Ambil" (PATCH -> `in_progress`).
3. After processing, "Selesai" -> PATCH -> `terkirim` (or `failed`).

Next steps I can help with
- Add example RS frontend component (React) that calls these endpoints.
- Add authentication instructions and example server token handling.
- Review Supabase RLS policies if history rows are still not visible.

If you want, I can commit this file into the repo now (I will), or modify it with your preferred wording.