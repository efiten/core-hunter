FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/ingestor ./cmd/ingestor

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/ingestor /ingestor
# Runs as uid 65532 (distroless nonroot). The mounted data volume must be
# writable by that uid (e.g. `chown 65532:65532` the host dir / named volume).
VOLUME ["/app/data"]
EXPOSE 8090
ENTRYPOINT ["/ingestor", "/app/config.json"]
