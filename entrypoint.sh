#!/bin/bash
set -e

# Start NATS server in the background
nats-server -p 4222 &

# Wait for NATS to be ready
until nats-server --ping; do
  echo "Waiting for NATS server..."
  sleep 1
done

echo "NATS server is up."

# Start Node runtime
exec npx ts-node src/runtime/index.ts
