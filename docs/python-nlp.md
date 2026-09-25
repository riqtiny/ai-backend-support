# Python NLP: Ekstraksi Entitas

GoodevaDesk menyediakan helper Python opsional untuk mengekstraksi entitas dari pesan tiket dukungan. Helper ini mengambil data yang umum dibutuhkan tim support:

- Alamat email.
- Nomor telepon.
- URL.
- Nomor referensi seperti `INV-2048`, `ORDER-123`, atau `CASE: ABC123`.
- Nominal dan mata uang seperti `Rp125.000` atau `$20.00`.

Helper berada di `python/entity_extractor.py` dan hanya menggunakan pustaka standar Python. Karena itu, helper tidak memerlukan unduhan model atau GPU.

## Kebutuhan Sistem

- Python 3.10+
- GoodevaDesk API yang sedang berjalan saat menggunakan mode pengambilan dari API
- `GOODEVA_API_KEY` hanya diperlukan untuk mode pengambilan dari API

## Instalasi

Jalankan dari root repositori:

```bash
cd python
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cd ..
```

Ekstraktor inti tidak memiliki dependensi pihak ketiga. File `requirements.txt` disediakan agar dependensi tambahan dapat ditambahkan tanpa mengubah kontrak CLI.

## Menjalankan dengan Docker Compose

Container `nlp` adalah utilitas satu kali dan menggunakan profil `nlp`:

```bash
# Dari root repositori
docker compose up --build -d --wait
docker compose --profile nlp build nlp

docker compose --profile nlp run --rm nlp --pretty --text \
  'Invoice INV-2048 for Rp125.000 is missing. Contact alice@example.com.'
```

Untuk mode API, pastikan stack API berjalan atau izinkan Compose menjalankan dependensi yang diperlukan:

```bash
docker compose --profile nlp run --rm nlp \
  --ticket-id "32c07686-20be-4c9b-b43b-6a5a9507c860" \
  --pretty
```

Service `nlp` membaca `GOODEVA_API_KEY` dari `.env` dan diarahkan otomatis ke service internal `http://api:3000`. Pastikan `GOODEVA_API_KEY` milik organisasi yang ada; nilai contoh pada `.env.example` adalah `demo-org-key`.

## 1. Menganalisis Teks Mentah

```bash
python3 python/entity_extractor.py --pretty --text \
  'Invoice INV-2048 for Rp125.000 is missing. Contact alice@example.com or +62 812-3456-7890.'
```

Contoh output:

```json
{
  "ticket_id": null,
  "subject": null,
  "category": null,
  "text_length": 90,
  "entities": {
    "emails": ["alice@example.com"],
    "phones": ["+62 812-3456-7890"],
    "urls": [],
    "references": ["INV-2048"],
    "amounts": ["Rp125.000"]
  }
}
```

## 2. Menganalisis File JSON

File JSON dapat berisi satu objek tiket:

```json
{
  "id": "32c07686-20be-4c9b-b43b-6a5a9507c860",
  "subject": "Permintaan invoice",
  "message": "Saya tidak menemukan invoice INV-2048. Hubungi saya di customer@example.com.",
  "customerEmail": "customer@example.com",
  "category": "billing"
}
```

Jalankan:

```bash
python3 python/entity_extractor.py \
  --input python/examples/ticket.json \
  --pretty
```

Skrip juga menerima array JSON untuk pemrosesan batch.

## 3. Mengambil Tiket dari API

Gunakan API key GoodevaDesk, bukan API key OpenAI:

```bash
export GOODEVA_API_KEY=demo-org-key
export GOODEVA_API_URL=http://localhost:3000

python3 python/entity_extractor.py \
  --ticket-id "32c07686-20be-4c9b-b43b-6a5a9507c860" \
  --pretty
```

Perintah tersebut melakukan:

```http
GET /tickets/:id
x-api-key: demo-org-key
```

## 4. Mengalirkan Respons API ke Ekstraktor

```bash
curl "http://localhost:3000/tickets" \
  -H "x-api-key: demo-org-key" \
  | python3 python/entity_extractor.py --pretty
```

Untuk menyimpan hasil ke file:

```bash
curl "http://localhost:3000/tickets" \
  -H "x-api-key: demo-org-key" \
  | python3 python/entity_extractor.py \
      --output /tmp/ticket-entities.json

cat /tmp/ticket-entities.json
```

## 5. Pemrosesan Batch dari File

```bash
curl "http://localhost:3000/tickets" \
  -H "x-api-key: demo-org-key" \
  > /tmp/tickets.json

python3 python/entity_extractor.py \
  --input /tmp/tickets.json \
  --output /tmp/ticket-entities.json \
  --pretty
```

## Kontrak Keluaran

Untuk satu tiket, output berisi:

- `ticket_id`: ID tiket jika tersedia.
- `subject`: subjek tiket jika tersedia.
- `category`: kategori LLM jika tersedia.
- `text_length`: panjang teks yang diproses.
- `entities`: entitas yang berhasil diekstraksi.

Pesan mentah tidak disertakan dalam output default untuk mengurangi risiko menyalin data sensitif. Meskipun demikian, subjek dan entitas tetap dapat mengandung data pribadi, sehingga output harus ditangani sebagai data sensitif.

## Menjalankan Test

```bash
python3 -m unittest discover -s python/tests -v
```

Test mencakup email, telepon, URL, referensi, nominal, penyaringan tanggal, dan field `customerEmail`.

## Keterbatasan dan Privasi

- Ekstraksi berbasis regex bersifat heuristik dan dapat menghasilkan positif palsu.
- Format telepon dan nominal bergantung pada locale.
- Skrip tidak mengirim data ke model eksternal.
- Jangan commit dump tiket mentah atau API key.
- Untuk produksi, tambahkan redaksi, daftar izinkan output, kontrol akses, dan kebijakan retensi data.
- Helper ini bukan pengganti verifikasi manual untuk keputusan yang berisiko tinggi.

## Ekstensi Selanjutnya

Helper sengaja dibuat ringan. Kontrak CLI yang sama dapat dikembangkan untuk:

- spaCy untuk named-entity recognition.
- Hugging Face zero-shot NLI untuk membandingkan prediksi kategori dengan hasil LLM.
- Penyimpanan entitas hasil ekstraksi ke database atau workflow support.
- Confidence score dan review queue untuk entitas yang meragukan.
