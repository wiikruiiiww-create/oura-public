# Контейнер моста OURA (B4). Контекст сборки — корень репозитория:
#   docker build -f services/oura-bridge/Dockerfile .
# Этап 1 собирает прод-бинарь buzz-cli из workspace, этап 2 — Node-рантайм
# моста (tsx поверх исходников, как и вне контейнера).

FROM rust:1.95-bookworm AS cli-builder
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates ./crates
RUN cargo build --release -p buzz-cli

FROM node:24-bookworm-slim
RUN corepack enable
WORKDIR /app
# Манифесты всех workspace-пакетов нужны pnpm для проверки frozen-lockfile;
# исходники — только у моста.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches ./patches
COPY desktop/package.json ./desktop/package.json
COPY web/package.json ./web/package.json
COPY admin-web/package.json ./admin-web/package.json
COPY services/oura-bridge ./services/oura-bridge
RUN pnpm install --frozen-lockfile --filter @oura/bridge
COPY --from=cli-builder /src/target/release/buzz /usr/local/bin/buzz
RUN mkdir -p /data && chown node:node /data
ENV OURA_BUZZ_BIN=/usr/local/bin/buzz \
    OURA_STATE_FILE=/data/bridge.state.json \
    OURA_HEARTBEAT_FILE=/data/heartbeat
VOLUME /data
USER node
WORKDIR /app/services/oura-bridge
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
