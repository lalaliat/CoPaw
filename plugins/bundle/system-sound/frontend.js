// Plain ES module: uses the Console's React/Ant Design, no build step needed.
const paw = window.QwenPaw;
const { React, antd } = paw.host;
const h = React.createElement;
const { Alert, Button, Card, Select, Slider, Space, Spin, Switch, Typography } = antd;
const { Title, Text, Paragraph } = Typography;
const pluginId = "system-sound";

async function request(path, method = "GET", body) {
  const response = await paw.host.fetch(`/system-sound/${path}`, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : `请求失败（${response.status}）`);
  }
  return data;
}

function SoundSettings() {
  const [info, setInfo] = React.useState(null);
  const [draft, setDraft] = React.useState(null);
  const [saved, setSaved] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  const [notice, setNotice] = React.useState(null);
  const [reload, setReload] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    request("settings").then((data) => {
      if (cancelled) return;
      setInfo(data); setDraft(data.settings); setSaved(data.settings); setNotice(null);
    }).catch((error) => {
      if (!cancelled) setNotice({ type: "error", text: error.message });
    });
    return () => { cancelled = true; };
  }, [reload]);

  function edit(event, key, value) {
    setDraft((previous) => ({ ...previous, [event]: { ...previous[event], [key]: value } }));
    setNotice(null);
  }
  async function preview(event) {
    setBusy(event); setNotice(null);
    try {
      await request("preview", "POST", { event, sound: draft[event].sound, volume: draft.volume });
      setNotice({ type: "success", text: draft.volume === 0 ? "当前音量为 0，试听为静音。" : "已在运行 QwenPaw 的电脑上试听，设置尚未改变。" });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally { setBusy(""); }
  }
  async function save() {
    setBusy("save"); setNotice(null);
    try {
      const data = await request("settings", "PUT", draft);
      setDraft(data.settings); setSaved(data.settings);
      setNotice({ type: "success", text: "设置已保存并立即生效。" });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally { setBusy(""); }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const labels = { completion: "任务完成", approval: "等待审批" };
  const descriptions = { completion: "会话本轮任务正常结束时提醒。", approval: "出现需要你确认的审批时提醒。" };
  return h("main", { style: { maxWidth: 900, margin: "0 auto", padding: "32px 24px 48px" } },
    h(Title, { level: 2, style: { marginBottom: 8 } }, "声音提醒"),
    h(Paragraph, { type: "secondary" }, "为任务完成和等待审批选择不同的提示音。"),
    h(Alert, { type: "info", showIcon: true, message: "声音由运行 QwenPaw 的电脑播放", description: `当前系统：${info?.system || "读取中"}。如果你连接的是远程服务，声音会在远程电脑播放。`, style: { marginBottom: 24 } }),
    notice && h(Alert, { role: "status", type: notice.type, showIcon: true, message: notice.text, style: { marginBottom: 20 } }),
    !draft ? (notice?.type === "error" ? h(Button, { onClick: () => setReload((n) => n + 1) }, "重新加载") : h(Spin, { tip: "正在读取提示音设置" }, h("div", { style: { height: 180 } }))) : h(React.Fragment, null,
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 } },
        ...Object.keys(labels).map((event) => h(Card, { key: event, title: labels[event], extra: h(Switch, { "aria-label": `${labels[event]}提醒开关`, checked: draft[event].enabled, disabled: !!busy, onChange: (value) => edit(event, "enabled", value) }) },
          h(Paragraph, { type: "secondary" }, descriptions[event]),
          h("label", { htmlFor: `${event}-sound`, style: { display: "block", marginBottom: 8 } }, "提示音"),
          h(Select, { id: `${event}-sound`, "aria-label": `${labels[event]}铃声`, value: draft[event].sound, options: info.sounds, showSearch: true, optionFilterProp: "label", style: { width: "100%" }, disabled: !!busy, onChange: (value) => edit(event, "sound", value) }),
          h(Button, { style: { marginTop: 16 }, loading: busy === event, disabled: !!busy, onClick: () => preview(event), "aria-label": `试听${labels[event]}铃声` }, "试听"),
        )),
      ),
      h(Card, { style: { marginTop: 20 }, title: "多智能体协作", extra: h(Switch, { "aria-label": "仅主任务完成时提醒", checked: draft.root_only, disabled: !!busy, onChange: (value) => { setDraft((previous) => ({ ...previous, root_only: value })); setNotice(null); } }) },
        h(Text, { strong: true }, "仅主任务完成时提醒"),
        h(Paragraph, { type: "secondary", style: { marginTop: 8, marginBottom: 0 } }, "开启后，子 agent 不播放完成音。只有主 agent 本轮正常结束、且关联的子任务和后台工具都已结束时才提醒；主 agent 只派发任务就返回时不响。关闭后，每个会话正常结束都可提醒。"),
        h(Paragraph, { type: "secondary", style: { marginTop: 8, marginBottom: 0 } }, "审批提醒不受此开关影响，子任务需要确认时仍会及时提醒。"),
      ),
      h(Card, { style: { marginTop: 20 } },
        h("div", { style: { display: "flex", justifyContent: "space-between" } }, h(Text, { strong: true }, "提示音音量"), h(Text, null, `${draft.volume}%`)),
        h(Slider, { "aria-label": "提示音音量", min: 0, max: 100, step: 1, value: draft.volume, disabled: !!busy, onChange: (value) => { setDraft((previous) => ({ ...previous, volume: value })); setNotice(null); } }),
        h(Text, { type: "secondary" }, "仅调整本插件的音量，不改变系统总音量。0% 为静音。"),
      ),
      h(Space, { style: { marginTop: 24 }, wrap: true },
        h(Button, { type: "primary", onClick: save, loading: busy === "save", disabled: !dirty || !!busy }, "保存设置"),
        h(Button, { onClick: () => { setDraft(saved); setNotice(null); }, disabled: !dirty || !!busy }, "撤销修改"),
        h(Text, { type: "secondary" }, dirty ? "有尚未保存的修改" : "设置已保存"),
      ),
      h(Paragraph, { type: "secondary", style: { marginTop: 24 } }, "设置对本 QwenPaw 实例的所有会话生效，插件升级后保留。插件不会自动唤醒主 agent；若它未继续收集结果，子任务结束也不会代替主任务播放完成音。"),
    ),
  );
}

paw.route.add(pluginId, { id: "system-sound.settings", path: "/system-sound", component: SoundSettings });
paw.menu.add(pluginId, { id: "system-sound.menu", label: "声音提醒", icon: h(paw.host.antdIcons.SoundOutlined), route: "system-sound.settings", location: "primary.settings", order: 90 });
