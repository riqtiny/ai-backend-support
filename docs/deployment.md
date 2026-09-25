# Penerapan dan Operasional

## Kebutuhan Sistem

- Node.js 20+
- npm
- PostgreSQL
- Redis
- API key OpenAI jika enrichment LLM diperlukan
- Python 3.10+ jika helper NLP Python digunakan
- Docker dan Docker Compose untuk penerapan lokal terpadu
- `curl` dan Python 3 untuk menjalankan smoke test

## Docker Compose

File `.env` harus berada di root proyek, di samping `docker-compose.yml`.

```bash
cp .env.example .env
# Edit .env dan isi OPENAI_API_KEY.

docker compose up --build -d --wait
```

Compose menjalankan:

- PostgreSQL 16 Alpine
- Redis 7 Alpine
- API NestJS
- `prisma migrate deploy` sebelum API mulai berjalan

Seed organisasi demo:

```bash
docker compose exec api npx prisma db seed
```

Base URL API:

```text
http://localhost:3000
```

Pemeriksaan kesehatan:

```bash
curl http://localhost:3000/health
```

Periksa apakah secret tersedia tanpa mencetak nilainya:

```bash
docker compose exec api sh -c \
  'test -n "$OPENAI_API_KEY" && echo OPENAI_API_KEY=set || echo OPENAI_API_KEY=missing'
```

Setelah mengubah `.env`, recreate container API:

```bash
docker compose up -d --build --wait --force-recreate
```

Compose meng-override `DATABASE_URL`, `REDIS_URL`, dan konfigurasi cache pada service `api` agar sesuai dengan nama service internal. `DATABASE_URL` di `.env` tetap diperlukan ketika menjalankan Prisma CLI atau API langsung dari host. `REDIS_URL` dan konfigurasi cache memiliki fallback runtime untuk host, tetapi harus disesuaikan bila layanannya tidak berada di `localhost`. Service `db` dan `redis` sendiri tidak membaca env aplikasi tersebut.

### Container NLP Python Opsional

Service `nlp` adalah utilitas satu kali dan tidak otomatis menjadi bagian stack normal. Jalankan menggunakan profil `nlp`:

```bash
# Stack API harus berjalan, atau Compose akan menjalankan dependensinya.
docker compose up --build -d --wait
docker compose --profile nlp build nlp

docker compose --profile nlp run --rm nlp --pretty --text \
  'Contact alice@example.com or +62 812-3456-7890. Invoice INV-2048 is missing.'
```

Untuk mengambil tiket langsung dari API:

```bash
docker compose --profile nlp run --rm nlp \
  --ticket-id "32c07686-20be-4c9b-b43b-6a5a9507c860" \
  --pretty
```

Container `nlp` menggunakan jaringan Compose yang sama dengan API. `GOODEVA_API_URL` otomatis diarahkan ke `http://api:3000`. Untuk mode pengambilan dari API, pastikan `GOODEVA_API_KEY` tersedia di `.env`; nilai contoh pada `.env.example` adalah `demo-org-key`.

## Pengembangan Lokal

Jalankan hanya service infrastruktur:

```bash
cp .env.example .env
docker compose up -d --wait db redis
```

Kemudian jalankan API dari host:

```bash
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run start:dev
```

`npm run db:deploy` menerapkan migrasi yang sudah ada dalam repositori. Untuk membuat migrasi baru karena perubahan skema selama pengembangan, gunakan:

```bash
npx prisma migrate dev --name nama-perubahan
```

Pastikan `DATABASE_URL` dan `REDIS_URL` di `.env` mengarah ke instance yang benar. Nilai default `.env.example` menggunakan `localhost`, sedangkan API di dalam Compose memakai nama service internal `db` dan `redis`.

## Aturan File Environment

Gunakan:

```env
KEY=value
KEY="value with spaces"
```

Hindari:

```env
KEY = value
export KEY=value
```

Jangan commit `.env`. `.env.example` hanya berisi placeholder dan konfigurasi non-secret.

## Pengujian dan Build

```bash
npm run lint
npm run build
npm test
npm run test:cov
npm run test:python
npm run test:smoke
```

Validasi skema Prisma:

```bash
DATABASE_URL="postgresql://..." npx prisma validate
```

Rincian pengujian ada di [`testing.md`](testing.md).

## Pemecahan Masalah

### Compose menampilkan pesan bahwa `.env` tidak ditemukan

Salin template dari root proyek:

```bash
cp .env.example .env
```

### API key tidak terbaca di dalam container

Periksa environment container dan recreate container:

```bash
docker compose exec api sh -c \
  'test -n "$OPENAI_API_KEY" && echo set || echo missing'

docker compose up -d --build --wait --force-recreate
```

### Hasil enrichment LLM bernilai `null`

Periksa log:

```bash
docker compose logs --tail=100 api
```

Kemungkinan penyebabnya:

- API key tidak dimuat ke dalam container.
- Key tidak valid atau ditolak provider.
- Model atau base URL salah.
- Request timeout atau terkena rate limit.
- Response LLM tidak valid.

Tiket tetap tersimpan dan dapat diambil melalui `GET /tickets/:id`.

### Error validasi UUID

Gunakan UUID aktual yang dikembalikan oleh `POST /tickets`, bukan literal `TICKET_ID`.

### Reset Data Lokal

Perintah berikut menghapus volume PostgreSQL dan Redis:

```bash
docker compose down -v
docker compose up -d --build --wait
docker compose exec api npx prisma db seed
```

Gunakan hanya pada lingkungan pengembangan karena seluruh data volume akan dihapus.

## Checklist Produksi

- Ganti API key demo.
- Ganti password database dan jangan expose port PostgreSQL atau Redis.
- Gunakan secret manager untuk `OPENAI_API_KEY`.
- Gunakan HTTPS untuk API.
- Tambahkan rate limiting, pagination, audit log, metrics, dan distributed tracing.
- Tambahkan queue atau outbox untuk pemrosesan LLM.
- Gunakan autentikasi/TLS Redis jika Redis tidak berada di jaringan privat.
- Tinjau policy retensi untuk data tiket dan cache.
- Tambahkan prosedur pencadangan dan pemulihan untuk PostgreSQL.
- Tergantung pada kebutuhan, gunakan hash API key dan rotasi key.
