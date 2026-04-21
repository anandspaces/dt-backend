FROM oven/bun:1.3 AS base
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY src ./src

ENV NODE_ENV=production
EXPOSE 4000

CMD ["sh", "-c", "mkdir -p /data/uploads && bun run db:migrate && bun run start"]
