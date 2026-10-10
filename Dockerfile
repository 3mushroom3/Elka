# Образ приложения. Сборка: docker compose build
FROM node:22-bookworm-slim

# openssl нужен движку Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads /app/.next
USER node
EXPOSE 3000

# При каждом запуске: применить миграции, создать менеджера и справочник (если их нет), стартовать
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npx next start -p 3000"]
