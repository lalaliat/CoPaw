export interface InboxSummary {
  approvals: {
    total: number;
    urgent: number;
  };
  pushMessages: {
    total: number;
    unread: number;
  };
  harvests: {
    total: number;
    active: number;
    unread: number;
  };
}

export interface PushMessage {
  id: string;
  channelType:
    | "wechat"
    | "slack"
    | "telegram"
    | "discord"
    | "email"
    | "heartbeat";
  channelName: string;
  title: string;
  content: string;
  sender: {
    userId: string;
    username: string;
  };
  createdAt: Date;
  read: boolean;
  metadata?: {
    priority?: "low" | "normal" | "high" | "urgent";
    sourceType?: string;
    sourceId?: string;
    eventType?: string;
    status?: string;
    severity?: string;
    trigger?: string;
    durationMs?: number;
    agentId?: string;
    payload?: Record<string, unknown>;
  };
}

export interface HarvestInstance {
  id: string;
  name: string;
  emoji: string;
  cron: string;
  timezone: string;
  requestText: string;
  enabled: boolean;
  status: "active" | "paused" | "error";
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  lastRunStatus?: "success" | "error" | "running" | "skipped" | "cancelled";
  latestOutputTitle?: string;
  latestOutputBody?: string;
  latestOutputRunId?: string;
  stats: {
    totalGenerated: number;
    successRate: number;
  };
}

export interface HarvestExecution {
  id: string;
  runId?: string;
  title: string;
  body: string;
  status: string;
  createdAt: Date;
  trigger?: string;
  read: boolean;
}

export interface HarvestUpsertPayload {
  id?: string;
  name: string;
  cron: string;
  timezone: string;
  requestText: string;
}

export interface ApprovalItem {
  id: string;
  type: "tool_call" | "config_change" | "file_access";
  title: string;
  description: string;
  requestedBy: string;
  requestedAt: Date;
  priority: "low" | "normal" | "high" | "urgent";
  status: "pending" | "approved" | "rejected";
}

export interface HarvestTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  estimatedReadTime: number;
  defaultSchedule: {
    cron: string;
    timezone: string;
  };
}
