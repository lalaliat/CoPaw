export interface CronJobScheduleCron {
  type: "cron";
  cron: string;
  timezone?: string;
}

export interface CronJobScheduleOnce {
  type: "once";
  run_at: string;
  timezone?: string;
  repeat_every_days?: number;
  repeat_end_type?: "never" | "until" | "count";
  repeat_until?: string;
  repeat_count?: number;
}

export type CronJobSchedule = CronJobScheduleCron | CronJobScheduleOnce;

export interface CronJobTarget {
  user_id: string;
  session_id: string;
}

export interface CronJobDispatch {
  type: "channel";
  channel?: string;
  target: CronJobTarget;
  mode?: "stream" | "final";
  meta?: Record<string, object | undefined>;
}

export interface CronJobRuntime {
  max_concurrency?: number;
  timeout_seconds?: number;
  misfire_grace_seconds?: number;
  share_session?: boolean;
}

export interface CronJobRequest {
  input: unknown;
  session_id?: string | null;
  user_id?: string | null;
  [key: string]: unknown;
}

export interface CronJobScript {
  path: string;
  args?: string[];
  interpreter?: "auto" | "bash" | "sh" | "python" | "python3" | "node";
  cwd?: string | null;
}

export interface CronJobSpecInput {
  id: string;
  name: string;
  enabled?: boolean;
  save_result_to_inbox?: boolean;
  schedule: CronJobSchedule;
  task_type?: "text" | "agent" | "script";
  text?: string;
  request?: CronJobRequest;
  script?: CronJobScript;
  dispatch?: CronJobDispatch | null;
  runtime?: CronJobRuntime;
  meta?: Record<string, unknown>;
}

export type CronJobSpecOutput = CronJobSpecInput;

export interface CronJobView extends CronJobSpecOutput {
  // Extended view with runtime state
  state?: unknown;
  next_run_time?: number;
  last_run_time?: number;
}

export interface CronJobExecutionRecord {
  run_at: string;
  status: "success" | "error" | "running" | "skipped" | "cancelled";
  error?: string | null;
  trigger?: "scheduled" | "manual";
}

export interface CronDispatchTargetItem {
  channel: string;
  user_id: string;
  session_id: string;
}

export interface CronDispatchTargetsResponse {
  channels: string[];
  items: CronDispatchTargetItem[];
}

export type CronJobSpecInputLegacy = Record<string, unknown>;
export type CronJobSpecOutputLegacy = Record<string, unknown>;
export type CronJobViewLegacy = Record<string, unknown>;
