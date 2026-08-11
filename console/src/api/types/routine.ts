import type {
  CronJobDispatch,
  CronJobRuntime,
  CronJobSchedule,
} from "./cronjob";

export interface RoutineSpec {
  id?: string;
  name: string;
  description?: string | null;
  prompt: string;
  enabled?: boolean;
  tool_mode: "all" | "custom";
  allowed_tools: string[];
  schedule_trigger?: {
    enabled: boolean;
    schedule: CronJobSchedule;
  } | null;
  api_trigger?: {
    enabled: boolean;
    token_hint?: string | null;
    requests_per_minute?: number;
    max_pending_runs?: number;
    max_request_size_kb?: number;
  } | null;
  trigger_logic: "or" | "and";
  isolate_session: boolean;
  dispatch: CronJobDispatch;
  save_result_to_inbox: boolean;
  runtime?: CronJobRuntime;
  created_at?: string | null;
  updated_at?: string | null;
}

export type RoutineRunStatus =
  | "queued"
  | "running"
  | "success"
  | "error"
  | "cancelled";

export interface RoutineRun {
  run_id: string;
  routine_id: string;
  trigger: "manual" | "scheduled" | "api";
  status: RoutineRunStatus;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  duration_seconds?: number | null;
  summary?: string | null;
  error?: string | null;
  session_id?: string | null;
  trace_id?: string | null;
  trigger_text?: string | null;
  trigger_data?: Record<string, unknown>;
}

export interface RoutineView {
  spec: RoutineSpec;
  last_run?: RoutineRun | null;
  next_run_at?: string | null;
  fire_path?: string | null;
}

export interface RoutineMutationResponse {
  routine: RoutineView;
  api_token?: string | null;
}

export interface RoutineFireResponse {
  status: "queued" | "pending";
  run_id?: string | null;
  duplicate?: boolean;
}
