import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Drawer,
  Empty,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  DragOutlined,
} from "@ant-design/icons";
import { Sparkles, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/PageHeader";
import { useAgentStore } from "../../stores/agentStore";
import { fragmentsApi } from "../../api/modules/fragments";
import type { FragmentSpec, FragmentCreate } from "../../api/modules/fragments";
import { getApiUrl } from "../../api";
import { buildAuthHeaders } from "../../api/authHeaders";
import styles from "./index.module.less";

const STANCE_COLORS: Record<string, string> = {
  insight: "gold",
  question: "blue",
  analogy: "purple",
  todo: "green",
  reference: "cyan",
};

const STANCE_LABELS: Record<string, string> = {
  insight: "💡 Insight",
  question: "❓ Question",
  analogy: "🔗 Analogy",
  todo: "✅ Todo",
  reference: "📚 Reference",
};

const CARD_WIDTH = 260;
const CARD_HEIGHT = 200;
const CARD_GAP = 20;
const BOARD_PADDING = 30;
const POSITIONS_STORAGE_KEY = "qwenpaw.fragments.positions";

interface CardPosition {
  x: number;
  y: number;
}

function getStoredPositions(): Record<string, CardPosition> {
  try {
    const raw = localStorage.getItem(POSITIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function storePositions(positions: Record<string, CardPosition>) {
  try {
    localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // ignore
  }
}

function autoLayoutPosition(
  index: number,
  containerWidth: number,
): CardPosition {
  const cols = Math.max(
    1,
    Math.floor((containerWidth - BOARD_PADDING * 2) / (CARD_WIDTH + CARD_GAP)),
  );
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: BOARD_PADDING + col * (CARD_WIDTH + CARD_GAP),
    y: BOARD_PADDING + row * (CARD_HEIGHT + CARD_GAP),
  };
}

export default function FragmentsPage() {
  const { t } = useTranslation();
  const selectedAgent = useAgentStore((s) => s.selectedAgent);
  const agentId = selectedAgent || "default";

  const [fragments, setFragments] = useState<FragmentSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [topicFilter, setTopicFilter] = useState<string | undefined>();
  const [stanceFilter, setStanceFilter] = useState<string | undefined>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [allTopics, setAllTopics] = useState<string[]>([]);

  // Card positions for board mode
  const [positions, setPositions] =
    useState<Record<string, CardPosition>>(getStoredPositions);

  // Drag state
  const [dragging, setDragging] = useState<string | null>(null);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    cardX: number;
    cardY: number;
  } | null>(null);

  // View mode
  const [viewMode, setViewMode] = useState<"board" | "grid">("board");

  // Create fragment modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createText, setCreateText] = useState("");
  const [creating, setCreating] = useState(false);

  // Collide drawer
  const [collideOpen, setCollideOpen] = useState(false);
  const [collideMode, setCollideMode] = useState<"analytical" | "creative">(
    "analytical",
  );
  const [collideResult, setCollideResult] = useState("");
  const [colliding, setColliding] = useState(false);

  // Detail modal
  const [detailFragment, setDetailFragment] = useState<FragmentSpec | null>(
    null,
  );

  const boardRef = useRef<HTMLDivElement>(null);

  const loadFragments = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (topicFilter) params.topics = topicFilter;
      if (stanceFilter) params.stance = stanceFilter;
      const result = await fragmentsApi.listFragments(agentId, params);
      setFragments(result || []);
    } catch (err) {
      console.error("Failed to load fragments", err);
    } finally {
      setLoading(false);
    }
  }, [agentId, topicFilter, stanceFilter]);

  const loadTopics = useCallback(async () => {
    try {
      const topics = await fragmentsApi.getAllTopics(agentId);
      setAllTopics(topics || []);
    } catch {
      // ignore
    }
  }, [agentId]);

  useEffect(() => {
    void loadFragments();
    void loadTopics();
  }, [loadFragments, loadTopics]);

  const filteredFragments = useMemo(() => {
    return fragments;
  }, [fragments]);

  const getCardPosition = useCallback(
    (fragmentId: string, index: number): CardPosition => {
      if (positions[fragmentId]) return positions[fragmentId];
      const containerWidth = boardRef.current?.clientWidth || 1200;
      return autoLayoutPosition(index, containerWidth);
    },
    [positions],
  );

  // Assign positions to new fragments that don't have stored positions
  useEffect(() => {
    if (viewMode !== "board" || filteredFragments.length === 0) return;
    const containerWidth = boardRef.current?.clientWidth || 1200;
    const stored = getStoredPositions();
    let updated = false;
    const newPositions = { ...stored };
    filteredFragments.forEach((f, i) => {
      if (!newPositions[f.id]) {
        newPositions[f.id] = autoLayoutPosition(i, containerWidth);
        updated = true;
      }
    });
    if (updated) {
      setPositions(newPositions);
      storePositions(newPositions);
    }
  }, [filteredFragments, viewMode]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, fragmentId: string) => {
      if (
        (e.target as HTMLElement).closest(
          "button, .qwenpaw-checkbox-wrapper, .qwenpaw-popover",
        )
      )
        return;
      e.preventDefault();
      const pos = positions[fragmentId] || { x: 0, y: 0 };
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        cardX: pos.x,
        cardY: pos.y,
      };
      setDragging(fragmentId);
    },
    [positions],
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      const newPos = {
        x: Math.max(0, dragStartRef.current.cardX + dx),
        y: Math.max(0, dragStartRef.current.cardY + dy),
      };
      setPositions((prev) => {
        const next = { ...prev, [dragging]: newPos };
        return next;
      });
    };

    const handleUp = () => {
      setDragging(null);
      dragStartRef.current = null;
      setPositions((prev) => {
        storePositions(prev);
        return prev;
      });
    };

    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [dragging]);

  const handleCreate = async () => {
    if (!createText.trim()) return;
    setCreating(true);
    try {
      const body: FragmentCreate = { source_text: createText.trim() };
      await fragmentsApi.createFragment(agentId, body);
      message.success(t("fragments.createSuccess"));
      setCreateText("");
      setCreateOpen(false);
      void loadFragments();
      void loadTopics();
      setTimeout(() => {
        void loadFragments();
        void loadTopics();
      }, 3000);
      setTimeout(() => {
        void loadFragments();
        void loadTopics();
      }, 8000);
    } catch {
      message.error(t("common.operationFailed"));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fragmentsApi.deleteFragment(agentId, id);
      setFragments((prev) => prev.filter((f) => f.id !== id));
      setSelectedIds((prev) => prev.filter((sid) => sid !== id));
      message.success(t("fragments.deleted"));
    } catch {
      message.error(t("common.operationFailed"));
    }
  };

  const handleBatchDelete = async () => {
    if (!selectedIds.length) return;
    try {
      await fragmentsApi.batchDeleteFragments(agentId, selectedIds);
      setFragments((prev) => prev.filter((f) => !selectedIds.includes(f.id)));
      message.success(
        t("fragments.batchDeleted", { count: selectedIds.length }),
      );
      setSelectedIds([]);
    } catch {
      message.error(t("common.operationFailed"));
    }
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((sid) => sid !== id),
    );
  };

  const handleCollide = async () => {
    if (selectedIds.length < 2) {
      message.warning(t("fragments.selectAtLeast2"));
      return;
    }
    setCollideOpen(true);
    setColliding(true);
    setCollideResult("");

    try {
      const url = getApiUrl(`/agents/${agentId}/fragments/collide`);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(),
        },
        body: JSON.stringify({
          fragment_ids: selectedIds,
          mode: collideMode,
        }),
      });

      if (!response.ok) throw new Error(`Collide failed: ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setCollideResult(text);
      }
    } catch (err) {
      message.error(t("fragments.collideFailed"));
      console.error(err);
    } finally {
      setColliding(false);
    }
  };

  const handleSaveCollideResult = async () => {
    if (!collideResult.trim()) return;
    try {
      await fragmentsApi.createFragment(agentId, {
        source_text: collideResult,
        generation: 1,
      });
      message.success(t("fragments.savedAsFragment"));
      setTimeout(() => void loadFragments(), 2000);
      void loadFragments();
    } catch {
      message.error(t("common.operationFailed"));
    }
  };

  const handleResetLayout = () => {
    const containerWidth = boardRef.current?.clientWidth || 1200;
    const newPositions: Record<string, CardPosition> = {};
    filteredFragments.forEach((f, i) => {
      newPositions[f.id] = autoLayoutPosition(i, containerWidth);
    });
    setPositions(newPositions);
    storePositions(newPositions);
  };

  const topicOptions = useMemo(
    () => allTopics.map((topic) => ({ value: topic, label: `#${topic}` })),
    [allTopics],
  );

  const stanceOptions = Object.entries(STANCE_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  const boardHeight = useMemo(() => {
    if (viewMode !== "board" || filteredFragments.length === 0) return 600;
    let maxY = 0;
    filteredFragments.forEach((f, i) => {
      const pos = positions[f.id] || autoLayoutPosition(i, 1200);
      if (pos.y + CARD_HEIGHT > maxY) maxY = pos.y + CARD_HEIGHT;
    });
    return Math.max(600, maxY + 100);
  }, [filteredFragments, positions, viewMode]);

  const renderCard = (fragment: FragmentSpec, index: number) => {
    const isSelected = selectedIds.includes(fragment.id);
    const pos =
      viewMode === "board" ? getCardPosition(fragment.id, index) : undefined;

    return (
      <div
        key={fragment.id}
        className={`${styles.fragmentCard} ${
          isSelected ? styles.selected : ""
        } ${fragment.generation > 0 ? styles.generated : ""} ${
          dragging === fragment.id ? styles.dragging : ""
        }`}
        style={
          viewMode === "board" && pos
            ? {
                position: "absolute",
                left: pos.x,
                top: pos.y,
                width: CARD_WIDTH,
              }
            : undefined
        }
        onMouseDown={
          viewMode === "board"
            ? (e) => handleMouseDown(e, fragment.id)
            : undefined
        }
      >
        <div className={styles.cardTop}>
          <Checkbox
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              toggleSelect(fragment.id, e.target.checked);
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <Tag
            color={STANCE_COLORS[fragment.stance] || "default"}
            className={styles.stanceTag}
          >
            {STANCE_LABELS[fragment.stance] || fragment.stance}
          </Tag>
          {fragment.generation > 0 && (
            <Tag color="magenta" className={styles.stanceTag}>
              <Sparkles size={10} style={{ marginRight: 2 }} />G
              {fragment.generation}
            </Tag>
          )}
          {viewMode === "board" && (
            <DragOutlined className={styles.dragHandle} />
          )}
        </div>

        <div className={styles.cardBody}>
          <h4 className={styles.surface}>
            {fragment.surface ||
              (fragment.source_text || "").slice(0, 30) ||
              t("fragments.noSummary", "...")}
          </h4>
          <p className={styles.gist}>
            {fragment.gist || (fragment.source_text || "").slice(0, 100)}
          </p>
        </div>

        <div className={styles.cardBottom}>
          <div className={styles.topics}>
            {fragment.topics.slice(0, 3).map((topic) => (
              <span key={topic} className={styles.topicTag}>
                #{topic}
              </span>
            ))}
          </div>
          <div className={styles.cardActions}>
            {fragment.spark && (
              <Tooltip title={fragment.spark}>
                <Sparkles size={13} className={styles.sparkIcon} />
              </Tooltip>
            )}
            <Tooltip title={t("fragments.viewDetail")}>
              <Button
                type="text"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setDetailFragment(fragment);
                }}
              >
                ···
              </Button>
            </Tooltip>
            <Popconfirm
              title={t("fragments.deleteConfirm")}
              onConfirm={(e) => {
                e?.stopPropagation();
                void handleDelete(fragment.id);
              }}
              onCancel={(e) => e?.stopPropagation()}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          </div>
        </div>

        <div className={styles.cardDate}>
          {new Date(fragment.created_at).toLocaleDateString()}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.fragmentsPage}>
      <PageHeader
        items={[{ title: t("fragments.title") }]}
        extra={
          <Space>
            {selectedIds.length >= 2 && (
              <>
                <Select
                  size="small"
                  value={collideMode}
                  onChange={setCollideMode}
                  options={[
                    {
                      value: "analytical",
                      label: t("fragments.modeAnalytical"),
                    },
                    { value: "creative", label: t("fragments.modeCreative") },
                  ]}
                  style={{ width: 140 }}
                />
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  onClick={() => void handleCollide()}
                >
                  {t("fragments.collide")} ({selectedIds.length})
                </Button>
              </>
            )}
            {selectedIds.length > 0 && (
              <Popconfirm
                title={t("fragments.batchDeleteConfirm")}
                onConfirm={() => void handleBatchDelete()}
              >
                <Button danger size="small" icon={<DeleteOutlined />}>
                  {t("common.delete")}
                </Button>
              </Popconfirm>
            )}
            <Button icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              {t("fragments.create")}
            </Button>
          </Space>
        }
      />

      <div className={styles.pageContent}>
        <div className={styles.toolbar}>
          <div className={styles.filters}>
            <Select
              allowClear
              value={topicFilter}
              onChange={(v) => setTopicFilter(v)}
              options={topicOptions}
              placeholder={t("fragments.filterByTopic")}
              style={{ width: 180 }}
            />
            <Select
              allowClear
              value={stanceFilter}
              onChange={(v) => setStanceFilter(v)}
              options={stanceOptions}
              placeholder={t("fragments.filterByType")}
              style={{ width: 160 }}
            />
          </div>
          <div className={styles.actions}>
            {selectedIds.length > 0 && (
              <span className={styles.selectedCount}>
                {t("fragments.selected", { count: selectedIds.length })}
              </span>
            )}
            <Tooltip
              title={
                viewMode === "board"
                  ? t("fragments.gridView", "Grid view")
                  : t("fragments.boardView", "Board view")
              }
            >
              <Button
                size="small"
                icon={
                  viewMode === "board" ? <AppstoreOutlined /> : <DragOutlined />
                }
                onClick={() =>
                  setViewMode((v) => (v === "board" ? "grid" : "board"))
                }
              />
            </Tooltip>
            {viewMode === "board" && (
              <Tooltip title={t("fragments.resetLayout", "Reset layout")}>
                <Button size="small" onClick={handleResetLayout}>
                  ↻
                </Button>
              </Tooltip>
            )}
            <Tooltip title={t("common.refresh")}>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => void loadFragments()}
              />
            </Tooltip>
          </div>
        </div>

        {loading ? (
          <div className={styles.loadingWrap}>
            <Spin />
          </div>
        ) : filteredFragments.length === 0 ? (
          <Empty
            description={t("fragments.empty")}
            className={styles.emptyState}
          >
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              {t("fragments.createFirst")}
            </Button>
          </Empty>
        ) : viewMode === "board" ? (
          <div
            ref={boardRef}
            className={styles.board}
            style={{ height: boardHeight }}
          >
            {filteredFragments.map((f, i) => renderCard(f, i))}
          </div>
        ) : (
          <div className={styles.cardGrid}>
            {filteredFragments.map((f, i) => renderCard(f, i))}
          </div>
        )}
      </div>

      {/* Create Fragment Modal */}
      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title={t("fragments.createTitle")}
        okText={t("fragments.capture")}
        onOk={() => void handleCreate()}
        confirmLoading={creating}
      >
        <Input.TextArea
          value={createText}
          onChange={(e) => setCreateText(e.target.value)}
          placeholder={t("fragments.createPlaceholder")}
          rows={5}
          maxLength={2000}
          showCount
          autoFocus
        />
        <p className={styles.createHint}>{t("fragments.createHint")}</p>
      </Modal>

      {/* Detail Modal */}
      <Modal
        open={!!detailFragment}
        onCancel={() => setDetailFragment(null)}
        footer={null}
        width={640}
        title={detailFragment?.surface || "Fragment Detail"}
      >
        {detailFragment && (
          <div className={styles.detailContent}>
            <div className={styles.detailMeta}>
              <div>
                <strong>{t("fragments.gist")}:</strong>{" "}
                {detailFragment.gist || "-"}
              </div>
              <div>
                <strong>{t("fragments.type")}:</strong>{" "}
                <Tag color={STANCE_COLORS[detailFragment.stance]}>
                  {STANCE_LABELS[detailFragment.stance]}
                </Tag>
              </div>
              <div>
                <strong>{t("fragments.topics")}:</strong>{" "}
                {detailFragment.topics.map((topic) => `#${topic}`).join(", ") ||
                  "-"}
              </div>
              {detailFragment.spark && (
                <div>
                  <strong>{t("fragments.spark")}:</strong>{" "}
                  {detailFragment.spark}
                </div>
              )}
              <div>
                <strong>{t("fragments.created")}:</strong>{" "}
                {new Date(detailFragment.created_at).toLocaleString()}
              </div>
              {detailFragment.generation > 0 && (
                <div>
                  <strong>Generation:</strong> {detailFragment.generation}
                </div>
              )}
            </div>
            <div className={styles.detailSource}>
              <strong>{t("fragments.sourceText")}:</strong>
              <div className={styles.sourceBlock}>
                {detailFragment.source_text}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Collide Drawer */}
      <Drawer
        open={collideOpen}
        onClose={() => setCollideOpen(false)}
        title={
          <Space>
            <Zap size={18} />
            {t("fragments.collideTitle")}
          </Space>
        }
        width={640}
        extra={
          collideResult.trim() ? (
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => void handleSaveCollideResult()}
            >
              {t("fragments.saveAsFragment")}
            </Button>
          ) : null
        }
      >
        {colliding ? (
          <div className={styles.collideLoading}>
            <Spin />
            <p>{t("fragments.colliding")}</p>
          </div>
        ) : null}
        {collideResult ? (
          <div className={styles.collideResult}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {collideResult}
            </ReactMarkdown>
          </div>
        ) : !colliding ? (
          <Empty description={t("fragments.collideEmpty")} />
        ) : null}
      </Drawer>
    </div>
  );
}
