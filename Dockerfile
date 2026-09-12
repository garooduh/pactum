FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS api
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app DATA_DIR=/data TEMPLATES_DIR=/app/templates
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home --uid 10001 pact && mkdir /data && chown pact:pact /data
COPY backend/app ./app
COPY templates/*-v*.docx templates/manifest.json ./templates/
COPY scripts/password_hash.py scripts/reset_password.py ./scripts/
USER pact
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]

FROM caddy:2-alpine AS gateway
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /web/dist /srv
