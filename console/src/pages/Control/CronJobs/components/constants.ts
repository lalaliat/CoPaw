import dayjs, { type Dayjs } from "dayjs";
import type {
  CronJobDispatch,
  CronJobSchedule,
  CronJobSpecOutput,
} from "../../../../api/types";

export type CronJobFormValues = {
  id?: string;
  name?: string;
  enabled?: boolean;
  save_result_to_inbox?: boolean;
  scheduleType: "cron" | "once";
  schedule: CronJobSchedule;
  onceRunAt?: Dayjs | null;
  onceRepeatEnabled?: boolean;
  onceRepeatEveryDays?: number;
  onceRepeatEndType?: "never" | "until" | "count";
  onceRepeatUntil?: Dayjs | null;
  onceRepeatCount?: number;
  cronType?: string;
  cronTime?: Dayjs;
  cronDaysOfWeek?: string[];
  cronCustom?: string;
  task_type?: CronJobSpecOutput["task_type"];
  text?: string;
  request?: {
    input?: string;
    session_id?: string;
    user_id?: string;
  };
  script?: {
    path?: string;
    args?: string;
    interpreter?: string;
    cwd?: string;
  };
  dispatch?: CronJobDispatch | null;
  runtime?: CronJobSpecOutput["runtime"];
  meta?: Record<string, object | undefined>;
};

export const DEFAULT_FORM_VALUES: CronJobFormValues = {
  enabled: false,
  save_result_to_inbox: true,
  scheduleType: "cron",
  schedule: {
    type: "cron",
    cron: "0 9 * * *",
    timezone: "UTC",
  },
  onceRunAt: dayjs().add(1, "hour"),
  onceRepeatEnabled: false,
  onceRepeatEveryDays: 1,
  onceRepeatEndType: "never",
  onceRepeatUntil: dayjs().add(7, "day"),
  onceRepeatCount: 2,
  cronType: "daily",
  cronTime: dayjs().hour(9).minute(0),
  task_type: "agent",
  request: {
    input: "",
    session_id: "",
    user_id: "",
  },
  text: "",
  script: {
    path: "",
    args: "[]",
    interpreter: "auto",
    cwd: "",
  },
  dispatch: {
    type: "channel",
    channel: "console",
    target: {
      user_id: "",
      session_id: "",
    },
    mode: "final",
  },
  runtime: {
    share_session: true,
    max_concurrency: 1,
    timeout_seconds: 120,
    misfire_grace_seconds: 60,
  },
};
