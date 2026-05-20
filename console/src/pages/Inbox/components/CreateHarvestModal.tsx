import { useEffect } from "react";
import { Modal, Form, Input, Button } from "antd";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HarvestUpsertPayload } from "../types";
import styles from "./CreateHarvestModal.module.less";

interface CreateHarvestModalProps {
  open: boolean;
  initialValues?: HarvestUpsertPayload | null;
  onClose: () => void;
  onSubmit: (values: HarvestUpsertPayload) => void;
}

const REQUEST_CONTENT_EXAMPLE = JSON.stringify(
  [
    {
      role: "user",
      content: [{ type: "text", text: "您的消息内容" }],
    },
  ],
  null,
  2,
);

export function CreateHarvestModal({
  open,
  initialValues,
  onClose,
  onSubmit,
}: CreateHarvestModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      id: initialValues?.id,
      name: initialValues?.name || "",
      cron: initialValues?.cron || "0 9 * * *",
      timezone: initialValues?.timezone || "Asia/Shanghai",
      requestText: initialValues?.requestText || REQUEST_CONTENT_EXAMPLE,
    });
  }, [form, initialValues, open]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={860}
      title={
        <span className={styles.modalTitle}>
          <Sparkles size={18} />
          {initialValues?.id
            ? t("inbox.harvestEditTitle")
            : t("inbox.harvestCreateTitle")}
        </span>
      }
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) =>
          onSubmit({
            id: values.id,
            name: values.name?.trim(),
            cron: values.cron?.trim(),
            timezone: values.timezone?.trim(),
            requestText: values.requestText?.trim(),
          })
        }
        className={styles.formSection}
      >
        <Form.Item name="id" hidden>
          <Input />
        </Form.Item>
        <Form.Item
          name="name"
          label={t("inbox.harvestNameLabel")}
          rules={[{ required: true, message: t("inbox.harvestNameRequired") }]}
        >
          <Input placeholder={t("inbox.harvestNamePlaceholder")} />
        </Form.Item>
        <Form.Item
          name="cron"
          label={t("inbox.harvestCronLabel")}
          rules={[
            { required: true, message: t("inbox.harvestCronRequired") },
            {
              pattern: /^(\S+\s+){4}\S+$/,
              message: t("inbox.harvestCronInvalid"),
            },
          ]}
        >
          <Input placeholder="0 9 * * *" />
        </Form.Item>
        <Form.Item
          name="timezone"
          label={t("inbox.harvestTimezoneLabel")}
          rules={[
            { required: true, message: t("inbox.harvestTimezoneRequired") },
          ]}
        >
          <Input placeholder="Asia/Shanghai" />
        </Form.Item>
        <Form.Item
          name="requestText"
          label={t("inbox.harvestRequestContentLabel")}
          extra={t("inbox.harvestRequestContentFormat")}
          rules={[
            {
              required: true,
              message: t("inbox.harvestRequestContentRequired"),
            },
            {
              validator: async (_, value) => {
                const text = String(value || "").trim();
                if (!text) return;
                let parsed: unknown;
                try {
                  parsed = JSON.parse(text);
                } catch {
                  throw new Error(t("inbox.harvestRequestContentJsonError"));
                }
                if (!Array.isArray(parsed)) {
                  throw new Error(t("inbox.harvestRequestContentArrayError"));
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={8} placeholder={REQUEST_CONTENT_EXAMPLE} />
        </Form.Item>
        <div className={styles.actions}>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="primary" htmlType="submit">
            {initialValues?.id
              ? t("inbox.harvestSaveButton")
              : t("inbox.harvestCreateButton")}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
