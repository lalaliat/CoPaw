import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import type { InboxEvent } from "../../../api/modules/console";
import type {
  CronJobExecutionRecord,
  CronJobSpecOutput,
} from "../../../api/types";
import { useAgentStore } from "../../../stores/agentStore";
import {
  DEFAULT_AGENT_ID,
  getAgentDisplayName,
} from "../../../utils/agentDisplayName";
import type {
  HarvestExecution,
  HarvestInstance,
  HarvestUpsertPayload,
  InboxSummary,
  PushMessage,
} from "../types";

const PUSH_POLLING_INTERVAL_MS = 6000;
const HARVEST_UNREAD_POLLING_INTERVAL_MS = 6000;
const HARVEST_EMOJIS = ["🚀", "📊", "🏢", "🎓", "💼", "🧠", "🛰️", "🧪"];

const mapPriority = (text: string): "low" | "normal" | "high" | "urgent" => {
  if (text.includes("❌") || text.toLowerCase().includes("error")) {
    return "high";
  }
  return "normal";
};

const stripExecutionTimeText = (text: string): string =>
  text.replace(/\s*duration=\d+ms\.?/gi, "").trim();

const getHeartbeatSummary = (status?: string): string => {
  const normalizedStatus = (status || "").toLowerCase();
  if (normalizedStatus === "success") {
    return "Heartbeat 执行成功";
  }
  if (normalizedStatus === "timeout") {
    return "Heartbeat 执行超时";
  }
  if (normalizedStatus === "cancelled") {
    return "Heartbeat 已取消";
  }
  return "Heartbeat 执行失败";
};

const mapEventToPushMessage = (
  event: InboxEvent,
  resolveAgentName: (agentId: string) => string,
): PushMessage => ({
  id: event.id,
  channelType:
    event.source_type === "heartbeat"
      ? "heartbeat"
      : event.source_type === "cron"
      ? "wechat"
      : "email",
  channelName:
    event.source_type === "heartbeat"
      ? "Heartbeat"
      : event.source_type === "cron"
      ? "Cron"
      : "System",
  title: event.title,
  content:
    event.source_type === "heartbeat"
      ? getHeartbeatSummary(event.status)
      : stripExecutionTimeText(event.body),
  sender: {
    userId: event.agent_id || "default",
    username: resolveAgentName(event.agent_id || DEFAULT_AGENT_ID),
  },
  createdAt: new Date((event.created_at || Date.now() / 1000) * 1000),
  read: Boolean(event.read),
  metadata: {
    priority:
      event.severity === "error" || event.status === "error"
        ? "high"
        : mapPriority(event.body),
    sourceType: event.source_type,
    sourceId: event.source_id,
    eventType: event.event_type,
    status: event.status,
    severity: event.severity,
    trigger:
      typeof event.payload?.trigger === "string"
        ? (event.payload.trigger as string)
        : undefined,
    agentId: event.agent_id,
    payload:
      event.payload && typeof event.payload === "object"
        ? event.payload
        : undefined,
  },
});

const isHarvestCronJob = (job: CronJobSpecOutput): boolean =>
  Boolean(job.meta?.harvest) && job.task_type === "agent";

const getRequestText = (job: CronJobSpecOutput): string => {
  const input = job.request?.input;
  if (typeof input === "string") {
    return JSON.stringify(
      [
        {
          role: "user",
          content: [{ type: "text", text: input }],
        },
      ],
      null,
      2,
    );
  }
  if (input === null || input === undefined) return "";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
};

const toDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const calculateSuccessRate = (records: CronJobExecutionRecord[]): number => {
  if (!records.length) return 0;
  const successCount = records.filter((r) => r.status === "success").length;
  return Math.round((successCount / records.length) * 1000) / 10;
};

export const useInboxData = (options?: { pauseHarvestPolling?: boolean }) => {
  const { pauseHarvestPolling = false } = options || {};
  const { t } = useTranslation();
  const agents = useAgentStore((state) => state.agents);
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const resolveAgentName = useCallback(
    (agentId: string) => {
      const normalizedId = agentId || DEFAULT_AGENT_ID;
      const agent = agentsById.get(normalizedId);
      if (agent) {
        return getAgentDisplayName(agent, t);
      }
      if (normalizedId === DEFAULT_AGENT_ID) {
        return t("agent.defaultDisplayName");
      }
      return normalizedId;
    },
    [agentsById, t],
  );
  const resolveAgentNameRef = useRef(resolveAgentName);
  resolveAgentNameRef.current = resolveAgentName;
  const harvestSpecsRef = useRef<Record<string, CronJobSpecOutput>>({});

  const [summary, setSummary] = useState<InboxSummary>({
    approvals: { total: 0, urgent: 0 },
    pushMessages: { total: 0, unread: 0 },
    harvests: { total: 0, active: 0, unread: 0 },
  });
  const [pushMessages, setPushMessages] = useState<PushMessage[]>([]);
  const pushMessagesRef = useRef(pushMessages);
  pushMessagesRef.current = pushMessages;
  const [harvests, setHarvests] = useState<HarvestInstance[]>([]);
  const [harvestsLoading, setHarvestsLoading] = useState(false);

  const loadPushMessages = useCallback(async () => {
    try {
      const res = await api.getInboxEvents({ limit: 200 });
      const harvestIdSet = new Set(Object.keys(harvestSpecsRef.current));
      const events = [...(res?.events || [])].filter((event) =>
        ["cron", "heartbeat"].includes(event.source_type),
      );
      const nonHarvestEvents = events.filter(
        (event) =>
          !(
            event.source_type === "cron" &&
            (harvestIdSet.has(event.source_id || "") ||
              Boolean(event.payload?.harvest))
          ),
      );
      nonHarvestEvents.sort(
        (a, b) => (b.created_at || 0) - (a.created_at || 0),
      );
      const nextItems: PushMessage[] = nonHarvestEvents.map((event) =>
        mapEventToPushMessage(event, resolveAgentNameRef.current),
      );
      setPushMessages(nextItems);
      setSummary((prev) => ({
        ...prev,
        pushMessages: {
          total: nextItems.length,
          unread: nextItems.filter((m) => !m.read).length,
        },
      }));
    } catch (error) {
      console.error("Failed to fetch push inbox data", error);
    }
  }, []);

  const refreshHarvests = useCallback(async () => {
    setHarvestsLoading(true);
    try {
      const [jobs, cronEventsRes] = await Promise.all([
        api.listCronJobs(),
        api.getInboxEvents({ source_type: "cron", limit: 500 }),
      ]);
      const harvestJobs = (jobs || []).filter(isHarvestCronJob);
      const cronEvents = cronEventsRes?.events || [];
      const eventsBySourceId = new Map<string, InboxEvent[]>();
      cronEvents.forEach((event) => {
        const sourceId = event.source_id || "";
        const list = eventsBySourceId.get(sourceId);
        if (list) {
          list.push(event);
        } else {
          eventsBySourceId.set(sourceId, [event]);
        }
      });
      const [histories, states] = await Promise.all([
        Promise.all(
          harvestJobs.map((job) =>
            api.getCronJobHistory(job.id || "").catch(() => []),
          ),
        ),
        Promise.all(
          harvestJobs.map((job) =>
            api.getCronJobState(job.id || "").catch(() => null),
          ),
        ),
      ]);
      const nextHarvests = harvestJobs.map((job, index) => {
        const history = histories[index] || [];
        const state = states[index] as {
          next_run_at?: string;
          last_run_at?: string;
          last_status?:
            | "success"
            | "error"
            | "running"
            | "skipped"
            | "cancelled";
        } | null;
        const outputEvents = eventsBySourceId.get(job.id || "") || [];
        outputEvents.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const latest = outputEvents[0];
        const enabled = job.enabled !== false;
        const lastStatus = state?.last_status;
        const normalizedStatus: HarvestInstance["status"] = !enabled
          ? "paused"
          : lastStatus === "error"
          ? "error"
          : "active";
        return {
          id: job.id || `harvest-${index}`,
          name: job.name,
          emoji: String(
            job.meta?.harvest_emoji ||
              HARVEST_EMOJIS[index % HARVEST_EMOJIS.length],
          ),
          cron: job.schedule?.type === "cron" ? job.schedule.cron || "" : "",
          timezone: job.schedule?.timezone || "UTC",
          requestText: getRequestText(job),
          enabled,
          status: normalizedStatus,
          nextRunAt: toDate(state?.next_run_at),
          lastRunAt: toDate(state?.last_run_at),
          lastRunStatus: lastStatus,
          latestOutputTitle: latest?.title,
          latestOutputBody: latest?.body,
          latestOutputRunId:
            typeof latest?.payload?.run_id === "string"
              ? (latest.payload.run_id as string)
              : undefined,
          stats: {
            totalGenerated: history.length,
            successRate: calculateSuccessRate(history),
          },
        } as HarvestInstance;
      });
      harvestSpecsRef.current = Object.fromEntries(
        harvestJobs.map((job) => [job.id || "", job]),
      );
      setHarvests(nextHarvests);
      const unreadCount = harvestJobs.reduce((acc, job) => {
        const events = eventsBySourceId.get(job.id || "") || [];
        return acc + events.filter((event) => !event.read).length;
      }, 0);
      setSummary((prev) => ({
        ...prev,
        harvests: {
          total: nextHarvests.length,
          active: nextHarvests.filter((h) => h.enabled).length,
          unread: unreadCount,
        },
      }));
    } catch (error) {
      console.error("Failed to fetch harvest data", error);
    } finally {
      setHarvestsLoading(false);
    }
  }, []);

  const refreshHarvestUnreadCount = useCallback(async () => {
    try {
      const res = await api.getInboxEvents({
        source_type: "cron",
        unread_only: true,
        limit: 500,
      });
      const harvestIdSet = new Set(Object.keys(harvestSpecsRef.current));
      const unreadCount = (res?.events || []).filter(
        (event) =>
          Boolean(event.payload?.harvest) ||
          harvestIdSet.has(event.source_id || ""),
      ).length;
      setSummary((prev) => {
        if (prev.harvests.unread === unreadCount) return prev;
        return {
          ...prev,
          harvests: {
            ...prev.harvests,
            unread: unreadCount,
          },
        };
      });
    } catch (error) {
      console.error("Failed to refresh harvest unread count", error);
    }
  }, []);

  const loadHarvestExecutions = useCallback(
    async (harvestId: string): Promise<HarvestExecution[]> => {
      try {
        const res = await api.getInboxEvents({
          source_type: "cron",
          source_id: harvestId,
          limit: 200,
        });
        const events = res?.events || [];
        return events
          .map((event) => ({
            id: event.id,
            runId:
              typeof event.payload?.run_id === "string"
                ? (event.payload.run_id as string)
                : undefined,
            title: event.title,
            body: event.body,
            status: event.status,
            createdAt: new Date((event.created_at || Date.now() / 1000) * 1000),
            trigger:
              typeof event.payload?.trigger === "string"
                ? (event.payload.trigger as string)
                : undefined,
            read: Boolean(event.read),
          }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      } catch (error) {
        console.error("Failed to load harvest executions", error);
        return [];
      }
    },
    [],
  );

  useEffect(() => {
    void loadPushMessages();
    void refreshHarvests();
    void refreshHarvestUnreadCount();

    let timer: number | null = null;
    let unreadTimer: number | null = null;

    const startPolling = () => {
      if (!timer) {
        timer = window.setInterval(() => {
          void loadPushMessages();
        }, PUSH_POLLING_INTERVAL_MS);
      }
      if (!unreadTimer) {
        unreadTimer = window.setInterval(() => {
          void refreshHarvestUnreadCount();
        }, HARVEST_UNREAD_POLLING_INTERVAL_MS);
      }
    };

    const stopPolling = () => {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
      if (unreadTimer) {
        window.clearInterval(unreadTimer);
        unreadTimer = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadPushMessages();
        if (!pauseHarvestPolling) {
          void refreshHarvests();
        }
        void refreshHarvestUnreadCount();
        startPolling();
      } else {
        stopPolling();
      }
    };

    if (document.visibilityState === "visible") {
      startPolling();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    loadPushMessages,
    pauseHarvestPolling,
    refreshHarvests,
    refreshHarvestUnreadCount,
  ]);

  const markMessageAsRead = useCallback((messageId: string) => {
    void api.markInboxRead({ event_ids: [messageId] });
    setPushMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? { ...message, read: true } : message,
      ),
    );
    setSummary((prev) => ({
      ...prev,
      pushMessages: {
        ...prev.pushMessages,
        unread: Math.max(prev.pushMessages.unread - 1, 0),
      },
    }));
  }, []);

  const markAllMessagesAsRead = useCallback(async (): Promise<number> => {
    const unreadIds = pushMessagesRef.current
      .filter((message) => !message.read)
      .map((m) => m.id);
    if (!unreadIds.length) {
      return 0;
    }
    await api.markInboxRead({ all: true });
    setPushMessages((prev) =>
      prev.map((message) =>
        message.read ? message : { ...message, read: true },
      ),
    );
    setSummary((prev) => ({
      ...prev,
      pushMessages: {
        ...prev.pushMessages,
        unread: 0,
      },
    }));
    return unreadIds.length;
  }, []);

  const deleteMessages = useCallback(async (messageIds: string[]) => {
    const ids = Array.from(
      new Set(messageIds.map((id) => id.trim()).filter(Boolean)),
    );
    if (!ids.length) return 0;
    const idSet = new Set(ids);
    await Promise.allSettled(ids.map((id) => api.deleteInboxEvent(id)));
    let deleted = 0;
    let unreadDeleted = 0;
    setPushMessages((prev) => {
      const remaining: PushMessage[] = [];
      for (const message of prev) {
        if (idSet.has(message.id)) {
          deleted += 1;
          if (!message.read) unreadDeleted += 1;
          continue;
        }
        remaining.push(message);
      }
      return remaining;
    });
    setSummary((prev) => ({
      ...prev,
      pushMessages: {
        total: Math.max(prev.pushMessages.total - deleted, 0),
        unread: Math.max(prev.pushMessages.unread - unreadDeleted, 0),
      },
    }));
    return deleted;
  }, []);

  const deleteMessage = useCallback(
    (messageId: string) => {
      void deleteMessages([messageId]);
    },
    [deleteMessages],
  );

  const triggerHarvest = useCallback(
    async (harvestId: string) => {
      await api.triggerCronJob(harvestId);
      void refreshHarvests();
    },
    [refreshHarvests],
  );

  const upsertHarvest = useCallback(
    async (payload: HarvestUpsertPayload) => {
      const existing = payload.id ? harvestSpecsRef.current[payload.id] : null;
      const baseMeta = existing?.meta || {};
      let parsedInput: unknown;
      try {
        parsedInput = JSON.parse(payload.requestText);
      } catch {
        throw new Error("Request content must be valid JSON");
      }
      if (!Array.isArray(parsedInput)) {
        throw new Error("Request content must be a JSON array");
      }
      const spec: CronJobSpecOutput = {
        id: payload.id || "",
        name: payload.name,
        enabled: existing?.enabled ?? true,
        save_result_to_inbox: true,
        schedule: {
          type: "cron",
          cron: payload.cron,
          timezone: payload.timezone,
        },
        task_type: "agent",
        request: {
          ...(existing?.request || {}),
          input: parsedInput,
        },
        dispatch: existing?.dispatch || {
          type: "channel",
          channel: "console",
          target: {
            user_id: "harvest",
            session_id: `harvest:${payload.name
              .replace(/\s+/g, "-")
              .toLowerCase()}`,
          },
          mode: "stream",
        },
        runtime: existing?.runtime,
        meta: {
          ...baseMeta,
          harvest: true,
          harvest_emoji:
            existing?.meta?.harvest_emoji ||
            HARVEST_EMOJIS[Math.floor(Math.random() * HARVEST_EMOJIS.length)],
        },
      };
      if (payload.id) {
        await api.replaceCronJob(payload.id, spec);
      } else {
        await api.createCronJob(spec);
      }
      await refreshHarvests();
    },
    [refreshHarvests],
  );

  const markHarvestExecutionRead = useCallback(
    async (eventId: string) => {
      await api.markInboxRead({ event_ids: [eventId] });
      await refreshHarvests();
    },
    [refreshHarvests],
  );

  return {
    summary,
    pushMessages,
    harvests,
    harvestsLoading,
    markMessageAsRead,
    markAllMessagesAsRead,
    deleteMessage,
    deleteMessages,
    triggerHarvest,
    upsertHarvest,
    loadHarvestExecutions,
    markHarvestExecutionRead,
    refreshHarvests,
    refreshPushMessages: loadPushMessages,
  };
};
