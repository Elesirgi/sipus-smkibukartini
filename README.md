# SIPUS — Sistem Informasi Perpustakaan SMK Ibu Kartini

Versi ini menyatukan perbaikan fungsi, hak akses, sirkulasi, inventaris, upload media, storage persisten, dan UI.

## Hak akses
- **Admin** adalah satu-satunya akun bawaan. Data `users.json` pada paket awal hanya berisi akun `admin`.
- **Anggota tidak memiliki akun login** dan tidak dapat mendaftar sendiri. Admin hanya menambahkan data anggota.
- Admin dapat membuat akun **Petugas** dari Panel Admin; form tersebut tidak dapat membuat akun Admin kedua.
- Login Admin tersedia di `/admin/login` dan setelah login Admin hanya melihat area Admin.
- Pengunjung/non-admin hanya dapat mengakses halaman publik: Beranda, Katalog Buku, Kategori, Anggota, Peminjaman, dan Cari Buku.
- Non-admin tidak dapat membuat peminjaman, mengembalikan buku, atau memperpanjang peminjaman. Semua aksi sirkulasi dibatasi server-side untuk Admin.

## Beranda dan katalog
- `/` adalah beranda katalog-first: katalog buku tampil langsung tanpa blok "Masuk ke SIPUS" atau "Masuk Anggota".
- `/dashboard` diarahkan kembali ke `/` agar tidak ada dua halaman Beranda yang berbeda.
- Katalog dan detail buku memakai endpoint cover server, bukan pemuatan cover yang bergantung pada cache browser.

## Buku dan eksemplar
- Paket awal memiliki **22 judul** dan **50 eksemplar per judul** (**1.100 eksemplar**).
- Admin dapat mengubah jumlah eksemplar per judul. Eksemplar yang sedang dipinjam, hilang, atau rusak berat tidak dihapus paksa.
- Tampilan stok mengikuti format **Total / Dipinjam**, misalnya `50 / 1`, dengan jumlah tersedia ditampilkan terpisah.
- ID buku dicocokkan secara tahan terhadap spasi/huruf besar-kecil dan route Edit/Eksemplar menggunakan ID yang di-encode.

## Sirkulasi
- Admin dapat membuat peminjaman dengan **lebih dari satu eksemplar** dan **lebih dari satu judul** dalam satu proses.
- Batas buku aktif tetap **3** per anggota dan dihitung dari seluruh eksemplar aktif, bukan satu per jenis.
- Admin dapat mengembalikan buku dan memperpanjang peminjaman dari halaman Sirkulasi.
- Halaman **Peminjaman Terlambat** dipisahkan dari **Laporan**.
- Denda dihitung otomatis Rp1.000/hari berdasarkan keterlambatan.

## Anggota
- Admin menambahkan data anggota dan **wajib mengunggah foto**.
- Form tambah anggota tidak meminta username/password dan tidak membuat akun login.
- Foto anggota disimpan sebagai file di storage persisten dan sebagai Base64 + MIME type di `members.json`.

## Cover buku dan upload media
- Admin mengunggah cover dari file JPG/PNG/WEBP (maks. 3 MB). Tidak ada field URL cover pada form.
- Cover yang diunggah disimpan sebagai file di storage persisten dan disalin ke `books.json` sebagai Base64 + MIME type (`coverData`, `coverMime`, `coverUpdatedAt`).
- Endpoint `/book-cover/:id` membaca cover terbaru dari data buku dengan header no-cache. Bila data buku lama masih menyimpan URL cover internet dan belum memiliki data upload, endpoint masih menyediakan fallback redirect untuk kompatibilitas.
- Foto anggota menggunakan pola persistensi yang sama melalui `/member-photo/:id`.

## Storage persisten
Data berada **di luar folder aplikasi** sehingga mengganti ZIP/source code tidak menghapus koleksi atau media.

Lokasi default:
- Windows: `%USERPROFILE%\SIPUS-SMK-Ibu-Kartini-data`
- Linux/macOS: `~/SIPUS-SMK-Ibu-Kartini-data`

Bisa dipindahkan dengan environment variable `SIPUS_DATA_DIR`. Contoh PowerShell:
```powershell
$env:SIPUS_DATA_DIR="D:\SIPUS_DATA"
npm start
```

Saat startup, aplikasi otomatis:
- memastikan storage tersedia;
- memigrasikan data/upload lama yang belum ada di storage persisten;
- mempertahankan data anggota, buku, transaksi, dan media yang sudah tersimpan;
- menormalkan akun menjadi satu Admin bawaan dan akun Petugas yang memang sudah dibuat;
- menghapus session lama saat upgrade versi;
- menormalkan `copies.json` terhadap daftar buku;
- memulihkan file media dari data Base64 bila file fisiknya belum ada.

**Jangan menghapus folder storage persisten** saat mengganti versi aplikasi.

## Backup dan restore
Backup JSON mencakup data buku, termasuk `coverData`, serta data anggota, termasuk `photoData`. Restore otomatis memulihkan file media ke storage persisten. Session browser tidak dimasukkan ke backup.

## Menjalankan
```bash
npm install
npm start
```

Buka `http://localhost:3000/`.
Login Admin melalui `http://localhost:3000/admin/login`.

## Catatan pengembangan
`multer` sudah tercantum di `package.json` karena upload cover/foto menggunakan `memoryStorage`.

Pengujian yang tersedia pada source ini mencakup validasi syntax seluruh JavaScript server/client dan pengujian data-layer di storage sementara. Uji browser end-to-end tetap perlu dilakukan setelah `npm install` berhasil di komputer tempat aplikasi dijalankan.

## Perbaikan halaman buku
- Tautan buku dari beranda/katalog kini memakai slug dengan fallback ke ID buku.
- Resolver detail menerima slug tersimpan, slug dari judul, atau ID buku agar tautan dari data lama tetap berfungsi.
- Slug buku yang kosong/duplikat diperbaiki otomatis saat server mulai.
- Judul buku pada tabel Admin membuka formulir edit Admin langsung, bukan route katalog publik yang dialihkan untuk akun Admin.
- Halaman 404 sekarang menampilkan judul/pesan yang sesuai agar error akses ditolak tidak terlihat seperti rute hilang.
