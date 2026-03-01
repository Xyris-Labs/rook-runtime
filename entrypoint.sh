#!/bin/bash
set -e

# Start NATS server in the background
nats-server -p 4222 &

# Wait for NATS to be ready
while ! (echo > /dev/tcp/localhost/4222) >/dev/null 2>&1; do
  echo "Waiting for NATS server on port 4222..."
  sleep 1
done

echo "NATS server is up."

# Start Node runtime
exec npx ts-node src/runtime/index.ts
