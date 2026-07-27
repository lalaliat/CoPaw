import { useCallback, useEffect, useRef, useState } from "react";
import { message, Tooltip } from "antd";
import { Pin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAgentStore } from "../../../stores/agentStore";
import { fragmentsApi } from "../../../api/modules/fragments";
import styles from "./FragmentCaptureOverlay.module.less";

interface FloatingButtonPosition {
  top: number;
  left: number;
}

export function FragmentCaptureOverlay() {
  const { t } = useTranslation();
  const selectedAgent = useAgentStore((s) => s.selectedAgent);
  const agentId = selectedAgent || "default";

  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<FloatingButtonPosition>({
    top: 0,
    left: 0,
  });
  const [selectedText, setSelectedText] = useState("");
  const [saving, setSaving] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseUp = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    hideTimerRef.current = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";

      if (text.length < 10) {
        setVisible(false);
        return;
      }

      const range = selection?.getRangeAt(0);
      if (!range) {
        setVisible(false);
        return;
      }

      const chatArea = document.querySelector('[class*="chatMessagesArea"]');
      if (!chatArea) {
        setVisible(false);
        return;
      }

      const anchorNode = selection?.anchorNode;
      if (!anchorNode || !chatArea.contains(anchorNode)) {
        setVisible(false);
        return;
      }

      const rect = range.getBoundingClientRect();
      setPosition({
        top: rect.top + window.scrollY - 40,
        left: rect.left + rect.width / 2 + window.scrollX,
      });
      setSelectedText(text);
      setVisible(true);
    }, 200);
  }, []);

  const handleMouseDown = useCallback(() => {
    setVisible(false);
  }, []);

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handleMouseDown);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [handleMouseUp, handleMouseDown]);

  const handleCapture = async () => {
    if (!selectedText || saving) return;
    setSaving(true);
    try {
      await fragmentsApi.createFragment(agentId, {
        source_text: selectedText,
      });
      message.success(t("fragments.captured", "📌 Fragment captured!"));
      setVisible(false);
      window.getSelection()?.removeAllRanges();
    } catch {
      message.error(t("common.operationFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      className={styles.captureButton}
      style={{
        top: position.top,
        left: position.left,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Tooltip title={t("fragments.pinTooltip", "Capture as fragment")}>
        <button
          className={styles.pinButton}
          onClick={() => void handleCapture()}
          disabled={saving}
          type="button"
        >
          <Pin size={14} />
          <span>{t("fragments.pin", "Pin")}</span>
        </button>
      </Tooltip>
    </div>
  );
}
