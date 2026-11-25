# Mini App Jasa Sebar — Deploy ke Cloudflare Pages

Paket ini **terpisah dari file utama bot**. Isinya hanya website Mini App:

```
public/                  halaman (index.html, app.js, app.css) + _headers + _routes.json
functions/api/app/       Pages Function = proxy ke API bot
DEPLOY.md                panduan ini
```

Isi Mini App (gaya neo-brutalism, ukuran besar untuk HP, otomatis mengikuti tema gelap/terang Telegram):
**Beranda**, **BC** (status, teks, sewa), **Saldo** (deposit QRIS + riwayat), **Ubot** (status & stop), **Menu** (semua fitur bot), dan **Panel Admin** untuk owner
(akun stok, unggah grup txt, sewa aktif, saldo & blokir pengguna, pengaturan, daftar perintah). Fitur yang butuh percakapan (login ubot, beli role/produk, panel reseller,
panel owner lama) dibuka di chat bot lewat menu Mini App — aplikasi menutup otomatis dan menunya muncul di chat.

Alurnya: Telegram membuka `https://<situs>.pages.dev` → halaman memanggil `/api/app/...` di situs yang sama →
Pages Function meneruskan ke API di bot Anda (`BOT_API_ORIGIN`). Login memakai akun Telegram pengguna (initData), diverifikasi oleh bot. Hak owner/reseller juga dicek di bot, bukan di halaman.

## 1. Siapkan alamat HTTPS untuk API bot

Bot sudah melayani API di port webhook-nya (mis. `3006`, path `/api/app/...`). Cloudflare harus bisa menjangkaunya lewat **hostname**, contoh `https://api.domainanda.com`.
Pilih salah satu:

- **Cloudflare Tunnel (disarankan)**: jalankan `cloudflared` di mesin yang sama dengan bot, arahkan hostname `api.domainanda.com` → `http://localhost:3006`.
- **Reverse proxy** (nginx/Caddy) dengan domain dan sertifikat TLS ke port bot.
- **Langsung `http://IP:PORT`**: belum tentu bisa. Cloudflare Workers kadang menolak alamat IP mentah / port non-standar. Coba, lalu cek langkah 5; kalau gagal pakai dua cara di atas.

## 2. Konfigurasi bot (`config.json` > `sewa`)

```json
"webapp_url": "https://jasa-sebar.pages.dev",
"webapp_proxy_secret": "ISI-TEKS-ACAK-PANJANG"
```

- `webapp_url` = alamat situs Pages (HTTPS, tanpa `/app`). Setelah bot restart, tombol **📱 Buka Mini App** muncul di menu Sewa BC dan tombol menu bot ikut diatur.
- `webapp_proxy_secret` membuat API bot **hanya** menerima permintaan dari proxy ini (bukan dari sembarang orang). Nilainya harus sama dengan `PROXY_SECRET` di langkah 4.

## 3. Deploy ke Cloudflare Pages

**Cara A — upload langsung (paling cepat):** di folder paket ini jalankan

```
npx wrangler login
npx wrangler pages deploy public --project-name jasa-sebar
```

**Cara B — Git:** push folder ini ke repo, lalu di Cloudflare Dashboard → *Workers & Pages* → *Create* → *Pages* → *Connect to Git*:
Build command **kosong**, Build output directory **`public`**, Root directory = folder paket ini.

Folder `functions/` otomatis menjadi Pages Function (tidak perlu pengaturan tambahan).

## 4. Environment variables

Cloudflare Dashboard → project Pages → *Settings* → *Variables and Secrets* (Production):

| Nama | Tipe | Isi |
|---|---|---|
| `BOT_API_ORIGIN` | Plaintext | `https://api.domainanda.com` (tanpa `/` di akhir) |
| `PROXY_SECRET` | **Secret** | sama persis dengan `webapp_proxy_secret` di bot |

Atau lewat CLI: `npx wrangler pages secret put BOT_API_ORIGIN --project-name jasa-sebar` (lalu `PROXY_SECRET`).
**Deploy ulang** setelah mengubah variabel agar berlaku.

## 5. Tes

1. Buka `https://<situs>.pages.dev/api/app/health` → harus `{"ok":true,"bot":200}`.
   - `BOT_API_ORIGIN belum diatur` → langkah 4. `Bot tidak bisa dihubungi` → alamat/tunnel di langkah 1 salah atau bot mati.
2. Di Telegram, buka bot → *Sewa BC* → **📱 Buka Mini App**. Kalau dibuka lewat browser biasa, halaman memang menolak ("Buka lewat bot Telegram").

## Masalah umum

| Gejala | Penyebab |
|---|---|
| "Akses langsung ditolak" | `PROXY_SECRET` tidak sama dengan `webapp_proxy_secret` |
| "Buka halaman ini lewat bot Telegram" | halaman dibuka di luar Telegram, atau `webapp_url` salah |
| "Server bot tidak bisa dihubungi" | tunnel/domain mati, port salah, atau bot belum jalan |
| Tombol Mini App tidak muncul | `webapp_url` kosong / bukan `https://` / bot belum restart |
| Aksi baru ditolak 404 "Aksi tidak dikenal" | `functions/api/app/[[path]].js` (daftar `ALLOWED`) belum sama dengan versi bot: deploy ulang paket ini |
| Tampilan lama setelah update | deploy ulang; di Telegram tutup lalu buka Mini App lagi |

## Opsi lanjutan: tanpa proxy (CORS langsung)

Hanya bila perlu. Isi `<meta name="api-base" content="https://api.domainanda.com">` di `public/index.html`,
tambahkan alamat itu ke `connect-src` di `public/_headers`, dan isi bot `webapp_cors_origin` = alamat Pages.
Mode ini tidak bisa dipakai bersama `webapp_proxy_secret`.

## Mengubah tampilan

Edit `public/app.js` dan `public/app.css`, lalu deploy ulang. Semua teks pengguna dirender lewat `textContent` (aman dari XSS) — pertahankan pola itu.
