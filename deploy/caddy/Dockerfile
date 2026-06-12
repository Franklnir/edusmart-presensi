FROM caddy:2.11.2-builder-alpine AS builder

RUN xcaddy build v2.11.2 \
    --with github.com/corazawaf/coraza-caddy/v2@v2.5.0

FROM caddy:2.11.2-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
