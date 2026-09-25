# Arsitektur

## Komponen

| Komponen                     | Tanggung jawab                                                              |
| ---------------------------- | --------------------------------------------------------------------------- |
| `TicketsController`          | Route HTTP, validasi input, dan akses organisasi terautentikasi             |
| `TicketsService`             | Persistensi tiket, query dengan scope tenant, dan orkestrasi enrichment     |
| `ApiKeyGuard`                | Validasi `x-api-key` dan menempelkan organisasi ke request                  |
| `PrismaService`              | Koneksi dan lifecycle Prisma Client                                         |
| `LlmService`                 | Request OpenAI, retry, timeout, prompt, dan validasi response               |
| `ClassificationCacheService` | Koneksi Redis, lookup exact/near-duplicate, dan TTL                         |
| `ConfigModule`               | Konfigurasi dari environment variable                                       |
| `HealthController`           | Endpoint liveness sederhana                                                 |
| Service `nlp` di Compose     | Utilitas Python satu kali untuk ekstraksi entitas dari teks, file, atau API |

## Skema Data

```text
Organization
├── id
├── name
├── api_key (unique)
└── tickets[]
    └── Ticket
        ├── id
        ├── organization_id
        ├── customer_email
        ├── subject
        ├── message
        ├── category (nullable)
        ├── suggested_reply (nullable)
        ├── status
        └── created_at
```

Skema didefinisikan di `prisma/schema.prisma`. Migrasi awal berada di `prisma/migrations/0001_init`.

Keputusan bentuk skema:

- `Organization` dan `Ticket` memakai UUID agar ID tidak bergantung pada urutan database.
- `api_key` unik karena digunakan untuk lookup organisasi saat autentikasi.
- Relasi `Organization` ke `Ticket` memakai `onDelete: Cascade` agar tiket ikut terhapus ketika organisasi dihapus.
- `category` dan `suggested_reply` dapat `null` karena enrichment bersifat best-effort dan tidak boleh menghalangi intake tiket.
- `status` memakai enum PostgreSQL agar hanya nilai `open`, `in_progress`, atau `closed` yang valid.
- Indeks komposit `(organizationId, createdAt)`, `(organizationId, status)`, dan `(organizationId, category)` mendukung query tenant yang umum digunakan.

## Alur Permintaan

```text
HTTP request
    │
    ▼
ValidationPipe + validasi DTO
    │
    ▼
ApiKeyGuard
    │  Cari Organization berdasarkan api_key
    ▼
TicketsController
    │
    ▼
TicketsService
    │
    ├── Prisma: simpan ticket (organizationId dari guard)
    │
    ├── Redis: lookup exact/near-duplicate
    │       └── miss → LlmService
    │
    ├── OpenAI: klasifikasi + draf balasan
    │       └── hasil valid → update ticket
    │
    ├── Redis: simpan hasil valid ke cache
    │
    └── Prisma: muat ulang ticket dalam scope tenant
```

Tiket sengaja disimpan terlebih dahulu. Jika enrichment gagal, tiket yang sudah tersimpan tetap dikembalikan.

## Isolasi Tenant

`organizationId` tidak pernah dibaca dari body atau query string milik klien.

`ApiKeyGuard` melakukan:

```text
x-api-key → lookup Organization → request.organization.id
```

Setelah itu, setiap operasi tiket menggunakan ID tersebut:

- `findMany({ where: { organizationId } })`
- `findFirst({ where: { id, organizationId } })`
- `updateMany({ where: { id, organizationId } })`
- `create({ data: { organizationId } })`

Request detail dan pembaruan terhadap tiket tenant lain menghasilkan `404`, bukan data milik tenant lain. Ini mencegah API membocorkan keberadaan resource lintas tenant.

## Struktur Proyek

```text
src/
├── auth/                  API key guard dan organisasi terautentikasi
├── llm/                   Service OpenAI, retry, parser, dan test
├── prisma/                Modul dan service Prisma
├── redis/                 Service cache Redis dan utilitas similarity
├── tickets/               Controller, DTO, service, tipe, dan test
├── app.module.ts
├── health.controller.ts
└── main.ts

prisma/
├── migrations/            Migrasi SQL
├── schema.prisma
└── seed.ts

python/
├── entity_extractor.py    Ekstraksi entitas ringan
├── requirements.txt
└── tests/

scripts/
└── smoke-test.sh          Smoke test end-to-end

docs/                      Dokumentasi teknis proyek
```

## Trade-off yang Dipilih

- Enrichment dijalankan secara sinkron setelah tiket disimpan agar response dapat menyertakan hasil ketika LLM tersedia. Untuk produksi dengan traffic tinggi, gunakan queue atau pola outbox.
- Pencarian near-duplicate memakai Redis `SCAN` dengan `MATCH` pada prefix tenant. Jumlah kunci yang dibaca aplikasi dibatasi, tetapi `COUNT` Redis hanya hint dan bukan batas keras atas seluruh keyspace yang dipindai server.
- API key disimpan dalam plaintext untuk memenuhi kebutuhan autentikasi sederhana. Deployment produksi sebaiknya menyimpan hash dan mendukung rotasi key.
- `category` disimpan sebagai string nullable karena keluaran LLM sudah divalidasi di layer aplikasi.
- Cache Redis menyimpan `subject` dan `message` asli untuk menghitung similarity. Kebijakan privasi dan retensi data harus diperhatikan sebelum digunakan di produksi.
- `POST /tickets` tetap sederhana dan sinkron, tetapi dapat menambah latency ketika Redis atau LLM tidak tersedia dengan cepat.
