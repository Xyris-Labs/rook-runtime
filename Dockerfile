# Build UI Cockpit
FROM node:20-slim AS ui-builder
WORKDIR /app/ui-cockpit
COPY ui-cockpit/package*.json ./
RUN npm install
COPY ui-cockpit/ ./
RUN npm run build

# Final Runtime Image
FROM node:20-slim

# Install dependencies for health checks and bash
RUN apt-get update && apt-get install -y bash curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy runtime package files and install dependencies
COPY package*.json tsconfig.json ./
RUN npm install

# Copy runtime source code
COPY src ./src
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Copy built UI to the expected data directory
# The runtime expects UI at /app/ui in containers
RUN mkdir -p /app/ui
COPY --from=ui-builder /app/ui-cockpit/dist /app/ui

# Environment variables
ENV NATS_URL=nats://localhost:4222
ENV HTTP_PORT=7070

# Data volume
VOLUME /data

# Ports
EXPOSE 7070 7071

ENTRYPOINT ["./entrypoint.sh"]
