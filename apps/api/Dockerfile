# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN pnpm install --no-frozen-lockfile

FROM dependencies AS api-builder
ARG DATABASE_URL=postgresql://itr:itr@localhost:5432/itr?schema=public
ENV DATABASE_URL=$DATABASE_URL
COPY . .
RUN pnpm db:generate \
 && pnpm --filter @itr/contracts build \
 && pnpm --filter @itr/database build \
 && pnpm --filter @itr/api build

FROM base AS api-runtime
ENV NODE_ENV=production
RUN apk add --no-cache tini
COPY --from=api-builder /app /app
RUN mkdir -p /app/storage/uploads /app/storage/reports \
 && chown -R node:node /app/storage
USER node
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/server.js"]
