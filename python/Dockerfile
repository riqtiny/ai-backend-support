FROM python:3.12-slim

WORKDIR /workspace

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY entity_extractor.py ./
COPY examples ./examples
COPY tests ./tests

ENTRYPOINT ["python", "entity_extractor.py"]
CMD ["--help"]
