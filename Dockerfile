FROM node:22-alpine AS base
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://medilink:medilink@localhost:5432/medilink?schema=public
ENV AUTH_SECRET=replace-with-long-random-secret

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile
RUN pnpm prisma generate

COPY . .

RUN pnpm build

EXPOSE 3000
EXPOSE 8070
