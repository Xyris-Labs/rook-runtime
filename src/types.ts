export interface Envelope {
  id: string;
  ts: string;
  type: 'UserMessage' | 'Tick' | 'CronFire' | 'ToolRequest' | 'ToolResult' | 'AgentOutput' | 'AgentReady' | 'RuntimeReady';
  from: string;
  to: string;
  agent?: string;
  session_id?: string;
  correlation_id?: string;
  payload: any;
}

export interface AgentConfig {
  id: string;
  name: string;
  enabled: boolean;
  inbox: string;
  path: string;
}

export interface ScheduleEntry {
  id: string;
  agent: string;
  type: 'interval' | 'cron';
  value: string | number; // seconds for interval, expression for cron
  enabled: boolean;
}

export const SUBJECTS = {
  RUNTIME: {
    READY: 'runtime.ready'
  },
  AGENT: {
    INBOX: (name: string) => `agent.${name}.inbox`,
    READY: (name: string) => `agent.${name}.ready`
  },
  INGRESS: {
    MESSAGE: 'ingress.ui.message',
    COMMAND: 'ingress.ui.command'
  },
  EGRESS: {
    RENDER: 'egress.ui.render',
    NOTIFY: 'egress.ui.notify'
  },
  TOOL: {
    FS: {
      READ: 'tool.fs.read',
      WRITE: 'tool.fs.write',
      LIST: 'tool.fs.list',
      PATCH: 'tool.fs.patch'
    },
    AGENT: {
      LIST: 'tool.agent.list',
      CREATE: 'tool.agent.create',
      UPDATE: 'tool.agent.update',
      ENABLE: 'tool.agent.enable',
      DISABLE: 'tool.agent.disable'
    },
    SCHEDULE: {
      LIST: 'tool.schedule.list',
      CREATE: 'tool.schedule.create',
      UPDATE: 'tool.schedule.update',
      DELETE: 'tool.schedule.delete'
    }
  }
};
