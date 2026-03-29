#!/bin/bash
set -e

# Wait for NATS to be ready
# We use the NATS_URL environment variable to find where it is
NATS_HOST=$(echo $NATS_URL | sed -e 's/nats:\/\///' -e 's/:.*//')
NATS_PORT=$(echo $NATS_URL | sed -e 's/.*://')

if [ -z "$NATS_HOST" ]; then
  NATS_HOST="localhost"
fi
if [ -z "$NATS_PORT" ]; then
  NATS_PORT="4222"
fi

echo "Waiting for NATS server at $NATS_HOST:$NATS_PORT..."
while ! (echo > /dev/tcp/$NATS_HOST/$NATS_PORT) >/dev/null 2>&1; do
  sleep 1
done

echo "NATS server is up."

# Start Node runtime
exec npx ts-node src/runtime/index.ts
