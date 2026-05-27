import { Form, Input, InputNumber, Switch } from "@agentscope-ai/design";
import { useTranslation } from "react-i18next";
import type { FormInstance } from "antd";
import type { CronJobFormValues } from "../../../../api/types";
import styles from "../index.module.less";

type CronJobForm = CronJobFormValues;

interface NotifyIfFieldsProps {
  form: FormInstance<CronJobForm>;
}

export function NotifyIfFields({ form }: NotifyIfFieldsProps) {
  const { t } = useTranslation();
  const notifyIfEnabled = Form.useWatch("notifyIfEnabled", form);

  return (
    <>
      <div className={styles.sectionTitle}>{t("cronJobs.notifyIfSection")}</div>

      <Form.Item
        name="notifyIfEnabled"
        label={t("cronJobs.notifyIfEnabled")}
        valuePropName="checked"
        tooltip={t("cronJobs.notifyIfEnabledTooltip")}
      >
        <Switch
          onChange={(checked) => {
            if (!checked) {
              return;
            }
            const current = form.getFieldValue("notify_if");
            form.setFieldsValue({
              notify_if: {
                command: current?.command || "bash scripts/qa-should-notify.sh",
                timeout_seconds: current?.timeout_seconds ?? 30,
                bypass_on_manual: current?.bypass_on_manual ?? true,
              },
            });
          }}
        />
      </Form.Item>

      {notifyIfEnabled ? (
        <>
          <Form.Item
            name={["notify_if", "command"]}
            label={t("cronJobs.notifyIfCommand")}
            tooltip={t("cronJobs.notifyIfCommandTooltip")}
            rules={[
              {
                required: true,
                message: t("cronJobs.pleaseInputNotifyIfCommand"),
              },
            ]}
            extra={t("cronJobs.notifyIfExitCodeHint")}
          >
            <Input placeholder="bash scripts/qa-should-notify.sh" />
          </Form.Item>

          <Form.Item
            name={["notify_if", "timeout_seconds"]}
            label={t("cronJobs.notifyIfTimeoutSeconds")}
            tooltip={t("cronJobs.notifyIfTimeoutSecondsTooltip")}
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name={["notify_if", "bypass_on_manual"]}
            label={t("cronJobs.notifyIfBypassOnManual")}
            valuePropName="checked"
            tooltip={t("cronJobs.notifyIfBypassOnManualTooltip")}
          >
            <Switch />
          </Form.Item>
        </>
      ) : null}
    </>
  );
}
