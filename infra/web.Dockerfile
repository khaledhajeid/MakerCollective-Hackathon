# syntax=docker/dockerfile:1
# Builds the SPA and bakes it into Caddy (edge: TLS-less origin behind the tunnel, LB, static files).
FROM node:24-alpine AS build
RUN npm install -g pnpm@11.14.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@mc/web..."
COPY packages/shared packages/shared
COPY apps/web apps/web
# The SPA imports runtime helpers from @mc/shared (digits), so the package must be compiled first.
RUN pnpm --filter @mc/shared build && pnpm --filter @mc/web build

FROM caddy:2-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
