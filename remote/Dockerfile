# Stage 1: Build
FROM golang:1.24-alpine AS builder

WORKDIR /src

RUN apk add --no-cache git ca-certificates

COPY daemon/go.mod daemon/go.sum ./
RUN go mod download

COPY daemon/ ./

# Compile statically with pure Go SQLite (modernc.org/sqlite)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /src/ag-agentd .

# Stage 2: Runtime
FROM alpine:3.20

RUN apk add --no-cache ca-certificates git curl bash docker-cli

WORKDIR /app

# Create persistent runtime data and workspace directories
RUN mkdir -p /data /workspaces

COPY --from=builder /src/ag-agentd /usr/local/bin/ag-agentd

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8090/health || exit 1

ENV AG_HOST="0.0.0.0" \
    AG_PORT="8090" \
    AG_DB_PATH="/data/runtime.db" \
    AG_WORKSPACES_DIR="/workspaces" \
    AG_SANDBOX="native" \
    AG_PROVIDER="auto" \
    AG_MODEL="" \
    AG_AUTH_TOKEN="" \
    AG_TUNNEL="local"

VOLUME ["/data", "/workspaces"]

ENTRYPOINT ["sh", "-c", "exec ag-agentd --mode=server --host=${AG_HOST} --port=${AG_PORT} --db-path=${AG_DB_PATH} --workspaces-dir=${AG_WORKSPACES_DIR} --sandbox=${AG_SANDBOX} --allow-public-bind --auth-token=${AG_AUTH_TOKEN:-none} --provider=${AG_PROVIDER} --model=${AG_MODEL} --tunnel=${AG_TUNNEL}"]
