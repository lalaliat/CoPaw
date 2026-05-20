import { useCallback, useMemo, useState } from "react";
import { Modal, Button, Card, Empty, Spin, Collapse, message } from "antd";
import {
  BulbOutlined,
  CopyOutlined,
  DownOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import type { HarvestExecution, HarvestInstance } from "../types";
import {
  buildTraceDisplayItems,
  formatToolBlockContent,
  formatToolInput,
  type TraceDisplayItem,
} from "../utils/traceUtils";
import styles from "./MagazineStackViewer.module.less";

interface MagazineStackViewerProps {
  open: boolean;
  harvest: HarvestInstance;
  executions: HarvestExecution[];
  loading?: boolean;
  onReadExecution?: (executionId: string) => void;
  onClose: () => void;
}

const isUserTraceItem = (item: TraceDisplayItem): boolean => {
  const role = String(
    item.eventRecord.role || item.eventRecord.name || "",
  ).toLowerCase();
  return role === "user";
};

export function MagazineStackViewer({
  open,
  harvest,
  executions,
  loading = false,
  onReadExecution,
  onClose,
}: MagazineStackViewerProps) {
  const { t } = useTranslation();
  const magazines = useMemo(() => executions, [executions]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceItems, setTraceItems] = useState<TraceDisplayItem[]>([]);
  const [expandedTraceMap, setExpandedTraceMap] = useState<
    Record<string, boolean>
  >({});
  const current = magazines[currentIndex] || null;

  const copyTraceBlock = useCallback(
    async (text: string) => {
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        message.success(t("common.copied"));
      } catch {
        message.error(t("common.copyFailed"));
      }
    },
    [t],
  );

  const loadTrace = async (
    execution: HarvestExecution | null,
    createdAtSec: number,
  ) => {
    if (!execution) {
      setTraceItems([]);
      return;
    }
    const { runId, body } = execution;
    const fallbackEvents = body
      ? [
          {
            at: createdAtSec,
            event: {
              role: "assistant",
              content: [{ type: "text", text: body }],
            },
          },
        ]
      : [];
    setExpandedTraceMap({});
    if (!runId) {
      setTraceItems(buildTraceDisplayItems(fallbackEvents));
      return;
    }
    setTraceLoading(true);
    try {
      const trace = await api.getInboxTrace(runId);
      const items = buildTraceDisplayItems(trace.events || []).filter(
        (item) => !isUserTraceItem(item),
      );
      setTraceItems(
        items.length ? items : buildTraceDisplayItems(fallbackEvents),
      );
    } catch {
      setTraceItems(buildTraceDisplayItems(fallbackEvents));
    } finally {
      setTraceLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1100}
      title={`${harvest.name} · ${t("inbox.harvestHistoryTitle")}`}
      destroyOnClose
      afterOpenChange={(opened) => {
        if (!opened) return;
        setCurrentIndex(0);
        const first = executions[0];
        if (first) {
          void loadTrace(first, Math.floor(first.createdAt.getTime() / 1000));
        }
      }}
    >
      {loading ? (
        <div className={styles.loadingWrap}>
          <Spin />
        </div>
      ) : magazines.length <= 0 ? (
        <Empty description={t("inbox.harvestHistoryEmpty")} />
      ) : (
        <div className={styles.viewerContainer}>
          <div className={styles.mainArea}>
            <Button
              icon={<ChevronLeft size={18} />}
              disabled={currentIndex === 0}
              onClick={() => {
                const next = Math.max(currentIndex - 1, 0);
                setCurrentIndex(next);
                const item = magazines[next];
                if (item) {
                  void loadTrace(
                    item,
                    Math.floor(item.createdAt.getTime() / 1000),
                  );
                }
              }}
            />
            <Card className={styles.contentCard}>
              <h3>{current?.title}</h3>
              <p className={styles.date}>
                {current?.createdAt.toLocaleString()} ·{" "}
                {current?.status || t("inbox.detailStatus")}
              </p>
              {traceLoading ? (
                <div className={styles.loadingWrap}>
                  <Spin size="small" />
                </div>
              ) : traceItems.length > 0 ? (
                <div className={styles.traceContainer}>
                  <div className={styles.traceTimeline}>
                    {traceItems.map((item, index) => {
                      const kind = item.eventType;
                      const foldIcon = kind
                        .toLowerCase()
                        .includes("thinking") ? (
                        <BulbOutlined />
                      ) : kind.toLowerCase().includes("tool") ? (
                        <ToolOutlined />
                      ) : null;
                      const collapseKey = `harvest-trace-${item.at}-${index}`;
                      const isPanelActive = !!expandedTraceMap[collapseKey];
                      return (
                        <div
                          key={`${item.at}-${index}`}
                          className={styles.traceEntry}
                        >
                          {item.collapsible ? (
                            <Collapse
                              bordered={false}
                              ghost
                              activeKey={isPanelActive ? [collapseKey] : []}
                              onChange={(keys) => {
                                const nextActive = Array.isArray(keys)
                                  ? keys.length > 0
                                  : Boolean(keys);
                                setExpandedTraceMap((prev) => ({
                                  ...prev,
                                  [collapseKey]: nextActive,
                                }));
                              }}
                              className={`${styles.traceCollapse} ${
                                isPanelActive ? styles.traceCollapseActive : ""
                              }`}
                              expandIcon={() => null}
                              items={[
                                {
                                  key: collapseKey,
                                  label: (
                                    <div className={styles.traceFoldHeader}>
                                      {foldIcon ? (
                                        <span className={styles.traceFoldIcon}>
                                          {foldIcon}
                                        </span>
                                      ) : null}
                                      <span className={styles.traceFoldTitle}>
                                        {item.collapseTitle}
                                      </span>
                                      <span
                                        className={`${
                                          styles.traceInlineChevron
                                        } ${
                                          isPanelActive
                                            ? styles.traceInlineChevronActive
                                            : ""
                                        }`}
                                      >
                                        <DownOutlined />
                                      </span>
                                    </div>
                                  ),
                                  children:
                                    item.renderKind === "tool_pair" ? (
                                      <div className={styles.toolDetailWrap}>
                                        {item.toolInput ? (
                                          <div className={styles.toolSection}>
                                            <div
                                              className={styles.traceCodeHeader}
                                            >
                                              <div
                                                className={
                                                  styles.traceCodeTitle
                                                }
                                              >
                                                {t("inbox.traceInput")}
                                              </div>
                                              <button
                                                type="button"
                                                className={
                                                  styles.traceCodeCopyBtn
                                                }
                                                onClick={() =>
                                                  void copyTraceBlock(
                                                    formatToolBlockContent(
                                                      formatToolInput(
                                                        item.toolInput || "",
                                                      ),
                                                    ),
                                                  )
                                                }
                                                title={t("common.copy")}
                                              >
                                                <CopyOutlined />
                                              </button>
                                            </div>
                                            <pre
                                              className={styles.toolCodeBlock}
                                            >
                                              {formatToolBlockContent(
                                                formatToolInput(item.toolInput),
                                              )}
                                            </pre>
                                          </div>
                                        ) : null}
                                        {item.toolOutput ? (
                                          <div className={styles.toolSection}>
                                            <div
                                              className={styles.traceCodeHeader}
                                            >
                                              <div
                                                className={
                                                  styles.traceCodeTitle
                                                }
                                              >
                                                {t("inbox.traceOutput")}
                                              </div>
                                              <button
                                                type="button"
                                                className={
                                                  styles.traceCodeCopyBtn
                                                }
                                                onClick={() =>
                                                  void copyTraceBlock(
                                                    formatToolBlockContent(
                                                      item.toolOutput || "",
                                                    ),
                                                  )
                                                }
                                                title={t("common.copy")}
                                              >
                                                <CopyOutlined />
                                              </button>
                                            </div>
                                            <pre
                                              className={styles.toolCodeBlock}
                                            >
                                              {formatToolBlockContent(
                                                item.toolOutput,
                                              )}
                                            </pre>
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : item.traceText ? (
                                      <div
                                        className={styles.traceMarkdownBlock}
                                      >
                                        <ReactMarkdown
                                          remarkPlugins={[remarkGfm]}
                                        >
                                          {item.traceText}
                                        </ReactMarkdown>
                                      </div>
                                    ) : (
                                      <pre className={styles.traceJsonBlock}>
                                        {JSON.stringify(
                                          item.eventRecord,
                                          null,
                                          2,
                                        )}
                                      </pre>
                                    ),
                                },
                              ]}
                            />
                          ) : item.traceText ? (
                            <div className={styles.traceMarkdownBlock}>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {item.traceText}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <pre className={styles.traceJsonBlock}>
                              {JSON.stringify(item.eventRecord, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className={styles.traceMarkdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {current?.body || ""}
                  </ReactMarkdown>
                </div>
              )}
            </Card>
            <Button
              icon={<ChevronRight size={18} />}
              disabled={currentIndex === magazines.length - 1}
              onClick={() => {
                const next = Math.min(currentIndex + 1, magazines.length - 1);
                setCurrentIndex(next);
                const item = magazines[next];
                if (item) {
                  void loadTrace(
                    item,
                    Math.floor(item.createdAt.getTime() / 1000),
                  );
                }
              }}
            />
          </div>
          <div className={styles.timeline}>
            {magazines.map((mag, index) => (
              <button
                key={mag.id}
                className={`${styles.timelineItem} ${
                  index === currentIndex ? styles.active : ""
                }`}
                onClick={() => {
                  setCurrentIndex(index);
                  if (!mag.read) {
                    onReadExecution?.(mag.id);
                  }
                  void loadTrace(
                    mag,
                    Math.floor(mag.createdAt.getTime() / 1000),
                  );
                }}
              >
                {!mag.read ? <span className={styles.unreadDot} /> : null}
                <span>{mag.createdAt.toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
