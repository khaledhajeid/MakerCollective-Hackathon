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
# The stock binary carries the file capability cap_net_bind_service, which cannot start in a container that runs as
# a normal user with no capabilities. A plain copy drops that attribute; binding port 80 is allowed instead by a
# sysctl on this container only (docker-compose.yml).
RUN cp /usr/bin/caddy /usr/local/bin/caddy
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
CMD ["/usr/local/bin/caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
