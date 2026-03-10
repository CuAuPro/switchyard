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
  /app/node_modules/swagger-ui-express \
  /app/node_modules/.pnpm/swagger-ui-express@* \
  /app/node_modules/.pnpm/swagger-ui-dist@* \
  /app/node_modules/.pnpm/yaml@* \
  /app/node_modules/.pnpm/typescript@* \
  /app/node_modules/.pnpm/react@* \
  /app/node_modules/.pnpm/react-dom@* \
  /app/node_modules/.pnpm/@types+react@*

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache docker-cli
COPY ./hosts /app/hosts
COPY --from=build /app/package.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
ENV ENABLE_API_DOCS=false
CMD ["node", "dist/server.js"]
