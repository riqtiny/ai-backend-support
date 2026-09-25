# Dokumentasi GoodevaDesk

Dokumen ini menjelaskan cara menjalankan, memahami, menguji, dan mengoperasikan GoodevaDesk Support API.

## Daftar Dokumentasi

- [Referensi API](api.md) — endpoint, autentikasi, contoh request/response, dan error.
- [Arsitektur](architecture.md) — komponen, skema data, isolasi tenant, dan alur request.
- [Integrasi LLM](llm.md) — provider, prompt, konfigurasi, validasi, dan penanganan kegagalan.
- [Cache Redis](redis.md) — strategi kunci, pencocokan persis/near-duplicate, TTL, dan pola kegagalan.
- [Penerapan dan operasional](deployment.md) — penyiapan Docker/lokal, migrasi, seed, pengujian, dan pemecahan masalah.
- [Python NLP](python-nlp.md) — ekstraksi entitas dan cara menggunakannya dengan tiket serta API.
- [Pengujian dan skenario smoke test](testing.md) — skenario end-to-end yang siap disalin dan dijalankan.

## Mulai Cepat dengan Docker

Prasyarat: Docker dan Docker Compose.

```bash
cp .env.example .env
# Isi OPENAI_API_KEY di .env untuk mengaktifkan LLM

docker compose up --build -d --wait
docker compose exec api npx prisma db seed
```

API berjalan di `http://localhost:3000`. Docker Compose menjalankan PostgreSQL, Redis, dan API secara bersamaan. Container API menjalankan migrasi Prisma sebelum aplikasi mulai.

Periksa health check:

```bash
curl http://localhost:3000/health
```

Untuk pengembangan lokal tanpa menjalankan seluruh API melalui Docker, ikuti [`deployment.md`](deployment.md).

## Organisasi Demo

Seed membuat atau memperbarui organisasi berikut:

```text
Nama:    Demo Organization
API key: demo-org-key
```

API key demo hanya untuk pengembangan. Ganti atau hapus sebelum menggunakan sistem di luar lingkungan lokal.

## Konvensi Penamaan

Prisma memakai nama field camelCase di TypeScript dan memetakannya ke kolom PostgreSQL berbentuk snake_case:

| API/TypeScript   | Database          |
| ---------------- | ----------------- |
| `organizationId` | `organization_id` |
| `customerEmail`  | `customer_email`  |
| `suggestedReply` | `suggested_reply` |
| `createdAt`      | `created_at`      |
| `apiKey`         | `api_key`         |

## Status Fitur

- Backend REST: selesai.
- PostgreSQL dan migrasi Prisma: selesai.
- Autentikasi API key: selesai.
- Isolasi tenant: selesai.
- Klasifikasi dan draf balasan OpenAI: selesai.
- Cache exact/near-duplicate Redis: selesai.
- Docker Compose: selesai.
- Ekstraksi entitas Python: selesai sebagai fitur tambahan.
- Crawler Python atau model Hugging Face/NLI: opsional dan belum diimplementasikan.

## Prinsip Operasional

1. Tiket selalu disimpan sebelum diproses oleh LLM.
2. Kegagalan LLM tidak membatalkan pembuatan tiket; `category` dan `suggestedReply` tetap `null` jika enrichment tidak berhasil.
3. Redis adalah optimasi, bukan sumber kebenaran.
4. Setiap akses tiket menggunakan `organizationId` yang berasal dari API key.
5. Secret tidak boleh disimpan dalam repositori.
