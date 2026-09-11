# Root Dockerfile for Antigravity Remote Agent Cloud Daemon
FROM golang:1.23-alpine AS builder

WORKDIR /src

ENV GOTOOLCHAIN=auto

RUN apk add --no-cache git ca-certificates

COPY remote/daemon/go.mod remote/daemon/go.sum ./
RUN go mod download

COPY remote/daemon/ .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w -X main.version=2.5.0-cloud" \
    -o /out/daemon .

FROM alpine:3.20

RUN apk add --no-cache \
    git \
    openssh-client \
    curl \
    ca-certificates \
    tzdata \
    bash

RUN curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared

WORKDIR /app

COPY --from=builder /out/daemon /app/daemon

ENV PORT=8090 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TUNNEL=cloudflare

EXPOSE 8090 41234/udp

VOLUME ["/data"]

ENTRYPOINT ["/app/daemon"]
CMD ["--port", "8090", "--host", "0.0.0.0", "--tunnel", "cloudflare"]
