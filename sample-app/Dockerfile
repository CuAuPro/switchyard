# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src
RUN pnpm build

# --- runtime stage ---
FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4001

COPY --from=build /app/dist/index.js ./index.js

USER nonroot
CMD ["index.js"]