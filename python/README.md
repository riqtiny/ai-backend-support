# Helper Python NLP

Ekstraktor entitas ringan untuk tiket dukungan GoodevaDesk.

Dokumentasi lengkap tersedia di [`../docs/python-nlp.md`](../docs/python-nlp.md).

Mulai cepat dari folder `python`:

```bash
python3 entity_extractor.py --pretty --text \
  'Contact alice@example.com or +62 812-3456-7890. Invoice INV-2048 is missing.'
```

Helper inti hanya menggunakan pustaka standar Python dan tidak memerlukan unduhan model.

Jalankan dengan Docker Compose dari root repositori:

```bash
docker compose --profile nlp run --rm nlp --pretty --text \
  'Contact alice@example.com or +62 812-3456-7890.'
```

Untuk mengambil dan menganalisis tiket dari API, lihat [dokumentasi NLP](../docs/python-nlp.md#3-mengambil-tiket-dari-api).
