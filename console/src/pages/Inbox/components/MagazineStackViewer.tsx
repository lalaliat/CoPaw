import { useMemo, useState } from "react";
import { Modal, Button, Card, Empty, Spin } from "antd";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import api from "../../../api";
import type { HarvestExecution, HarvestInstance } from "../types";
import styles from "./MagazineStackViewer.module.less";

interface MagazineStackViewerProps {
  open: boolean;
  harvest: HarvestInstance;
  executions: HarvestExecution[];
  loading?: boolean;
  onReadExecution?: (executionId: string) => void;
  onClose: () => void;
}

export function MagazineStackViewer({
  open,
  harvest,
  executions,
  loading = false,
  onReadExecution,
  onClose,
}: MagazineStackViewerProps) {
  const magazines = useMemo(() => executions, [executions]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceText, setTraceText] = useState("");
  const current = magazines[currentIndex] || null;

  const loadTrace = async (runId?: string, fallbackBody?: string) => {
    if (!runId) {
      setTraceText(fallbackBody || "");
      return;
    }
    setTraceLoading(true);
    try {
      const trace = await api.getInboxTrace(runId);
      const text = (trace.events || [])
        .map((item) => {
          const event = item.event || {};
          const content = Array.isArray(event.content) ? event.content : [];
          return content
            .map((block) => {
              if (!block || typeof block !== "object") return "";
              if (block.type === "text" && typeof block.text === "string")
                return block.text;
              return "";
            })
            .filter(Boolean)
            .join("\n");
        })
        .filter(Boolean)
        .join("\n\n")
        .trim();
      setTraceText(text || fallbackBody || "");
    } catch {
      setTraceText(fallbackBody || "");
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
      title={`${harvest.name} · History`}
      destroyOnClose
      afterOpenChange={(opened) => {
        if (!opened) return;
        setCurrentIndex(0);
        const first = executions[0];
        if (first) {
          void loadTrace(first.runId, first.body);
        }
      }}
    >
      {loading ? (
        <div className={styles.loadingWrap}>
          <Spin />
        </div>
      ) : magazines.length <= 0 ? (
        <Empty description="No execution results yet" />
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
                void loadTrace(item?.runId, item?.body);
              }}
            />
            <Card className={styles.contentCard}>
              <h3>{current?.title}</h3>
              <p className={styles.date}>
                {current?.createdAt.toLocaleString()} · {current?.status}
              </p>
              {traceLoading ? (
                <div className={styles.loadingWrap}>
                  <Spin size="small" />
                </div>
              ) : (
                <div className={styles.traceMarkdown}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {traceText || current?.body || ""}
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
                void loadTrace(item?.runId, item?.body);
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
                  void loadTrace(mag.runId, mag.body);
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
