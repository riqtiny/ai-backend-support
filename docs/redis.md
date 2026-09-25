# Cache Redis

## Tujuan

Redis menyimpan hasil klasifikasi LLM yang valid agar tiket dengan `subject` dan `message` yang sama atau sangat mirip tidak memanggil LLM berulang kali.

Redis bukan database utama. PostgreSQL tetap menjadi sumber kebenaran untuk tiket.

## Konfigurasi

| Variabel                       | Default                  | Keterangan                                      |
| ------------------------------ | ------------------------ | ----------------------------------------------- |
| `REDIS_ENABLED`                | `true`                   | Set ke `false` untuk menonaktifkan cache        |
| `REDIS_URL`                    | `redis://localhost:6379` | URL koneksi Redis                               |
| `CACHE_TTL_SECONDS`            | `604800`                 | TTL cache, yaitu 7 hari                         |
| `CACHE_SIMILARITY_THRESHOLD`   | `0.85`                   | Ambang tingkat kemiripan dari 0 sampai 1        |
| `CACHE_SIMILARITY_MAX_ENTRIES` | `100`                    | Jumlah maksimum kunci yang diperiksa per lookup |

Saat API dijalankan melalui Docker Compose, `docker-compose.yml` meng-override beberapa variabel cache. Karena itu, `REDIS_ENABLED=false` pada `.env` belum menonaktifkan cache untuk service `api` di Compose.

## Strategi Kunci Cache

Teks dinormalisasi dengan langkah berikut:

1. Menerapkan Unicode NFKC normalization.
2. Mengubah huruf menjadi lowercase.
3. Mengganti setiap rangkaian karakter selain huruf dan angka dengan satu spasi.
4. Menghapus spasi di awal dan akhir.

Kunci persis mencakup `organizationId` dan hash SHA-256 dari `subject` serta `message` yang sudah dinormalisasi. Bagian `organizationId` mencegah hasil satu tenant digunakan oleh tenant lain.

Contoh format:

```text
goodeva:classification:v1:<organization-id>:<sha256>
```

Nilai cache berbentuk JSON dan memuat:

- `subject` asli.
- `message` asli.
- `category`.
- `suggestedReply`.

Penyimpanan teks asli diperlukan agar near-duplicate dapat dihitung. Konsekuensinya, cache dapat berisi data tiket yang sensitif dan harus mengikuti kebijakan retensi serta kontrol akses yang sesuai.

## Alur Lookup

```text
Tiket baru
   │
   ├── Hash teks normalisasi persis → hasil cache ditemukan
   │
   └── Miss
       ├── Redis SCAN dengan MATCH dalam prefix tenant
       ├── Near-duplicate ditemukan → hasil cache digunakan
       └── Miss → panggil LLM → simpan hasil valid
```

Skor near-duplicate adalah rata-rata token Jaccard similarity untuk `subject` dan `message`. Dengan demikian, perubahan kecil pada field yang singkat tidak membuat pesan panjang yang identik terlihat sebagai tiket baru.

Pencarian dibatasi oleh `CACHE_SIMILARITY_MAX_ENTRIES`. Jika nilainya `0`, hanya pencarian persis yang dilakukan.

## Perilaku saat Gagal

- Redis tidak aktif tidak menyebabkan `POST /tickets` gagal.
- Error koneksi, baca, dan tulis Redis dicatat sebagai warning.
- Cache miss atau Redis tidak tersedia menyebabkan LLM dipanggil jika API key tersedia.
- Hasil LLM yang tidak valid tidak pernah disimpan.
- Kegagalan penyimpanan cache tidak menggagalkan enrichment atau pembuatan tiket.
- TTL membuat cache kedaluwarsa secara otomatis setelah durasi yang ditentukan.

## Catatan Operasional

Redis `SCAN` memakai `MATCH` pada prefix tenant dan `COUNT` sebagai hint. Aplikasi membatasi jumlah kunci yang dibaca, tetapi Redis tetap dapat memindai key lain yang tidak cocok sebelum cursor selesai. Jadi, mekanisme ini bukan pagination atau indeks lengkap, dan urutan kunci dari `SCAN` tidak terjamin. Pada dataset besar, hasil near-duplicate dapat berbeda dari penjalanan sebelumnya.

Untuk dataset yang jauh lebih besar, gunakan indeks kandidat berbasis token hash, embedding vector, atau service similarity khusus.

Untuk produksi:

- Gunakan autentikasi dan TLS Redis.
- Pantau rasio cache hit, latency, jumlah key, dan error koneksi.
- Jangan simpan data tiket sensitif tanpa kebijakan retensi yang jelas.
- Gunakan namespace cache baru ketika versi prompt atau model berubah, karena hasil lama mungkin tidak lagi valid.
- Batasi akses jaringan Redis dan jangan mengekspos portnya ke publik.
