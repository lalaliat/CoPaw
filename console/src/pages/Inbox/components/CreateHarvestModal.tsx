import { useEffect } from "react";
import { Modal, Form, Input, Button } from "antd";
import { Sparkles } from "lucide-react";
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
          {initialValues?.id ? "Edit Harvest" : "Create Harvest"}
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
          label="Harvest Name"
          rules={[{ required: true, message: "Please input harvest name" }]}
        >
          <Input placeholder="Tech Frontier Harvest" />
        </Form.Item>
        <Form.Item
          name="cron"
          label="Cron (5 fields)"
          rules={[
            { required: true, message: "Please input cron expression" },
            {
              pattern: /^(\S+\s+){4}\S+$/,
              message: "Cron must contain 5 fields",
            },
          ]}
        >
          <Input placeholder="0 9 * * *" />
        </Form.Item>
        <Form.Item
          name="timezone"
          label="Timezone"
          rules={[{ required: true, message: "Please input timezone" }]}
        >
          <Input placeholder="Asia/Shanghai" />
        </Form.Item>
        <Form.Item
          name="requestText"
          label="Request Content"
          extra='Format: [{"role":"user","content":[{"type":"text","text":"..."}]}]'
          rules={[
            { required: true, message: "Please input request content" },
            {
              validator: async (_, value) => {
                const text = String(value || "").trim();
                if (!text) return;
                let parsed: unknown;
                try {
                  parsed = JSON.parse(text);
                } catch {
                  throw new Error("Request content must be valid JSON");
                }
                if (!Array.isArray(parsed)) {
                  throw new Error("Request content must be a JSON array");
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={8} placeholder={REQUEST_CONTENT_EXAMPLE} />
        </Form.Item>
        <div className={styles.actions}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" htmlType="submit">
            {initialValues?.id ? "Save Harvest" : "Create Harvest"}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
