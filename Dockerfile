FROM node:20-slim

# Install NATS server
RUN apt-get update && apt-get install -y curl && \
    curl -L https://github.com/nats-io/nats-server/releases/download/v2.10.12/nats-server-v2.10.12-linux-amd64.tar.gz | tar xz && \
    mv nats-server-v2.10.12-linux-amd64/nats-server /usr/local/bin/ && \
    rm -rf nats-server-v2.10.12-linux-amd64

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json tsconfig.json ./
RUN npm install

# Copy source code
COPY src ./src
COPY nats.conf ./
COPY entrypoint.sh ./

RUN chmod +x entrypoint.sh

# Environment variables
ENV NATS_URL=nats://localhost:4222
ENV HTTP_PORT=7070

# Data volume
VOLUME /data

# Ports
EXPOSE 7070 4222 8080

ENTRYPOINT ["./entrypoint.sh"]
