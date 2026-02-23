FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
ENV PNPM_AUTO_INSTALL_PEERS=false
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
COPY tsconfig*.json ./
COPY src ./src
RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm exec prisma generate
RUN pnpm prune --prod --ignore-scripts
RUN rm -rf \
  /app/node_modules/prisma \
  /app/node_modules/swagger-ui-express \
  /app/node_modules/.pnpm/swagger-ui-express@* \
  /app/node_modules/.pnpm/swagger-ui-dist@* \
  /app/node_modules/.pnpm/yaml@* \
  /app/node_modules/.pnpm/prisma@* \
  /app/node_modules/.pnpm/@prisma+engines@* \
  /app/node_modules/.pnpm/@prisma+fetch-engine@* \
  /app/node_modules/.pnpm/@prisma+get-platform@* \
  /app/node_modules/.pnpm/@prisma+dev@* \
  /app/node_modules/.pnpm/@prisma+studio* \
  /app/node_modules/.pnpm/effect@* \
  /app/node_modules/.pnpm/@electric-sql* \
  /app/node_modules/.pnpm/typescript@* \
  /app/node_modules/.pnpm/react@* \
  /app/node_modules/.pnpm/react-dom@* \
  /app/node_modules/.pnpm/@types+react@*

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache docker-cli
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
ENV ENABLE_API_DOCS=false
CMD ["node", "dist/server.js"]
