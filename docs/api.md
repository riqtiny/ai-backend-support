# Referensi API

Base URL lokal:

```text
http://localhost:3000
```

## Autentikasi

Setiap endpoint `/tickets` memerlukan header berikut:

```http
x-api-key: <api-key-organisasi>
```

API key dicari pada tabel `organizations`. Jika tidak ditemukan, API mengembalikan `401` tanpa memberikan informasi mengenai tenant lain.

Contoh:

```bash
export BASE_URL=http://localhost:3000
export API_KEY=demo-org-key
```

## Representasi Tiket

Response API menggunakan camelCase. Nama kolom database menggunakan snake_case dan dipetakan melalui Prisma.

```json
{
  "id": "32c07686-20be-4c9b-b43b-6a5a9507c860",
  "organizationId": "c14a0efc-2578-4d9a-9429-e1375ecda94c",
  "customerEmail": "customer@example.com",
  "subject": "Permintaan invoice",
  "message": "Saya tidak menemukan invoice untuk pembayaran terakhir.",
  "category": "billing",
  "suggestedReply": "Maaf, Anda mengalami kesulitan menemukan invoice Anda.",
  "status": "open",
  "createdAt": "2026-09-25T08:48:35.883Z"
}
```

### Field

- `id`: UUID tiket.
- `organizationId`: UUID tenant pemilik tiket.
- `customerEmail`: alamat email pelanggan.
- `subject`: subjek tiket.
- `message`: isi pesan tiket.
- `category`: `billing`, `technical`, `general`, atau `null` jika enrichment belum berhasil.
- `suggestedReply`: draf dari LLM atau cache, atau `null`.
- `status`: `open`, `in_progress`, atau `closed`.
- `createdAt`: waktu tiket dibuat.

## Ringkasan Endpoint

| Method  | Endpoint              | Autentikasi | Keterangan                               |
| ------- | --------------------- | ----------- | ---------------------------------------- |
| `POST`  | `/tickets`            | API key     | Membuat tiket dan menjalankan enrichment |
| `GET`   | `/tickets`            | API key     | Melihat tiket milik tenant               |
| `GET`   | `/tickets/:id`        | API key     | Mengambil detail tiket milik tenant      |
| `PATCH` | `/tickets/:id/status` | API key     | Mengubah status tiket                    |
| `GET`   | `/health`             | Tidak ada   | Liveness check API                       |

## Membuat Tiket

### Permintaan

```bash
curl -X POST "$BASE_URL/tickets" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "customerEmail": "customer@example.com",
    "subject": "Permintaan invoice",
    "message": "Saya tidak menemukan invoice untuk pembayaran terakhir."
  }'
```

`customer_email` juga diterima sebagai alias input untuk klien yang mengikuti konvensi penamaan database.

### Perilaku

1. `ApiKeyGuard` memvalidasi API key dan organisasi.
2. `ValidationPipe` memvalidasi input.
3. Simpan tiket dengan `status = open`.
4. Cari hasil klasifikasi di Redis.
5. Jika cache miss dan LLM terkonfigurasi, panggil OpenAI.
6. Jika hasil valid, simpan ke tiket dan cache.
7. Kembalikan representasi tiket terbaru dalam scope tenant.

Cache hit tetap dapat mengisi `category` dan `suggestedReply` tanpa `OPENAI_API_KEY`. Jika cache miss tanpa API key atau provider tidak didukung, field enrichment tetap `null`. Jika Redis atau LLM gagal, tiket tetap dikembalikan.

### Respons

Status sukses: `201 Created`.

## Melihat Daftar Tiket

```bash
curl "$BASE_URL/tickets" \
  -H "x-api-key: $API_KEY"
```

Filter opsional:

```bash
curl "$BASE_URL/tickets?status=open&category=billing" \
  -H "x-api-key: $API_KEY"
```

Nilai query yang valid:

- `status=open`
- `status=in_progress`
- `status=closed`
- `category=billing`
- `category=technical`
- `category=general`

Daftar selalu dibatasi ke organisasi yang berasal dari API key dan diurutkan berdasarkan `createdAt` terbaru lebih dulu. Endpoint ini belum mendukung pagination.

## Mengambil Detail Tiket

Gunakan UUID sebenarnya, bukan literal placeholder `TICKET_ID`:

```bash
TICKET_ID="32c07686-20be-4c9b-b43b-6a5a9507c860"

curl "$BASE_URL/tickets/$TICKET_ID" \
  -H "x-api-key: $API_KEY"
```

Tiket yang tidak ada atau milik organisasi lain menghasilkan `404 Ticket not found`. Ini mencegah API membocorkan keberadaan tiket pada tenant lain.

## Memperbarui Status

```bash
curl -X PATCH "$BASE_URL/tickets/$TICKET_ID/status" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"in_progress"}'
```

Status yang valid:

```text
open
in_progress
closed
```

Response berisi tiket lengkap setelah perubahan.

## Respons Error

> Contoh pesan di bawah dipertahankan dalam bahasa Inggris karena merupakan nilai literal yang dikembalikan oleh runtime NestJS.

### `401 Unauthorized`

Header API key tidak ada atau tidak valid.

```json
{
  "message": "A valid x-api-key header is required",
  "error": "Unauthorized",
  "statusCode": 401
}
```

### `400 Bad Request`

Input tidak valid, termasuk UUID yang salah atau status/category di luar daftar yang diizinkan.

```json
{
  "message": "Validation failed (uuid is expected)",
  "error": "Bad Request",
  "statusCode": 400
}
```

### `404 Not Found`

Tiket tidak ada dalam tenant yang sedang terautentikasi.

```json
{
  "message": "Ticket not found",
  "error": "Not Found",
  "statusCode": 404
}
```

### `500 Internal Server Error`

Terjadi error database atau service yang tidak tertangani. Periksa log API untuk investigasi.
