import { beforeEach, expect, it, vi } from "vitest";
import { agentsApi } from "../../api/modules/agents";
import { useAgentStore } from "../../stores/agentStore";
import { selectAgent } from "./selectAgent";
import type { AgentListResponse } from "../../api/types/agents";

vi.mock("../../api/modules/agents", () => ({
  agentsApi: { listAgents: vi.fn() },
}));
const response: AgentListResponse = {
  agents: [
    {
      id: "allowed",
      name: "Allowed",
      enabled: true,
      description: "",
      workspace_dir: "",
      backend: "qwenpaw",
    },
    {
      id: "disabled",
      name: "Disabled",
      enabled: false,
      description: "",
      workspace_dir: "",
      backend: "qwenpaw",
    },
  ],
};
beforeEach(() => {
  useAgentStore.setState({ selectedAgent: "default", agents: [] });
  vi.mocked(agentsApi.listAgents).mockResolvedValue(response);
});
it("switches through the normal store only after a fresh permitted result", async () => {
  await selectAgent("allowed");
  expect(useAgentStore.getState().selectedAgent).toBe("allowed");
  await expect(selectAgent("disabled")).rejects.toThrow("unavailable");
  await expect(selectAgent("missing")).rejects.toThrow("unavailable");
  expect(useAgentStore.getState().selectedAgent).toBe("allowed");
});
it("does not overwrite a newer user choice while the server is answering", async () => {
  let resolve!: (value: AgentListResponse) => void;
  vi.mocked(agentsApi.listAgents).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const pending = selectAgent("allowed");
  useAgentStore.getState().setSelectedAgent("newer-choice");
  resolve(response);
  await expect(pending).rejects.toThrow("changed");
  expect(useAgentStore.getState().selectedAgent).toBe("newer-choice");
});
