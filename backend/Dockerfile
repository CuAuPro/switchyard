FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json ./
COPY src ./src
RUN pnpm run build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
RUN apk add --no-cache docker-cli
COPY --from=base /app/package.json ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
