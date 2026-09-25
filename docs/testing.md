# Pengujian dan Skenario Smoke Test

Dokumen ini berisi skenario end-to-end untuk memvalidasi API, isolasi tenant, integrasi LLM, cache Redis, perubahan status, dan helper Python NLP.

## Smoke Test Otomatis

Jalankan dari root repositori:

```bash
./scripts/smoke-test.sh
```

Nilai default yang digunakan script:

```text
BASE_URL=http://localhost:3000
API_KEY=demo-org-key
RUN_DOCKER_NLP=true
CLEANUP=true
```

Script membutuhkan `curl` dan `python3`. Pengujian container NLP tambahan hanya berjalan jika service Docker `db` dan `api` aktif.

Override konfigurasi saat diperlukan:

```bash
BASE_URL=http://localhost:3000 \
API_KEY=demo-org-key \
RUN_DOCKER_NLP=true \
CLEANUP=true \
./scripts/smoke-test.sh
```

Untuk melewati bagian Docker NLP:

```bash
RUN_DOCKER_NLP=false ./scripts/smoke-test.sh
```

### Skenario yang Dicakup Script

1. `GET /health`.
2. API key yang hilang dan tidak valid menghasilkan `401`.
3. `POST /tickets` membuat tiket UUID dengan `status = open`.
4. Validasi kategori LLM, dengan warning jika LLM belum dikonfigurasi.
5. `Subject` dan `message` identik menghasilkan hasil klasifikasi yang konsisten apabila enrichment pertama berhasil.
6. List dan filter dengan scope tenant.
7. Pengambilan detail tiket.
8. Perubahan status menjadi `in_progress`.
9. UUID dan status tidak valid menghasilkan `400`.
10. Detail dan update lintas tenant menghasilkan `404`; list lintas tenant tetap `200`, tetapi tidak memuat tiket tenant lain.
11. Ekstraksi Python NLP lokal.
12. Mode raw-text pada container NLP.
13. Mode pengambilan tiket dari API pada container NLP.

`CLEANUP=true` mencoba menghapus tiket utama dan organisasi sementara melalui container database. Script hanya menyimpan ID tiket utama, sehingga tiket duplikat yang dibuat pada skenario 5 tetap berada di database. Penghapusan hanya dicoba jika service Compose `db` aktif. Gunakan `CLEANUP=false` jika data hasil pengujian ingin diperiksa.

## Skenario Manual yang Dapat Disalin

### 1. Pemeriksaan Kesehatan

```bash
curl -i http://localhost:3000/health
```

Hasil yang diharapkan:

```json
{ "status": "ok" }
```

### 2. Autentikasi

Tanpa API key:

```bash
curl -i -X POST http://localhost:3000/tickets \
  -H 'content-type: application/json' \
  -d '{"customerEmail":"a@example.com","subject":"Test","message":"Halo"}'
```

Hasil yang diharapkan: `401 Unauthorized`.

Dengan API key tidak valid:

```bash
curl -i -X POST http://localhost:3000/tickets \
  -H 'x-api-key: wrong-key' \
  -H 'content-type: application/json' \
  -d '{"customerEmail":"a@example.com","subject":"Test","message":"Halo"}'
```

Hasil yang diharapkan: `401 Unauthorized`.

### 3. Membuat Tiket dan Menjalankan Enrichment LLM

```bash
CREATE_RESPONSE=$(curl -sS -X POST http://localhost:3000/tickets \
  -H 'x-api-key: demo-org-key' \
  -H 'content-type: application/json' \
  -d '{
    "customerEmail": "customer@example.com",
    "subject": "Permintaan invoice",
    "message": "Saya tidak menemukan invoice INV-2048. Hubungi saya di customer@example.com."
  }')

echo "$CREATE_RESPONSE"
```

Jika LLM dikonfigurasi, response berisi `category` dan `suggestedReply`. Jika LLM gagal, tiket tetap dibuat dan kedua field tersebut mungkin bernilai `null`.

### 4. Mengambil Detail Tiket

Salin UUID dari field `id` pada response pembuatan tiket:

```bash
TICKET_ID="UUID_DARI_RESPONSE_CREATE"

curl -i "http://localhost:3000/tickets/$TICKET_ID" \
  -H 'x-api-key: demo-org-key'
```

Hasil yang diharapkan: `200 OK` dengan ID yang sama.

### 5. List dan Filter Tiket

```bash
curl -sS 'http://localhost:3000/tickets?status=open' \
  -H 'x-api-key: demo-org-key'

curl -sS 'http://localhost:3000/tickets?status=open&category=billing' \
  -H 'x-api-key: demo-org-key'
```

### 6. Memperbarui Status

```bash
curl -i -X PATCH "http://localhost:3000/tickets/$TICKET_ID/status" \
  -H 'x-api-key: demo-org-key' \
  -H 'content-type: application/json' \
  -d '{"status":"in_progress"}'
```

Verifikasi filter:

```bash
curl -sS 'http://localhost:3000/tickets?status=in_progress' \
  -H 'x-api-key: demo-org-key'
```

### 7. Validasi

UUID tidak valid:

```bash
curl -i http://localhost:3000/tickets/not-a-uuid \
  -H 'x-api-key: demo-org-key'
```

Status tidak valid:

```bash
curl -i -X PATCH "http://localhost:3000/tickets/$TICKET_ID/status" \
  -H 'x-api-key: demo-org-key' \
  -H 'content-type: application/json' \
  -d '{"status":"invalid"}'
```

Kedua request harus menghasilkan `400 Bad Request`.

## Pengujian LLM dan Redis

### LLM

Pastikan container API memiliki API key:

```bash
docker compose exec api sh -c \
  'test -n "$OPENAI_API_KEY" && echo OPENAI_API_KEY=set || echo OPENAI_API_KEY=missing'
```

Buat dua tiket dengan `subject` dan `message` identik. Jika enrichment pertama berhasil, kategori dan draf kedua tiket harus sama. Tiket kedua tetap dibuat; Redis hanya mencegah pemanggilan LLM kedua.

### Redis

```bash
docker compose exec -T redis redis-cli --scan \
  --pattern 'goodeva:classification:v1:*'
```

Key akan muncul setelah minimal satu hasil LLM valid disimpan dalam cache.

## Pengujian Python NLP

Lokal:

```bash
python3 -m unittest discover -s python/tests -v

python3 python/entity_extractor.py --pretty --text \
  'Contact alice@example.com or +62 812-3456-7890. Invoice INV-2048 is missing.'
```

Docker:

```bash
docker compose --profile nlp run --rm nlp --pretty --text \
  'Contact docker@example.com. Order ABC-123 is missing.'
```

Mengambil tiket dari API:

```bash
export GOODEVA_API_KEY=demo-org-key

docker compose --profile nlp run --rm nlp \
  --ticket-id "$TICKET_ID" \
  --pretty
```

## Pemecahan Masalah Smoke Test

### API Tidak Dapat Dijangkau

```bash
docker compose ps
docker compose logs --tail=100 api
curl http://localhost:3000/health
```

### Pengujian Isolasi Tenant Dilewati

Pengujian dengan organisasi sementara membutuhkan container PostgreSQL yang aktif. Jalankan:

```bash
docker compose up -d --wait db redis api
./scripts/smoke-test.sh
```

### Container NLP Tidak Dapat Dibangun

```bash
docker compose --profile nlp build nlp
docker compose --profile nlp run --rm nlp --help
```

### Mempertahankan Data Smoke Test

```bash
CLEANUP=false ./scripts/smoke-test.sh
```

## Rangkaian Uji

```bash
npm test
npm run test:python
npm run test:cov
npm run build
```

Jalur smoke test manual dan otomatis dijelaskan pada bagian atas dokumen ini.
