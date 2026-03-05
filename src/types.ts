// --- Core Enums ---
export enum ServiceType {
  FS = 'service.fs',
  EXECUTOR = 'service.executor',
  TEMPO = 'service.tempo',
  LLM_BROKER = 'service.llm.broker',
  LLM_ADAPTER = 'service.llm.adapter',
  MCP_BRIDGE = 'service.mcp.bridge',
  WEB_HOST = 'service.web'
}

export enum FSScope {
  SYSTEM = 'system',
  AGENT = 'agent',
  ARTIFACT = 'artifact'
}

// --- JetStream KV Schemas ---
export interface RegistryEntry {
  type: ServiceType;
  name: string;
  uuid: string;
  first_seen: string; // ISO8601
}

export interface StatusEntry {
  status: 'online' | 'offline' | 'auth_required' | 'error';
  load: number; // 0-100
  capabilities: string[]; // e.g., ["read", "write"] or ["gpt-4o", "claude-3.5"]
  alerts: Array<{
    type: string;
    provider?: string;
    code?: string;
    url?: string;
    message?: string;
  }>;
  last_seen: string; // ISO8601
}

// --- Handshake Payload ---
export interface HandshakeRequest {
  type: ServiceType;
  name: string;
}
export interface HandshakeResponse {
  uuid: string;
}

// --- Librarian (FS) Payloads ---
export interface FSReadRequest {
  scope: FSScope;
  path: string;
  agent_id?: string;
}
export interface FSWriteRequest extends FSReadRequest {
  content: string;
}
export interface FSListRequest extends FSReadRequest {}

export interface FSResponse {
  status: 'success' | 'error';
  content?: string;
  files?: string[];
  error?: string;
}

// --- Executor Payloads ---
export interface SpawnRequest {
  agent_id: string;
  entrypoint: string;
  env?: Record<string, string>;
}
export interface KillRequest {
  agent_id: string;
  signal?: 'SIGTERM' | 'SIGKILL';
}

// --- Inference Payloads ---
export interface InferenceMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}
export interface InferenceRequest {
  model: string;
  temperature: number;
  messages: InferenceMessage[];
  tools?: any[];
}
export interface InferenceResponse {
  status: 'success' | 'error';
  content?: string;
  tool_calls?: any[];
  error?: string;
}

// --- MCP Payloads ---
export interface MCPCallRequest {
  arguments: Record<string, any>;
}

export interface MCPCallResponse {
  status: 'success' | 'error';
  result?: any;
  error?: string;
}
