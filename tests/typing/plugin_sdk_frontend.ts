import {
  getHost,
  forApp,
  tasks,
  checkpoints,
  type ComposerSnapshot,
  type ModelSelection,
} from "../../src/qwenpaw/plugins/frontend/index.js";

const host = getHost();
const draft: ComposerSnapshot | null = host.chat.composer.read();
const model: Promise<ModelSelection | null> = host.chat.composer.model();
void model;
if (draft) {
  const applied: boolean = host.chat.composer.replace(draft, "Improved prompt");
  void applied;
  // @ts-expect-error Snapshots are readonly.
  draft.text = "changed";
  // @ts-expect-error Replacement requires text.
  host.chat.composer.replace(draft, 42);
}
void host.host.selectAgent("workspace");
// @ts-expect-error There is no arbitrary session reader on the composer.
host.chat.composer.read("other-session");
// @ts-expect-error Nonexistent APIs must fail type checking.
host.chat.composer.replaceAll("text");
// @ts-expect-error Workspace identifiers are strings.
host.host.selectAgent(42);
void forApp("app").chat("hello", {
  model: { provider_id: "provider", model_id: "model" },
});
void tasks("app").start({
  message: "hello",
  model: { provider_id: "provider", model_id: "model" },
});
// @ts-expect-error Model selection requires both typed identifiers.
void forApp("app").chat("hello", { model: { model_id: "model" } });
void checkpoints("app").timeline({ chatId: "selected", limit: 20 });
void checkpoints("app").restore("checkpoint", { chatId: "selected" });
// @ts-expect-error Restore is bound to an explicitly selected conversation.
void checkpoints("app").restore("checkpoint", {});
// @ts-expect-error File selections must be path arrays.
void checkpoints("app").previewRestore("checkpoint", {
  chatId: "selected",
  files: true,
});
const menu = host.menu.add("app", {
  id: "app.menu",
  label: "App",
  route: "app.page",
});
const route = host.route.add("app", {
  id: "app.page",
  path: "/app",
  component: () => null,
});
menu.dispose();
route.dispose();
// @ts-expect-error Route paths are required strings.
host.route.add("app", { id: "invalid", path: 2, component: () => null });
// @ts-expect-error Internal registry mutations are not part of the additive SDK.
host.menu.replaceEverything([]);
