# RookTools v0 Runtime

LevraTech v0 Runtime (RookTools) is a local, single-container appliance for running multi-agent systems with file-backed state and NATS communication.

## Features
- **Parallel Multi-Agent**: Multiple agents running in isolated processes.
- **File-Backed State**: Everything lives in `/data`.
- **NATS Communication**: Agents communicate only via NATS.
- **Embedded NATS Server**: No external dependencies.
- **WebSocket Bridge**: Connect browser UI to NATS at `/_/nats`.
- **Interval & Cron Scheduler**: Trigger agents on schedule.

## Technical Architecture

### Atomic Persistence
To ensure resilience against power loss or crashes, the Runtime implements **Atomic Persistence** for core system configuration files (`agents.json` and `schedules.json`).
- Changes are first written to a temporary file (`.tmp`).
- The temporary file is then atomically renamed to the target filename.
- This ensures the configuration is never in a partially-written state.

### Memory/System Boundary
- **System Config**: Uses atomic renames (as described above) to protect the "constitution" of the runtime.
- **Agent Memory**: Writes to `/data/system/agents/*/memory/` utilize standard, non-atomic file operations. This provides "best-effort" performance for frequent agent updates (thoughts/scratchpads) where high-frequency throughput is prioritized over absolute atomic guarantees.

### Unified Data Mount (Single Mount)
All runtime assets, including the UI, live in the `/data` mount.
- `/data/ui`: The interface directory, which is served by the runtime.
- `/data/system`: Core configuration and agent definitions.
- The runtime watches `/data/system` for changes and automatically reloads configuration.

## Development Workflow: React Cockpit

The project includes a React-based UI called the **Cockpit** located in `/ui-cockpit`.

### To Update the UI:
1. Navigate to the `ui-cockpit` folder:
   ```bash
   cd ui-cockpit
   ```
2. Install dependencies (first time only):
   ```bash
   npm install
   ```
3. Build and deploy:
   ```bash
   npm run build
   ```
   This will automatically build the React application and deploy it into `rook_data/ui/` (mapped to `/data/ui/` in the container).

## Build and Run

### 1. Build the Docker Image
```bash
docker build -t rook-v0 .
```

### 2. Run the Container
Mount a local folder to `/data` to persist state and UI.
```bash
docker run -p 7070:7070 -p 4222:4222 -v $(pwd)/rook_data:/data rook-v0
```

## Accessing the UI
Open your browser to `http://localhost:7070`.

## Folder Structure (/data)
- `/ui`: Web interface assets (React Cockpit build).
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
