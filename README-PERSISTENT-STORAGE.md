# SIPUS — Persistent Storage

Semua JSON dan media upload disimpan di luar folder aplikasi.

Default: `%USERPROFILE%\SIPUS-SMK-Ibu-Kartini-data` pada Windows atau `~/SIPUS-SMK-Ibu-Kartini-data` pada Linux/macOS.

Subfolder:
- `data/` — books, copies, members, loans, categories, users, audit, dan konfigurasi.
- `uploads/covers/` — salinan file cover buku.
- `uploads/members/` — salinan foto anggota.

Cover buku dan foto anggota juga ditanam sebagai Base64 + MIME type ke masing-masing JSON sehingga file media dapat dipulihkan setelah source project diganti.

Jangan menghapus folder storage saat memperbarui ZIP.
