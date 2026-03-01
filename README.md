# HermitTools v0 Runtime

LevraTech v0 Runtime (HermitTools) is a local, single-container appliance for running multi-agent systems with file-backed state and NATS communication.

## Features
- **Parallel Multi-Agent**: Multiple agents running in isolated processes.
- **File-Backed State**: Everything lives in `/data`.
- **NATS Communication**: Agents communicate only via NATS.
- **Embedded NATS Server**: No external dependencies.
- **WebSocket Bridge**: Connect browser UI to NATS at `/_/nats`.
- **Interval & Cron Scheduler**: Trigger agents on schedule.

## Build and Run

### 1. Build the Docker Image
```bash
docker build -t hermit-v0 .
```

### 2. Run the Container
Mount a local folder to `/data` to persist state.
```bash
docker run -p 7070:7070 -p 4222:4222 -v $(pwd)/hermit_data:/data hermit-v0
```

## Accessing the UI
Open your browser to `http://localhost:7070`.

## Folder Structure (/data)
- `/system`: Core configuration (agents.json, schedules.json, etc.)
- `/system/agents/<name>`: Agent profile and persona.
- `/system/agents/<name>/memory`: Agent's private scratchpad.
- `/artifacts`: Large output files.
- `/cache`: Disposable files.

## How to Add an Agent
You can add an agent via the UI by clicking "Create Agent 'jerry'" or by sending a NATS request to `tool.agent.create`.

### Example (using NATS CLI):
```bash
nats request tool.agent.create '{
  "id": "jerry",
  "name": "jerry",
  "enabled": true,
  "inbox": "agent.jerry.inbox",
  "path": "/data/system/agents/jerry"
}'
```

## Persona Files
Edit the files under `/data/system/agents/<agentName>/persona/`:
- `persona.md`: Define the agent's identity.
- `principles.md`: Define operating guidelines.
- `examples.md`: Provide few-shot examples.

## Limitations
- **Security**: Explicitly skipped in v0. All subjects are open.
- **LLM**: v0 uses a placeholder "brain" that echoes input and updates memory.
- **JetStream**: Disabled. Pub/Sub is ephemeral.
