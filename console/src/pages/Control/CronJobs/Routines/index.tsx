import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
} from "@agentscope-ai/design";
import {
  Checkbox,
  Collapse,
  Dropdown,
  Radio,
  Space,
  Tag,
  TimePicker,
  Tooltip,
} from "antd";
import type { MenuProps } from "antd";
import {
  CalendarClock,
  Clock3,
  Copy,
  History,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RadioTower,
  Sparkles,
  Trash2,
  Webhook,
  Zap,
} from "lucide-react";
import dayjs from "dayjs";
import api from "../../../../api";
import type {
  CronDispatchTargetItem,
  RoutineRun,
  RoutineSpec,
  RoutineView,
} from "../../../../api/types";
import type { ToolInfo } from "../../../../api/modules/tools";
import { copyText } from "../../../../utils/clipboard";
import { getApiUrl } from "../../../../api/config";
import { useAppMessage } from "../../../../hooks/useAppMessage";
import { parseCron, serializeCron } from "../components/parseCron";
import {
  mergeSelectOptions,
  sessionIdsForTarget,
  userIdsForChannel,
} from "./dispatchOptions";
import { buildRoutineCurlExamples } from "./curlExamples";
import styles from "./index.module.less";

type FormValues = {
  name: string;
  description?: string;
  prompt: string;
  enabled: boolean;
  tool_mode: "all" | "custom";
  allowed_tools: string[];
  schedule_enabled: boolean;
  schedule_type: "hourly" | "daily" | "weekly" | "custom";
  schedule_time?: dayjs.Dayjs;
  schedule_days?: string[];
  schedule_cron?: string;
  api_enabled: boolean;
  api_requests_per_minute: number;
  api_max_pending_runs: number;
  api_max_request_size_kb: number;
  trigger_logic: "or" | "and";
  isolate_session: boolean;
  dispatch_channel: string;
  dispatch_user_id: string;
  dispatch_session_id: string;
  save_result_to_inbox: boolean;
  timeout_seconds: number;
  max_concurrency: number;
  misfire_grace_seconds: number;
};

const initialValues: Partial<FormValues> = {
  enabled: true,
  tool_mode: "all",
  allowed_tools: [],
  schedule_enabled: false,
  schedule_type: "daily",
  schedule_time: dayjs().hour(9).minute(0),
  schedule_days: ["mon"],
  api_enabled: false,
  api_requests_per_minute: 3,
  api_max_pending_runs: 3,
  api_max_request_size_kb: 256,
  trigger_logic: "or",
  isolate_session: true,
  dispatch_channel: "console",
  save_result_to_inbox: true,
  timeout_seconds: 600,
  max_concurrency: 1,
  misfire_grace_seconds: 600,
};

function triggerLabel(view: RoutineView): string {
  const labels: string[] = [];
  if (view.spec.schedule_trigger?.enabled) labels.push("定时");
  if (view.spec.api_trigger?.enabled) labels.push("API");
  if (!labels.length) return "仅手动";
  return labels.join(view.spec.trigger_logic === "and" ? " 且 " : " 或 ");
}

function statusTag(status?: string | null) {
  if (!status) return <Tag>未运行</Tag>;
  const color =
    status === "success"
      ? "success"
      : status === "running" || status === "queued"
      ? "processing"
      : status === "error"
      ? "error"
      : "default";
  return <Tag color={color}>{status}</Tag>;
}

function runStatusLabel(status?: string | null): string {
  if (status === "success") return "运行成功";
  if (status === "running") return "运行中";
  if (status === "queued") return "等待执行";
  if (status === "error") return "运行失败";
  if (status === "cancelled") return "已取消";
  return "尚未运行";
}

export default function RoutinesPage() {
  const { message } = useAppMessage();
  const [form] = Form.useForm<FormValues>();
  const [routines, setRoutines] = useState<RoutineView[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [targets, setTargets] = useState<CronDispatchTargetItem[]>([]);
  const [targetChannels, setTargetChannels] = useState<string[]>(["console"]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RoutineView | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyName, setHistoryName] = useState("");
  const [historyRoutineId, setHistoryRoutineId] = useState("");
  const [runs, setRuns] = useState<RoutineRun[]>([]);
  const [tokenInfo, setTokenInfo] = useState<{
    token: string;
    firePath: string;
  } | null>(null);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");

  const scheduleEnabled = Form.useWatch("schedule_enabled", form);
  const scheduleType = Form.useWatch("schedule_type", form);
  const apiEnabled = Form.useWatch("api_enabled", form);
  const toolMode = Form.useWatch("tool_mode", form);
  const selectedChannel = Form.useWatch("dispatch_channel", form);
  const selectedUserId = Form.useWatch("dispatch_user_id", form);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [routineData, toolData, targetData, timezoneData] =
          await Promise.all([
            api.listRoutines(),
            api.listTools(),
            api.listCronDispatchTargets(),
            api.getUserTimezone(),
          ]);
        setRoutines(routineData || []);
        setTools((toolData || []).filter((item: ToolInfo) => item.enabled));
        setTargets(targetData?.items || []);
        setTargetChannels(
          Array.from(new Set(["console", ...(targetData?.channels || [])])),
        );
        setTimezone(timezoneData?.timezone || "UTC");
      } catch (error) {
        console.error("Failed to load routines", error);
        message.error("加载 Routine 失败");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const hasActiveRun = routines.some((view) =>
      ["queued", "running"].includes(view.last_run?.status || ""),
    );
    if (!hasActiveRun) return;
    const timer = window.setInterval(() => load(true), 3000);
    return () => window.clearInterval(timer);
  }, [load, routines]);

  useEffect(() => {
    if (!historyOpen || !historyRoutineId) return;
    const timer = window.setInterval(async () => {
      setRuns(await api.listRoutineRuns(historyRoutineId));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [historyOpen, historyRoutineId]);

  useEffect(() => {
    if (!editorOpen) return;
    let active = true;
    setTargetsLoading(true);
    void api
      .listCronDispatchTargets()
      .then((data) => {
        if (!active) return;
        setTargets(data?.items || []);
        setTargetChannels(
          Array.from(new Set(["console", ...(data?.channels || [])])),
        );
      })
      .catch((error) =>
        console.error("Failed to reload dispatch targets", error),
      )
      .finally(() => {
        if (active) setTargetsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [editorOpen]);

  const channelOptions = useMemo(
    () => mergeSelectOptions(targetChannels, selectedChannel, channelSearch),
    [channelSearch, selectedChannel, targetChannels],
  );

  const userOptions = useMemo(() => {
    const values = userIdsForChannel(targets, selectedChannel);
    return mergeSelectOptions(values, selectedUserId, userSearch);
  }, [selectedChannel, selectedUserId, targets, userSearch]);

  const sessionOptions = useMemo(() => {
    const values = sessionIdsForTarget(
      targets,
      selectedChannel,
      selectedUserId,
    );
    const selectedSessionId = form.getFieldValue("dispatch_session_id");
    return mergeSelectOptions(values, selectedSessionId, sessionSearch);
  }, [form, selectedChannel, selectedUserId, sessionSearch, targets]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue(initialValues as FormValues);
    setChannelSearch("");
    setUserSearch("");
    setSessionSearch("");
    setEditorOpen(true);
  };

  const openEdit = (view: RoutineView) => {
    const routine = view.spec;
    const schedule = routine.schedule_trigger?.schedule;
    const rawCron = schedule?.type === "cron" ? schedule.cron : undefined;
    const cronParts =
      schedule?.type === "cron" ? parseCron(rawCron || "0 9 * * *") : null;
    form.resetFields();
    form.setFieldsValue({
      ...initialValues,
      name: routine.name,
      description: routine.description || "",
      prompt: routine.prompt,
      enabled: routine.enabled ?? true,
      tool_mode: routine.tool_mode,
      allowed_tools: routine.allowed_tools || [],
      schedule_enabled: Boolean(routine.schedule_trigger?.enabled),
      schedule_type: cronParts?.type || "custom",
      schedule_time:
        cronParts?.hour !== undefined
          ? dayjs()
              .hour(cronParts.hour)
              .minute(cronParts.minute || 0)
          : dayjs().hour(9).minute(0),
      schedule_days: cronParts?.daysOfWeek || ["mon"],
      schedule_cron: cronParts?.type === "custom" ? cronParts.rawCron : rawCron,
      api_enabled: Boolean(routine.api_trigger?.enabled),
      api_requests_per_minute: routine.api_trigger?.requests_per_minute ?? 3,
      api_max_pending_runs: routine.api_trigger?.max_pending_runs ?? 3,
      api_max_request_size_kb: routine.api_trigger?.max_request_size_kb ?? 256,
      trigger_logic: routine.trigger_logic,
      isolate_session: routine.isolate_session,
      dispatch_channel: routine.dispatch.channel || "console",
      dispatch_user_id: routine.dispatch.target.user_id,
      dispatch_session_id: routine.dispatch.target.session_id,
      save_result_to_inbox: routine.save_result_to_inbox,
      timeout_seconds: routine.runtime?.timeout_seconds || 600,
      max_concurrency: routine.runtime?.max_concurrency || 1,
      misfire_grace_seconds: routine.runtime?.misfire_grace_seconds || 600,
    } as FormValues);
    setChannelSearch("");
    setUserSearch("");
    setSessionSearch("");
    setEditing(view);
    setEditorOpen(true);
  };

  const buildSpec = (values: FormValues): RoutineSpec => {
    let cron = "0 9 * * *";
    if (values.schedule_enabled) {
      cron = serializeCron({
        type: values.schedule_type,
        hour: values.schedule_time?.hour(),
        minute: values.schedule_time?.minute(),
        daysOfWeek: values.schedule_days,
        rawCron: values.schedule_cron,
      });
    }
    return {
      id: editing?.spec.id,
      name: values.name.trim(),
      description: values.description?.trim() || null,
      prompt: values.prompt.trim(),
      enabled: values.enabled,
      tool_mode: values.tool_mode,
      allowed_tools:
        values.tool_mode === "custom" ? values.allowed_tools || [] : [],
      schedule_trigger: values.schedule_enabled
        ? {
            enabled: true,
            schedule: { type: "cron", cron, timezone },
          }
        : null,
      api_trigger: values.api_enabled
        ? {
            enabled: true,
            token_hint: editing?.spec.api_trigger?.token_hint,
            requests_per_minute: values.api_requests_per_minute,
            max_pending_runs: values.api_max_pending_runs,
            max_request_size_kb: values.api_max_request_size_kb,
          }
        : null,
      trigger_logic:
        values.schedule_enabled && values.api_enabled
          ? values.trigger_logic
          : "or",
      isolate_session: values.isolate_session,
      dispatch: {
        type: "channel",
        channel: values.dispatch_channel.trim(),
        target: {
          user_id: values.dispatch_user_id.trim(),
          session_id: values.dispatch_session_id.trim(),
        },
        mode: "stream",
        silent: false,
      },
      save_result_to_inbox: values.save_result_to_inbox,
      runtime: {
        timeout_seconds: values.timeout_seconds,
        max_concurrency: values.max_concurrency,
        misfire_grace_seconds: values.misfire_grace_seconds,
      },
    };
  };

  const submit = async (values: FormValues) => {
    setSaving(true);
    try {
      const spec = buildSpec(values);
      const response = editing?.spec.id
        ? await api.updateRoutine(editing.spec.id, spec)
        : await api.createRoutine(spec);
      setEditorOpen(false);
      await load();
      message.success(editing ? "Routine 已更新" : "Routine 已创建");
      if (response.api_token && response.routine.fire_path) {
        setTokenVisible(false);
        setTokenInfo({
          token: response.api_token,
          firePath: response.routine.fire_path,
        });
      }
    } catch (error) {
      console.error("Failed to save routine", error);
      message.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (view: RoutineView) => {
    if (!view.spec.id) return;
    try {
      await api.runRoutine(view.spec.id);
      message.success("Routine 已开始执行");
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "执行失败");
    }
  };

  const toggle = async (view: RoutineView) => {
    if (!view.spec.id) return;
    try {
      if (view.spec.enabled) await api.pauseRoutine(view.spec.id);
      else await api.enableRoutine(view.spec.id);
      await load();
    } catch {
      message.error("操作失败");
    }
  };

  const remove = (view: RoutineView) => {
    if (!view.spec.id) return;
    Modal.confirm({
      title: "删除 Routine",
      content: `确定删除“${view.spec.name}”吗？`,
      onOk: async () => {
        await api.deleteRoutine(view.spec.id as string);
        await load();
      },
    });
  };

  const showRuns = async (view: RoutineView) => {
    if (!view.spec.id) return;
    setHistoryName(view.spec.name);
    setHistoryRoutineId(view.spec.id);
    setHistoryOpen(true);
    setRuns(await api.listRoutineRuns(view.spec.id));
  };

  const rotateToken = (view: RoutineView) => {
    if (!view.spec.id) return;
    Modal.confirm({
      title: "重置 API Token",
      content: `确定要重置“${view.spec.name}”的 API Token 吗？旧 Token 将立即失效。`,
      okText: "确认重置",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const response = await api.rotateRoutineToken(view.spec.id as string);
          if (response.api_token && response.routine.fire_path) {
            setTokenVisible(false);
            setTokenInfo({
              token: response.api_token,
              firePath: response.routine.fire_path,
            });
            await load();
          }
        } catch (error) {
          message.error("API Token 重置失败");
          throw error;
        }
      },
    });
  };

  const enabledCount = routines.filter((view) => view.spec.enabled).length;

  const actionMenu = (view: RoutineView): MenuProps => ({
    items: [
      ...(view.spec.api_trigger?.enabled
        ? [
            {
              key: "token",
              label: "重置 API Token",
              icon: <KeyRound size={15} />,
            },
            { type: "divider" as const },
          ]
        : []),
      {
        key: "delete",
        label: "删除 Routine",
        danger: true,
        icon: <Trash2 size={15} />,
      },
    ],
    onClick: ({ key }) => {
      if (key === "token") rotateToken(view);
      if (key === "delete") remove(view);
    },
  });

  const fireUrl = tokenInfo
    ? new URL(getApiUrl(tokenInfo.firePath), window.location.origin).toString()
    : "";
  const curlExamples = buildRoutineCurlExamples(
    fireUrl,
    tokenInfo?.token || "",
  );
  const visibleCurlExamples = buildRoutineCurlExamples(
    fireUrl,
    tokenVisible ? tokenInfo?.token || "" : "••••••••••••",
  );

  const copyCurlExample = (value: string) => {
    void copyText(value)
      .then(() => message.success("curl 已复制"))
      .catch(() => message.error("复制失败"));
  };

  const copyToken = () => {
    if (!tokenInfo?.token) return;
    void copyText(tokenInfo.token)
      .then(() => message.success("Token 已复制"))
      .catch(() => message.error("复制失败"));
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroContent}>
          <div className={styles.heroIcon}>
            <Sparkles size={22} />
          </div>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>AGENT AUTOMATION</div>
            <h1>让重复任务自己运转</h1>
            <p>一次配置，按时间或事件自动唤醒 Agent。</p>
          </div>
          <div className={styles.heroStats}>
            <div>
              <strong>{routines.length}</strong>
              <span>全部</span>
            </div>
            <div>
              <strong>{enabledCount}</strong>
              <span>运行中</span>
            </div>
          </div>
          <Button
            type="primary"
            size="large"
            className={styles.createButton}
            onClick={openCreate}
          >
            <span className={styles.buttonLabel}>
              <Plus size={17} /> 创建 Routine
            </span>
          </Button>
        </div>
      </section>

      <div className={styles.listHeader}>
        <div>
          <h2>我的 Routine</h2>
          <p>管理触发方式、执行状态与历史结果</p>
        </div>
        <div className={styles.timezoneBadge}>
          <Clock3 size={14} /> {timezone}
        </div>
      </div>

      {loading ? (
        <div className={styles.loadingState}>
          <div className={styles.loadingOrb} />
          正在加载 Routine…
        </div>
      ) : routines.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <Zap size={30} />
          </div>
          <h3>创建你的第一个 Routine</h3>
          <p>让 Agent 定时检查、整理信息，或者响应外部 Webhook。</p>
          <Button type="primary" onClick={openCreate}>
            <span className={styles.buttonLabel}>
              <Plus size={16} /> 开始创建
            </span>
          </Button>
        </div>
      ) : (
        <div className={styles.routineGrid}>
          {routines.map((view, index) => {
            const status = view.last_run?.status || "idle";
            return (
              <article
                key={view.spec.id}
                className={`${styles.routineCard} ${
                  !view.spec.enabled ? styles.routineCardPaused : ""
                }`}
                style={{ animationDelay: `${Math.min(index * 45, 225)}ms` }}
              >
                <div className={styles.cardAccent} />
                <div className={styles.cardHeader}>
                  <div className={styles.routineIcon}>
                    <RadioTower size={19} />
                  </div>
                  <div className={styles.enabledControl}>
                    <span>{view.spec.enabled ? "已启用" : "已暂停"}</span>
                    <Switch
                      size="small"
                      checked={view.spec.enabled}
                      onChange={() => void toggle(view)}
                    />
                  </div>
                </div>

                <div className={styles.cardTitleRow}>
                  <div>
                    <h3>{view.spec.name}</h3>
                    <p>{view.spec.description || view.spec.prompt}</p>
                  </div>
                  <Dropdown menu={actionMenu(view)} trigger={["click"]}>
                    <Button
                      type="text"
                      size="small"
                      className={styles.moreButton}
                    >
                      <MoreHorizontal size={18} />
                    </Button>
                  </Dropdown>
                </div>

                <div className={styles.triggerRow}>
                  {view.spec.schedule_trigger?.enabled && (
                    <span className={styles.triggerPill}>
                      <CalendarClock size={14} /> 定时
                    </span>
                  )}
                  {view.spec.api_trigger?.enabled && (
                    <span className={styles.triggerPill}>
                      <Webhook size={14} /> API
                    </span>
                  )}
                  {!view.spec.schedule_trigger?.enabled &&
                    !view.spec.api_trigger?.enabled && (
                      <span className={styles.triggerPill}>
                        <Play size={14} /> 仅手动
                      </span>
                    )}
                  {view.spec.schedule_trigger?.enabled &&
                    view.spec.api_trigger?.enabled && (
                      <span className={styles.logicPill}>
                        {view.spec.trigger_logic === "and" ? "且" : "或"}
                      </span>
                    )}
                </div>

                <div className={styles.cardMetrics}>
                  <div>
                    <span>最近运行</span>
                    <strong className={styles.runStatus} data-status={status}>
                      <i /> {runStatusLabel(status)}
                    </strong>
                  </div>
                  <div>
                    <span>下次执行</span>
                    <strong>
                      {view.next_run_at
                        ? dayjs(view.next_run_at).format("MM-DD HH:mm")
                        : triggerLabel(view)}
                    </strong>
                  </div>
                </div>

                <div className={styles.cardActions}>
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => void runNow(view)}
                  >
                    <span className={styles.buttonLabel}>
                      <Play size={14} /> 立即执行
                    </span>
                  </Button>
                  <Tooltip title="运行记录">
                    <Button size="small" onClick={() => void showRuns(view)}>
                      <History size={15} />
                    </Button>
                  </Tooltip>
                  <Tooltip title="编辑">
                    <Button size="small" onClick={() => openEdit(view)}>
                      <Pencil size={15} />
                    </Button>
                  </Tooltip>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={editorOpen}
        centered
        width={760}
        title={
          <div className={styles.editorTitle}>
            <span>
              <Sparkles size={18} />
            </span>
            <div>
              <strong>{editing ? "编辑 Routine" : "创建 Routine"}</strong>
              <small>配置任务内容、触发方式和结果去向</small>
            </div>
          </div>
        }
        onCancel={() => setEditorOpen(false)}
        destroyOnHidden
        className={styles.editorModal}
        styles={{
          body: { maxHeight: "calc(100vh - 220px)", overflowY: "auto" },
        }}
        footer={
          <div className={styles.footer}>
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={saving}
              onClick={() => form.submit()}
            >
              保存
            </Button>
          </div>
        }
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={initialValues}
          className={styles.editorForm}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="例如：每日代码检查" />
          </Form.Item>
          <Form.Item name="description" label="任务描述（选填）">
            <Input.TextArea rows={2} placeholder="帮助你识别这个 Routine" />
          </Form.Item>
          <Form.Item
            name="prompt"
            label="任务内容"
            rules={[
              { required: true, message: "请输入发送给 Agent 的任务内容" },
            ]}
          >
            <Input.TextArea
              rows={6}
              placeholder="输入真正发送给 Agent 的 Prompt"
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>

          <div className={styles.sectionTitle}>工具</div>
          <Form.Item name="tool_mode">
            <Radio.Group>
              <Radio value="all">使用当前 Agent 的全部已启用工具</Radio>
              <Radio value="custom">自定义工具</Radio>
            </Radio.Group>
          </Form.Item>
          {toolMode === "custom" && (
            <Form.Item name="allowed_tools" label="允许使用的工具">
              <Checkbox.Group
                className={styles.toolGrid}
                options={tools.map((tool) => ({
                  label: tool.name,
                  value: tool.name,
                }))}
              />
            </Form.Item>
          )}

          <div className={styles.sectionTitle}>触发条件</div>
          <Form.Item
            name="schedule_enabled"
            valuePropName="checked"
            label="定时触发"
          >
            <Switch />
          </Form.Item>
          {scheduleEnabled && (
            <div className={styles.triggerBox}>
              <Form.Item name="schedule_type" label="频率">
                <Select
                  options={[
                    { label: "每小时", value: "hourly" },
                    { label: "每天", value: "daily" },
                    { label: "每周", value: "weekly" },
                    { label: "自定义 Cron", value: "custom" },
                  ]}
                />
              </Form.Item>
              {(scheduleType === "daily" || scheduleType === "weekly") && (
                <Form.Item name="schedule_time" label="执行时间">
                  <TimePicker format="HH:mm" style={{ width: "100%" }} />
                </Form.Item>
              )}
              {scheduleType === "weekly" && (
                <Form.Item name="schedule_days" label="星期">
                  <Checkbox.Group
                    options={[
                      ["周一", "mon"],
                      ["周二", "tue"],
                      ["周三", "wed"],
                      ["周四", "thu"],
                      ["周五", "fri"],
                      ["周六", "sat"],
                      ["周日", "sun"],
                    ].map(([label, value]) => ({ label, value }))}
                  />
                </Form.Item>
              )}
              {scheduleType === "custom" && (
                <Form.Item
                  name="schedule_cron"
                  label="Cron 表达式"
                  rules={[{ required: true }]}
                >
                  <Input placeholder="0 9 * * *" />
                </Form.Item>
              )}
            </div>
          )}
          <Form.Item
            name="api_enabled"
            valuePropName="checked"
            label="API 触发"
          >
            <Switch />
          </Form.Item>
          {apiEnabled && (
            <div className={styles.helpText}>
              保存后生成调用地址和只显示一次的 Token。
            </div>
          )}
          {scheduleEnabled && apiEnabled && (
            <Form.Item name="trigger_logic" label="多个触发条件">
              <Radio.Group>
                <Radio value="or">满足任意条件时执行（或）</Radio>
                <Radio value="and">
                  API 到达后，在下一个定时时间执行（且）
                </Radio>
              </Radio.Group>
            </Form.Item>
          )}

          <div className={styles.sectionTitle}>会话与结果</div>
          <Form.Item
            name="isolate_session"
            label="隔离会话执行"
            valuePropName="checked"
            tooltip="每次运行不读取之前的对话上下文，默认开启"
          >
            <Switch />
          </Form.Item>
          <div className={styles.dispatchGrid}>
            <Form.Item
              name="dispatch_channel"
              label="结果投递频道"
              rules={[{ required: true, message: "请选择或输入频道" }]}
            >
              <Select
                showSearch
                loading={targetsLoading}
                options={channelOptions}
                placeholder="例如 console"
                onSearch={setChannelSearch}
                onBlur={() => setChannelSearch("")}
                onChange={() => {
                  form.setFieldValue("dispatch_user_id", undefined);
                  form.setFieldValue("dispatch_session_id", undefined);
                }}
                notFoundContent="输入新频道后按 Enter"
                filterOption={(input, option) =>
                  String(option?.label || "")
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item
              name="dispatch_user_id"
              label="用户 ID"
              rules={[{ required: true, message: "请选择或输入用户 ID" }]}
            >
              <Select
                showSearch
                loading={targetsLoading}
                options={userOptions}
                placeholder="选择已有用户或输入新值"
                onSearch={setUserSearch}
                onBlur={() => setUserSearch("")}
                onChange={() =>
                  form.setFieldValue("dispatch_session_id", undefined)
                }
                notFoundContent="输入新用户 ID 后按 Enter"
                filterOption={(input, option) =>
                  String(option?.label || "")
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item
              name="dispatch_session_id"
              label="会话 ID"
              rules={[{ required: true, message: "请选择或输入会话 ID" }]}
            >
              <Select
                showSearch
                loading={targetsLoading}
                options={sessionOptions}
                placeholder="选择已有会话或输入新值"
                onSearch={setSessionSearch}
                onBlur={() => setSessionSearch("")}
                notFoundContent="输入新会话 ID 后按 Enter"
                filterOption={(input, option) =>
                  String(option?.label || "")
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              />
            </Form.Item>
          </div>
          <Form.Item
            name="save_result_to_inbox"
            label="同时保存到收件箱"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Collapse
            ghost
            items={[
              {
                key: "advanced",
                label: "高级设置",
                children: (
                  <>
                    <Form.Item name="timeout_seconds" label="超时时间（秒）">
                      <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                    <Form.Item name="max_concurrency" label="最大并发数">
                      <InputNumber min={1} style={{ width: "100%" }} />
                    </Form.Item>
                    {apiEnabled && (
                      <>
                        <Form.Item
                          name="api_requests_per_minute"
                          label="每分钟最大 API 调用次数"
                          extra="按最近 60 秒计算，超过后暂时拒绝新的 API 请求。"
                        >
                          <InputNumber
                            min={1}
                            max={1000}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                        <Form.Item
                          name="api_max_pending_runs"
                          label="最大等待任务数"
                          extra="只计算等待执行的任务，不包含正在执行的任务。"
                        >
                          <InputNumber
                            min={1}
                            max={100}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                        <Form.Item
                          name="api_max_request_size_kb"
                          label="单次 API 请求大小（KB）"
                          extra="包含 text、data 和 event_id，最高可设置为 10 MB。"
                        >
                          <InputNumber
                            min={1}
                            max={10240}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </>
                    )}
                    <Form.Item
                      name="misfire_grace_seconds"
                      label="错过执行宽限时间（秒）"
                    >
                      <InputNumber min={0} style={{ width: "100%" }} />
                    </Form.Item>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      <Modal
        open={historyOpen}
        title={`运行记录 - ${historyName}`}
        footer={null}
        onCancel={() => setHistoryOpen(false)}
        width={760}
      >
        <div className={styles.runList}>
          {!runs.length ? (
            <div className={styles.empty}>暂无运行记录</div>
          ) : (
            runs.map((run) => (
              <div key={run.run_id} className={styles.runItem}>
                <div className={styles.runHeader}>
                  <span>
                    {dayjs(run.created_at).format("YYYY-MM-DD HH:mm:ss")}
                  </span>
                  {statusTag(run.status)}
                </div>
                <div>触发来源：{run.trigger}</div>
                {run.duration_seconds != null && (
                  <div>耗时：{run.duration_seconds.toFixed(1)} 秒</div>
                )}
                {run.summary && <div>{run.summary}</div>}
                {run.error && <div className={styles.error}>{run.error}</div>}
                {run.session_id && <div>会话：{run.session_id}</div>}
                {run.trace_id && <div>Trace ID：{run.trace_id}</div>}
                <div className={styles.runId}>Run ID: {run.run_id}</div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(tokenInfo)}
        title="API 触发信息"
        onCancel={() => {
          setTokenVisible(false);
          setTokenInfo(null);
        }}
        footer={
          <Space>
            <Button
              onClick={async () => {
                if (!tokenInfo) return;
                await api.fireRoutine(tokenInfo.firePath, tokenInfo.token);
                message.success("测试请求已发送");
              }}
            >
              测试触发
            </Button>
            <Button
              type="primary"
              onClick={() => {
                setTokenVisible(false);
                setTokenInfo(null);
              }}
            >
              我已保存
            </Button>
          </Space>
        }
      >
        <div className={styles.warning}>Token 只显示一次，请立即保存。</div>
        <div className={styles.tokenLabel}>请求地址</div>
        <Input.TextArea readOnly value={fireUrl} autoSize />
        <div className={styles.tokenLabel}>Token</div>
        <div className={styles.tokenField}>
          <Input.Password
            readOnly
            value={tokenInfo?.token}
            visibilityToggle={{
              visible: tokenVisible,
              onVisibleChange: setTokenVisible,
            }}
          />
          <button
            type="button"
            className={styles.copyButton}
            aria-label="复制 Token"
            title="复制 Token"
            onClick={copyToken}
          >
            <Copy aria-hidden="true" />
          </button>
        </div>
        <div className={styles.tokenLabel}>curl 示例</div>
        <div className={styles.curlExample}>
          <div className={styles.curlExampleHeader}>
            <span>仅触发 Routine</span>
            <button
              type="button"
              className={styles.copyButton}
              aria-label="复制仅触发示例"
              title="复制"
              onClick={() => copyCurlExample(curlExamples.minimal)}
            >
              <Copy aria-hidden="true" />
            </button>
          </div>
          <pre className={styles.curlCode}>{visibleCurlExamples.minimal}</pre>
        </div>
        <div className={styles.curlExample}>
          <div className={styles.curlExampleHeader}>
            <span>携带本次任务信息</span>
            <button
              type="button"
              className={styles.copyButton}
              aria-label="复制携带任务信息的示例"
              title="复制"
              onClick={() => copyCurlExample(curlExamples.withText)}
            >
              <Copy aria-hidden="true" />
            </button>
          </div>
          <pre className={styles.curlCode}>{visibleCurlExamples.withText}</pre>
        </div>
      </Modal>
    </div>
  );
}
