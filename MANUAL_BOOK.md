# Manual Sederhana PathoNote

## Peran dan Alur Pengguna
Manual ini hanya menjelaskan apa yang bisa dilakukan oleh tiga jenis pengguna di aplikasi.

### 1. Dokter

#### Akses utama
- Masuk lewat halaman `Login`.
- Melihat `Dashboard` setelah login.
- Menggunakan `Voice Panel` untuk transkripsi suara dan ringkasan otomatis.
- Membuka dan melihat `Collections` hasil patologi.
- Melihat `History` untuk status pengiriman dan preview laporan.
- Mengubah pengaturan pribadi di `Settings`.

#### Alur kerja
1. Login sebagai dokter.
2. Buka `Dashboard` untuk mulai.
3. Pergi ke menu `Voice` dan mulai rekam suara.
4. Bicarakan laporan patologi dalam bahasa Indonesia.
5. Lihat ringkasan yang muncul secara otomatis.
6. Akses `Collections` untuk melihat data hasil patologi.
7. Buka `History` untuk melihat status pengiriman dan detail preview.

#### Fitur khusus dokter
- Voice Panel aktif.
- Dapat melihat detail dan preview data patologi.
- Bisa mengelola profil dan preferensi di `Settings`.

### 2. Petugas

#### Akses utama
- Masuk lewat halaman `Login`.
- Melihat `Dashboard` dengan akses terbatas.
- Mengakses `Collections` untuk melihat daftar hasil patologi.
- Mengakses `History` untuk melihat riwayat pengiriman.
- Menyimpan pengaturan dasar di `Settings`.

#### Alur kerja
1. Login sebagai petugas.
2. Buka `Collections` untuk daftar hasil patologi.
3. Gunakan `History` untuk melihat status pengiriman.
4. Jika perlu, buka preview laporan melalui riwayat.
5. Sesuaikan pengaturan dasar di `Settings`.

#### Fitur khusus petugas
- Voice Panel tidak aktif.
- Fokus pada melihat data dan riwayat pengiriman.
- Dapat menggunakan pencarian dan filter di halaman `History`.

### 3. Superadmin

#### Akses utama
- Login lewat halaman `Login`.
- Akses `Register` untuk membuat pengguna baru.
- Dapat membuat akun `dokter` atau `petugas`.
- Melihat halaman utama aplikasi seperti user lain.

#### Alur kerja
1. Login sebagai superadmin.
2. Buka halaman `Register`.
3. Isi data pengguna baru: nama, email, peran, dan password.
4. Buat akun baru untuk dokter atau petugas.
5. Setelah membuat akun, pengguna baru bisa login dengan kredensial tersebut.

#### Fitur khusus superadmin
- Halaman pendaftaran pengguna hanya tersedia untuk superadmin.
- Hanya superadmin yang dapat menambah akun baru.

## Halaman Utama yang Digunakan
- `Login` — semua pengguna masuk ke aplikasi.
- `Dashboard` — ringkasan dan akses awal.
- `Voice` — hanya dokter untuk transkripsi dan ringkasan suara.
- `Collections` — melihat data hasil patologi.
- `History` — melihat riwayat pengiriman dan status.
- `Settings` — mengatur preferensi pengguna.
- `Register` — hanya superadmin untuk membuat akun.

## Catatan Penting
- Voice Panel bekerja hanya untuk peran `dokter`.
- `Register` tidak untuk pendaftaran umum; hanya superadmin.
- Petugas dapat melihat data, tetapi tidak memiliki akses rekam suara.
- Semua pengguna harus login dulu untuk menggunakan fitur aplikasi.
