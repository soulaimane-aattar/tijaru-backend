# Stock — backend (NestJS + Kysely). Multi-stage. DB schema is applied by sqitch (`make db-up`), not on boot.

# ─── builder ───────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

# python3/make/g++: native deps (bcrypt) compile.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── runner ────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Full node_modules + src + tsconfig: `npm run seed` runs prisma/seed.ts.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 3000

# Optionally seed demo data (SEED_DEMO=true), then serve.
CMD ["sh", "-c", "if [ \"$SEED_DEMO\" = \"true\" ]; then npm run seed; fi && node dist/src/main.js"]
