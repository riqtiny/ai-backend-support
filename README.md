# API Dukungan GoodevaDesk

API internal untuk menerima dan mengelola tiket dukungan GoodevaDesk. Proyek ini menggunakan **NestJS + TypeScript + Prisma + PostgreSQL**, **Redis** untuk cache hasil klasifikasi, serta **OpenAI Chat Completions** untuk klasifikasi tiket dan pembuatan draf balasan.

> Kunci API OpenAI tidak disimpan dalam repositori. Isi `OPENAI_API_KEY` melalui `.env` atau secret manager.

## Fitur

- Multi-tenancy sederhana melalui entitas `Organization` dan API key.
- Autentikasi `x-api-key` untuk seluruh endpoint tiket.
- Isolasi tenant pada **semua** query tiket: `organizationId` selalu berasal dari API key, bukan dari body atau query request.
- `POST /tickets` menyimpan tiket terlebih dahulu, lalu melakukan enrichment LLM secara best-effort.
- Kategori tiket: `billing`, `technical`, dan `general`.
- Status tiket: `open`, `in_progress`, dan `closed`.
- Redis menyimpan hasil klasifikasi yang valid. Kecocokan persis menggunakan hash SHA-256 dari teks yang sudah dinormalisasi; near-duplicate menggunakan token Jaccard similarity.
- Timeout, rate limit, kegagalan Redis, dan respons LLM yang tidak valid tidak membatalkan pembuatan tiket. Field enrichment tetap `null` jika tidak ada hasil yang valid.
- Ekstraktor entitas Python opsional untuk email, nomor telepon, URL, nomor referensi, dan nominal.

## Dokumentasi

Dokumentasi lengkap tersedia di [`docs/`](docs/README.md):

- [Referensi API](docs/api.md)
- [Arsitektur dan isolasi tenant](docs/architecture.md)
- [Integrasi LLM](docs/llm.md)
- [Cache Redis](docs/redis.md)
- [Penerapan dan operasional](docs/deployment.md)
- [Ekstraksi entitas dengan Python](docs/python-nlp.md)
- [Pengujian dan skenario smoke test](docs/testing.md)

## Cara Menjalankan Proyek

### Prasyarat

Pilih salah satu mode berikut:

- **Docker Compose (direkomendasikan):** Docker dan Docker Compose. Jika juga menjalankan `npm run test:smoke`, diperlukan Node.js 20+, npm, `curl`, dan Python 3.
- **Pengembangan lokal:** Node.js 20+, npm, PostgreSQL, dan Redis. PostgreSQL dan Redis dapat dijalankan melalui Docker atau sebagai layanan lokal. `curl` dan Python 3 diperlukan tambahan untuk smoke test atau helper Python NLP.

`OPENAI_API_KEY` diperlukan untuk memanggil LLM. Tanpa kunci tersebut, API tetap berjalan dan menyimpan tiket. `category` dan `suggestedReply` dapat terisi dari cache Redis; jika cache miss, keduanya tetap `null`.

### Opsi 1: Docker Compose

Jalankan perintah berikut dari root repositori:

```bash
cp .env.example .env
```

Edit `.env`, lalu isi setidaknya `OPENAI_API_KEY` jika ingin mengaktifkan LLM. Jangan masukkan file `.env` ke sistem version control.

Jalankan PostgreSQL, Redis, dan API:

```bash
docker compose up --build -d --wait
```

Seed organisasi demo setelah container API siap:

```bash
docker compose exec api npx prisma db seed
```

API tersedia di `http://localhost:3000`. Periksa kesehatan API:

```bash
curl http://localhost:3000/health
```

Seed membuat organisasi demo dengan API key berikut:

```text
demo-org-key
```

API key tersebut hanya untuk pengembangan. Ganti atau hapus sebelum sistem digunakan di luar lingkungan lokal.

Jalankan skenario end-to-end setelah seluruh stack aktif:

```bash
npm run test:smoke
```

> Catatan: smoke test hanya menyimpan dan membersihkan ID tiket utama. Tiket duplikat yang dibuat selama skenario konsisten dapat tetap ada, dan cleanup database hanya dicoba jika service `db` Compose aktif.

Helper Python NLP opsional dapat dijalankan sebagai container satu kali:

```bash
docker compose --profile nlp run --rm nlp --pretty --text \
  'Contact alice@example.com or +62 812-3456-7890. Invoice INV-2048 is missing.'
```

Untuk mengambil satu tiket dari API, pastikan `TICKET_ID` berisi UUID dari respons pembuatan tiket:

```bash
docker compose --profile nlp run --rm nlp \
  --ticket-id "$TICKET_ID" --pretty
```

Hentikan container:

```bash
docker compose down
```

Hapus juga volume data PostgreSQL dan Redis pada lingkungan pengembangan:

```bash
docker compose down -v
```

> Perintah `docker compose down -v` menghapus data persisten. Jangan menjalankannya pada lingkungan yang menyimpan data yang masih dibutuhkan.

### Opsi 2: Pengembangan Lokal

Pastikan PostgreSQL dan Redis sudah aktif. Untuk menjalankan dependensi melalui Docker:

```bash
cp .env.example .env
docker compose up -d --wait db redis
```

Kemudian install dependensi, buat Prisma Client, terapkan migrasi, isi data seed demo, dan jalankan API:

```bash
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run start:dev
```

Nilai `DATABASE_URL` dan `REDIS_URL` dalam `.env.example` sudah menggunakan `localhost`, sesuai untuk API yang dijalankan dari host. Jika PostgreSQL dan Redis menggunakan alamat atau port lain, sesuaikan kedua nilai tersebut.

Untuk pengembangan skema Prisma, gunakan:

```bash
npx prisma migrate dev --name nama-perubahan
```

API lokal juga tersedia di `http://localhost:3000`.

## Konfigurasi Environment

Salin `.env.example` sebagai titik awal. Daftar lengkap variabel:

| Variabel                       | Default                         | Keterangan                                                                           |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV`                     | -                               | Mode aplikasi, misalnya `development` atau `production`                              |
| `PORT`                         | `3000`                          | Port API                                                                             |
| `DATABASE_URL`                 | -                               | URL PostgreSQL; wajib diisi                                                          |
| `REDIS_ENABLED`                | `true`                          | Set ke `false` untuk menonaktifkan cache saat menjalankan API di luar Compose        |
| `REDIS_URL`                    | `redis://localhost:6379`        | URL koneksi Redis                                                                    |
| `CACHE_TTL_SECONDS`            | `604800`                        | TTL cache klasifikasi dalam detik (7 hari)                                           |
| `CACHE_SIMILARITY_THRESHOLD`   | `0.85`                          | Ambang tingkat kemiripan, dari 0 sampai 1                                            |
| `CACHE_SIMILARITY_MAX_ENTRIES` | `100`                           | Jumlah maksimum kunci cache yang diperiksa per pencarian near-duplicate              |
| `GOODEVA_API_KEY`              | kosong (contoh: `demo-org-key`) | API key GoodevaDesk untuk mode pengambilan data oleh helper Python NLP               |
| `GOODEVA_API_URL`              | `http://localhost:3000`         | Base URL API untuk helper Python NLP                                                 |
| `LLM_PROVIDER`                 | `openai`                        | Provider LLM; saat ini hanya `openai` yang diimplementasikan                         |
| `OPENAI_API_KEY`               | kosong                          | Secret LLM; diperlukan untuk pemanggilan LLM, bukan untuk cache hit                  |
| `OPENAI_MODEL`                 | `gpt-4o-mini`                   | Model Chat Completions                                                               |
| `OPENAI_BASE_URL`              | `https://api.openai.com/v1`     | Base URL provider atau endpoint kompatibel OpenAI                                    |
| `LLM_TIMEOUT_MS`               | `10000`                         | Total timeout satu proses enrichment, termasuk retry                                 |
| `LLM_MAX_RETRIES`              | `1`                             | Jumlah retry terbatas untuk HTTP 429/408/5xx dan error jaringan; dibatasi maksimum 3 |

Aturan format `.env`:

```env
KEY=value
KEY="value with spaces"
```

Hindari spasi di sekitar `=` dan penggunaan `export` di dalam file. Setelah mengubah `.env`, buat ulang container agar nilai baru terbaca:

```bash
docker compose up -d --build --wait --force-recreate
```

> Pada service `api` di Docker Compose, `DATABASE_URL`, `REDIS_URL`, dan konfigurasi cache di-override oleh `docker-compose.yml`. Karena itu, `REDIS_ENABLED=false` di `.env` tidak menonaktifkan cache untuk API yang dijalankan melalui Compose saat ini.

## Contoh Penggunaan

```bash
export BASE_URL=http://localhost:3000
export API_KEY=demo-org-key

curl -X POST "$BASE_URL/tickets" \
  -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "customerEmail": "customer@example.com",
    "subject": "Permintaan invoice",
    "message": "Saya tidak menemukan invoice untuk pembayaran terakhir."
  }'
```

Salin UUID dari field `id` respons, lalu gunakan untuk operasi berikutnya:

```bash
export TICKET_ID="UUID_DARI_HASIL_POST"

curl "$BASE_URL/tickets?status=open&category=billing" \
  -H "x-api-key: $API_KEY"

curl "$BASE_URL/tickets/$TICKET_ID" \
  -H "x-api-key: $API_KEY"

curl -X PATCH "$BASE_URL/tickets/$TICKET_ID/status" \
  -H "x-api-key: $API_KEY" \
  -H 'content-type: application/json' \
  -d '{"status":"in_progress"}'
```

`POST /tickets` juga menerima `customer_email` sebagai alias dari `customerEmail`. Respons API menggunakan konvensi camelCase NestJS/JavaScript (`organizationId`, `suggestedReply`, dan `createdAt`), sedangkan nama kolom PostgreSQL dipetakan secara eksplisit di `prisma/schema.prisma`.

## Keputusan Desain

### Provider LLM

Proyek memilih **OpenAI Chat Completions** melalui pemanggilan `fetch` langsung. Alasan pemilihan provider:

- Mendukung `response_format: json_object`, sehingga keluaran dapat divalidasi sebagai JSON terstruktur.
- Format request dan response cukup sederhana dan mudah diuji.
- `OPENAI_BASE_URL` dapat diarahkan ke endpoint lain yang kompatibel dengan OpenAI.
- Tidak memerlukan SDK runtime besar; kredensial hanya dibaca dari environment.

Integrasi sudah mencakup timeout, retry terbatas, validasi kategori, validasi draf, dan fallback ketika provider gagal. Ringkasan prompt, konfigurasi, serta perilaku error dijelaskan di [`docs/llm.md`](docs/llm.md).

### Skema Data dan Isolasi Tenant

`Organization` memiliki `api_key` yang unik. `ApiKeyGuard` mencari organisasi berdasarkan kunci tersebut dan menempelkan hasil autentikasi ke request. `TicketsService` tidak pernah menerima `organizationId` dari klien; nilai tersebut selalu berasal dari guard.

Pengambilan detail dan pembaruan menggunakan kombinasi `{ id, organizationId }`. Tiket yang tidak ditemukan dalam tenant aktif akan menghasilkan `404`, sehingga keberadaan tiket milik tenant lain tidak bocor.

Skema menggunakan UUID sebagai primary key, `created_at` dengan default `now()`, serta indeks komposit untuk list dan filter per tenant. Field `suggested_reply` dan `category` dapat berupa `null` karena proses enrichment tidak boleh memblokir penerimaan tiket.

### Alur Pemrosesan Tiket

1. Validasi request.
2. Simpan tiket dengan `status = open`.
3. Cari hasil klasifikasi di Redis.
4. Jika cache miss dan LLM terkonfigurasi, panggil LLM.
5. Simpan hasil valid ke tiket dan cache.
6. Muat ulang tiket dalam scope tenant sebelum mengembalikan response.

Tiket selalu disimpan sebelum LLM dipanggil. Jika Redis atau LLM gagal, tiket tetap dikembalikan dengan field enrichment mungkin bernilai `null`.

### Strategi Cache Redis

- Key cache mencakup `organizationId` dan hash SHA-256 dari `subject` serta `message` yang telah dinormalisasi.
- Pencocokan persis menggunakan key tersebut.
- Pencocokan near-duplicate menjalankan Redis `SCAN` dengan `MATCH` pada prefix tenant dan membatasi jumlah kunci yang dibaca aplikasi. `COUNT` Redis hanya hint, sehingga jumlah keyspace internal yang dipindai tidak menjadi batas keras.
- Hanya hasil LLM atau cache yang valid yang disimpan.
- TTL default 7 hari mengatur masa simpan cache.
- PostgreSQL tetap menjadi sumber kebenaran; Redis hanya berfungsi sebagai optimasi.

Detail normalisasi, TTL, kunci cache, dan pola kegagalan dijelaskan di [`docs/redis.md`](docs/redis.md).

### Keandalan

- Pembuatan tiket tidak bergantung pada keberhasilan Redis atau LLM.
- Error LLM dan Redis dicatat sebagai warning tanpa membocorkan secret.
- Hasil LLM divalidasi sebelum disimpan.
- Draf dibatasi maksimal 2.000 karakter dan ditujukan untuk ditinjau agen sebelum dikirim.

## Struktur Proyek

```text
src/
  auth/       API key guard dan organisasi terautentikasi
  llm/        Request OpenAI, retry, parsing, dan validasi
  prisma/     PrismaService
  redis/      Koneksi Redis dan cache klasifikasi
  tickets/    Controller, DTO, query tenant, dan enrichment
prisma/
  schema.prisma
  seed.ts
python/
  entity_extractor.py
  tests/
scripts/
  smoke-test.sh
docs/         Dokumentasi API, arsitektur, LLM, Redis, Python, pengujian, dan penerapan
```

## Perintah Pengembangan

```bash
npm run build       # Build bundle produksi
npm run lint        # Memeriksa format kode
npm test            # Unit test TypeScript
npm run test:cov    # Unit test dengan coverage
npm run test:python # Test ekstraktor entitas Python
npm run test:smoke  # Smoke test end-to-end; stack harus berjalan
npm run db:generate # Membuat ulang Prisma Client
npm run db:deploy   # Menerapkan migrasi database
npm run db:seed     # Menjalankan seed data demo
```

## Perbaikan dan Tambahan Prioritas

Jika tersedia waktu lebih, prioritas menambahkannya adalah:

- Menyimpan hash API key dan menambahkan rotasi key.
- Memindahkan pemrosesan LLM ke queue/outbox worker agar `POST /tickets` tidak menunggu provider dan retry lebih mudah dipantau.
- Menambahkan pagination, log audit, metrik, distributed tracing, dan rate limit per organisasi.
- Menambahkan uji integrasi dengan Testcontainers untuk migrasi, Redis, dan isolasi tenant.
- Membuat abstraksi provider agar provider LLM lain dapat ditambahkan tanpa mengubah layanan utama.
- Menambahkan alur review sebelum draf dikirim ke pelanggan.
- Menambahkan redaksi log serta kebijakan retensi data untuk log, tiket, dan cache.
- Memindahkan konfigurasi seed Prisma dari `package.json` ke `prisma.config.ts` sebelum Prisma 7.
