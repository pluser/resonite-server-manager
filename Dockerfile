# ---- Build stage ----
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---- Production stage ----
FROM node:22-slim

# Install systemctl so we can talk to the host's systemd via D-Bus
RUN apt-get update \
    && apt-get install -y --no-install-recommends systemd dbus \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ ./dist/

ENV NODE_ENV=production
# Skip sudo inside the container; systemctl talks to host systemd via D-Bus
ENV SYSTEMCTL_NO_SUDO=1

CMD ["node", "dist/index.js"]
