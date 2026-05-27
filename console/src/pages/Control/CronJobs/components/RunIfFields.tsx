import { Form, Input, InputNumber, Switch } from "@agentscope-ai/design";
import { useTranslation } from "react-i18next";
import type { FormInstance } from "antd";
import type { CronJobFormValues } from "../../../../api/types";
import styles from "../index.module.less";

type CronJobForm = CronJobFormValues;

interface RunIfFieldsProps {
  form: FormInstance<CronJobForm>;
}

export function RunIfFields({ form }: RunIfFieldsProps) {
  const { t } = useTranslation();
  const runIfEnabled = Form.useWatch("runIfEnabled", form);

  return (
    <>
      <div className={styles.sectionTitle}>{t("cronJobs.runIfSection")}</div>

      <Form.Item
        name="runIfEnabled"
        label={t("cronJobs.runIfEnabled")}
        valuePropName="checked"
        tooltip={t("cronJobs.runIfEnabledTooltip")}
      >
        <Switch
          onChange={(checked) => {
            if (!checked) {
              return;
            }
            const current = form.getFieldValue("run_if");
            form.setFieldsValue({
              run_if: {
                command: current?.command || "bash scripts/should-run.sh",
                timeout_seconds: current?.timeout_seconds ?? 30,
                bypass_on_manual: current?.bypass_on_manual ?? true,
              },
            });
          }}
        />
      </Form.Item>

      {runIfEnabled ? (
        <>
          <Form.Item
            name={["run_if", "command"]}
            label={t("cronJobs.runIfCommand")}
            tooltip={t("cronJobs.runIfCommandTooltip")}
            rules={[
              {
                required: true,
                message: t("cronJobs.pleaseInputRunIfCommand"),
              },
            ]}
            extra={t("cronJobs.runIfExitCodeHint")}
          >
            <Input placeholder="bash scripts/should-run.sh" />
          </Form.Item>

          <Form.Item
            name={["run_if", "timeout_seconds"]}
            label={t("cronJobs.runIfTimeoutSeconds")}
            tooltip={t("cronJobs.runIfTimeoutSecondsTooltip")}
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item
            name={["run_if", "bypass_on_manual"]}
            label={t("cronJobs.runIfBypassOnManual")}
            valuePropName="checked"
            tooltip={t("cronJobs.runIfBypassOnManualTooltip")}
          >
            <Switch />
          </Form.Item>
        </>
      ) : null}
    </>
  );
}
