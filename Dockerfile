# Stock — backend (NestJS + Prisma). Multi-stage.

# ─── builder ───────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

# openssl: Prisma engines. python3/make/g++: native deps (bcrypt) compile.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate \
  && npm run build

# ─── runner ────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Full node_modules + src + tsconfig: prisma db seed runs ts-node prisma/seed.ts.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

# Apply migrations, optionally seed demo data (SEED_DEMO=true), then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_DEMO\" = \"true\" ]; then npx prisma db seed; fi && node dist/src/main.js"]
