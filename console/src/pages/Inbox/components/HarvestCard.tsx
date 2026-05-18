import { Card, Button, Badge, Progress } from "antd";
import { Zap, BookOpen, Settings, Clock, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HarvestInstance } from "../types";
import { useHarvestCountdown } from "../hooks/useHarvestCountdown";
import styles from "./HarvestCard.module.less";

interface HarvestCardProps {
  harvest: HarvestInstance;
  onTrigger: (id: string) => void;
  onViewAll: (id: string) => void;
  onSettings: (id: string) => void;
}

export function HarvestCard({
  harvest,
  onTrigger,
  onViewAll,
  onSettings,
}: HarvestCardProps) {
  const { t } = useTranslation();
  const countdown = useHarvestCountdown(harvest.nextRunAt);
  const timeText = countdown.isOverdue
    ? t("inbox.ready")
    : `${String(countdown.hours).padStart(2, "0")}:${String(
        countdown.minutes,
      ).padStart(2, "0")}:${String(countdown.seconds).padStart(2, "0")}`;
  const statusText =
    harvest.status === "paused"
      ? "Paused"
      : countdown.isOverdue
      ? "Ready"
      : t("inbox.statusGrowing");
  const lastRunLabel = harvest.lastRunAt
    ? harvest.lastRunAt.toLocaleString()
    : "Never";
  const latestOutput = harvest.latestOutputTitle || "No output yet";

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
          <span className={styles.emoji}>{harvest.emoji}</span>
          <h3 className={styles.title}>{harvest.name}</h3>
        </div>
        <Badge
          status={harvest.status === "active" ? "processing" : "default"}
          text={harvest.enabled ? "active" : "paused"}
        />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.countdownSection}>
          <Progress
            type="circle"
            size={90}
            percent={Math.round(countdown.percentage)}
            format={() => (
              <span style={{ fontSize: 15, fontWeight: 600 }}>{timeText}</span>
            )}
            strokeColor={countdown.isOverdue ? "#FFD700" : "#FF7F16"}
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
          <div className={styles.statItem}>
            <Trophy size={14} />
            <span>
              {t("inbox.harvestSuccessRate", {
                rate: harvest.stats.successRate,
              })}
            </span>
          </div>
        </div>
        <div className={styles.lastRunSection}>
          <span className={styles.lastRunLabel}>
            Last harvest: {lastRunLabel}
          </span>
        </div>
        <div className={styles.latestOutputSection}>
          <div className={styles.latestOutputTitle}>Latest Output</div>
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
          icon={<Settings size={15} />}
          onClick={() => onSettings(harvest.id)}
        />
      </div>
    </Card>
  );
}
