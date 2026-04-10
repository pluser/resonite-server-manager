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

# Install busctl so we can talk to the host's systemd via the mounted D-Bus socket.
# busctl is part of the systemd package; it does not require PID 1 to be systemd,
# unlike systemctl which refuses to run inside a container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends systemd \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ ./dist/

ENV NODE_ENV=production
# Use busctl (D-Bus) instead of sudo+systemctl inside the container
ENV SYSTEMCTL_NO_SUDO=1

CMD ["node", "dist/index.js"]
