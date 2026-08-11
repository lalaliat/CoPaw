import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../request", () => ({ request: vi.fn() }));
vi.mock("../config", () => ({
  getApiUrl: (path: string) => `/api${path}`,
}));

import { request } from "../request";
import { routineApi } from "./routine";

describe("routineApi", () => {
  beforeEach(() => {
    vi.mocked(request).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates and updates routines", async () => {
    const spec = { name: "Review changes" } as never;

    await routineApi.createRoutine(spec);
    await routineApi.updateRoutine("routine/1", spec);

    expect(request).toHaveBeenNthCalledWith(1, "/routines", {
      method: "POST",
      body: JSON.stringify(spec),
    });
    expect(request).toHaveBeenNthCalledWith(2, "/routines/routine%2F1", {
      method: "PUT",
      body: JSON.stringify(spec),
    });
  });

  it("runs a routine manually", async () => {
    await routineApi.runRoutine("routine-1");

    expect(request).toHaveBeenCalledWith("/routines/routine-1/run", {
      method: "POST",
    });
  });

  it("fires a webhook with its own token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "queued", run_id: "run-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await routineApi.fireRoutine(
      "/agents/default/routines/routine-1/fire",
      "secret",
      "payload",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/default/routines/routine-1/fire",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: "payload" }),
      },
    );
    expect(result.run_id).toBe("run-1");
  });
});
