FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json ./
COPY src ./src
RUN pnpm run build
RUN pnpm prune --prod --ignore-scripts

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache docker-cli
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
