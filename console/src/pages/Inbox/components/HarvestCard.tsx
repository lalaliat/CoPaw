import { Card, Button, Badge, Progress, Popconfirm } from "antd";
import { Zap, BookOpen, Settings, Clock, Pause, Play } from "lucide-react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HarvestInstance } from "../types";
import { useHarvestCountdown } from "../hooks/useHarvestCountdown";
import styles from "./HarvestCard.module.less";

interface HarvestCardProps {
  harvest: HarvestInstance;
  onTrigger: (id: string) => void;
  onViewAll: (id: string) => void;
  onSettings: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
}

export function HarvestCard({
  harvest,
  onTrigger,
  onViewAll,
  onSettings,
  onDelete,
  onToggleEnabled,
}: HarvestCardProps) {
  const { t } = useTranslation();
  const countdown = useHarvestCountdown(harvest.nextRunAt);
  const isPaused = !harvest.enabled || harvest.status === "paused";
  const timeText = countdown.isOverdue
    ? t("inbox.ready")
    : `${String(countdown.hours).padStart(2, "0")}:${String(
        countdown.minutes,
      ).padStart(2, "0")}:${String(countdown.seconds).padStart(2, "0")}`;
  const statusText = isPaused
    ? t("inbox.harvestStatusPaused")
    : countdown.isOverdue
    ? t("inbox.ready")
    : t("inbox.statusGrowing");
  const lastRunLabel = harvest.lastRunAt
    ? harvest.lastRunAt.toLocaleString()
    : "-";
  const latestOutput = harvest.latestOutputTitle || "-";

  return (
    <Card
      className={`${styles.harvestCard} ${
        countdown.isOverdue ? styles.harvestCardReady : ""
      }`}
      hoverable
      bodyStyle={{ padding: "16px 14px 18px" }}
    >
      <div className={styles.cardHeader}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{harvest.name}</h3>
        </div>
        <Badge
          status={harvest.status === "active" ? "processing" : "default"}
          text={
            harvest.enabled
              ? t("inbox.harvestStatusActive")
              : t("inbox.harvestStatusPaused")
          }
        />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.countdownSection}>
          <Progress
            type="circle"
            size={90}
            percent={isPaused ? 0 : Math.round(countdown.percentage)}
            format={() =>
              isPaused ? (
                <Pause size={18} />
              ) : (
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  {timeText}
                </span>
              )
            }
            strokeColor={
              isPaused ? "#bfbfbf" : countdown.isOverdue ? "#FFD700" : "#FF7F16"
            }
          />
          <div className={styles.countdownInfo}>
            <div className={styles.statusText}>
              <Clock size={14} /> {statusText}
            </div>
          </div>
        </div>
        <div className={styles.statsSection}>
          <div className={styles.statItem}>
            <Zap size={14} />
            <span>
              {t("inbox.harvestedTimes", {
                count: harvest.stats.totalGenerated,
              })}
            </span>
          </div>
        </div>
        <div className={styles.lastRunSection}>
          <span className={styles.lastRunLabel}>
            {t("inbox.harvestLastRun", { time: lastRunLabel })}
          </span>
        </div>
        <div className={styles.latestOutputSection}>
          <div className={styles.latestOutputTitle}>
            {t("inbox.harvestLatestOutput")}
          </div>
          <div className={styles.latestOutputText}>{latestOutput}</div>
        </div>
      </div>
      <div className={styles.cardActions}>
        <Button
          type="primary"
          icon={<Zap size={15} />}
          onClick={() => onTrigger(harvest.id)}
        >
          {t("inbox.harvestNow")}
        </Button>
        <Button
          icon={<BookOpen size={15} />}
          onClick={() => onViewAll(harvest.id)}
        >
          {t("inbox.viewAll")}
        </Button>
        <Button
          icon={harvest.enabled ? <Pause size={15} /> : <Play size={15} />}
          onClick={() => onToggleEnabled(harvest.id, !harvest.enabled)}
        />
        <Button
          icon={<Settings size={15} />}
          onClick={() => onSettings(harvest.id)}
        />
        <Popconfirm
          title={t("inbox.harvestDeleteConfirm")}
          onConfirm={() => onDelete(harvest.id)}
          okText={t("common.confirm")}
          cancelText={t("common.cancel")}
        >
          <Button danger icon={<Trash2 size={15} />} />
        </Popconfirm>
      </div>
    </Card>
  );
}
