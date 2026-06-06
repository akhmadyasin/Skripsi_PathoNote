# Setup Signature Upload Feature

## Overview
Fitur ini memungkinkan setiap user meng-upload signature mereka yang akan disimpan di Supabase dan otomatis muncul di PDF yang di-export.

## Database Structure
Signature URL disimpan di **`auth.users.raw_user_meta_data`** dengan key `signature_url`:
```json
{
  "display_name": "Nama User",
  "username": "username",
  "signature_url": "https://ettonqjmtkdcetyvrwaw.supabase.co/storage/v1/object/public/signatures/user-id/signature-file.png"
}
```

## Supabase Storage Setup

### 1. Buat Storage Bucket
Di Supabase Dashboard:
1. Buka **Storage** tab
2. Klik **Create a new bucket**
3. Nama: `signatures`
4. Privacy: **Public** (agar image bisa di-load dari PDF)
5. Klik **Create bucket**

> Jika Anda ingin menggunakan nama bucket lain, set `NEXT_PUBLIC_SUPABASE_SIGNATURE_BUCKET` di file `.env` atau `.env.local`.

### 2. Atur Permission (RLS Policy)
Di Storage policies untuk bucket `signatures`:

**Public Read Permission (untuk semua orang bisa baca file):**
```sql
-- Allow public read
CREATE POLICY "Public read" ON storage.objects
FOR SELECT
USING (bucket_id = 'signatures');
```

**User Upload/Update Permission (user hanya bisa upload ke folder mereka):**
```sql
-- Allow authenticated users to upload/update their own signature
CREATE POLICY "User can upload own signature" ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'signatures' AND
  auth.uid()::text = (string_to_array(name, '/'))[1]
);

CREATE POLICY "User can update own signature" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'signatures' AND
  auth.uid()::text = (string_to_array(name, '/'))[1]
)
WITH CHECK (
  bucket_id = 'signatures' AND
  auth.uid()::text = (string_to_array(name, '/'))[1]
);
```

## Frontend Implementation

### Settings Page
User bisa upload signature di:
- **Settings → Tanda Tangan (Signature)**
- Pilih file image (PNG, JPG, etc.)
- Klik "Simpan Signature"
- Signature langsung tersimpan ke user metadata

### PDF Export
Saat export PDF:
1. Sistem cek apakah user punya `signature_url` di metadata
2. Jika ada → gambar ditampilkan di section tanda tangan
3. Jika tidak ada → garis kosong ditampilkan

## Testing

### Test Upload:
```bash
# 1. Login ke aplikasi
# 2. Buka Settings page
# 3. Cari section "Tanda Tangan"
# 4. Upload signature image
# 5. Klik "Simpan Signature"
```

### Test PDF:
```bash
# 1. Buka detail dokumen
# 2. Klik "Export PDF"
# 3. Check apakah signature muncul di PDF
```

## Troubleshooting

### Error: "File harus berupa gambar"
- Pastikan file adalah image (PNG, JPG, GIF, etc.)

### Error: "Ukuran file maksimal 5MB"
- Kompres/kurangi size image signature

### Signature tidak muncul di PDF
- Cek apakah `signature_url` sudah ada di user metadata
- Cek browser console untuk error detail
- Pastikan image URL bisa diakses (public)

### CORS Error
- Pastikan Supabase Storage bucket sudah set ke "Public"
- Pastikan image URL tidak ada query parameter yang aneh

## File Structure
```
frontend/src/app/
├── settings/
│   └── page.tsx          (← Upload signature form)
└── detail/
    └── [id]/
        └── page.tsx      (← Use signature di PDF)
```

## Related Components
- `uploadSignature()` - Upload ke Supabase Storage + update user metadata
- `handleSignatureFileChange()` - Validasi & preview image
- `handleExportPdf()` - Embed signature image ke PDF

## Security Notes
✅ User hanya bisa upload ke folder mereka sendiri  
✅ Signature image di-store di public folder (safe karena bukan data sensitif)  
✅ User metadata hanya bisa diupdate oleh user sendiri
