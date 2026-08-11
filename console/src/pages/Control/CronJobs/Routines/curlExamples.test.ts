import { describe, expect, it } from "vitest";
import { buildRoutineCurlExamples } from "./curlExamples";

describe("Routine curl examples", () => {
  it("builds a body-free trigger and a text-only example", () => {
    const examples = buildRoutineCurlExamples(
      "http://127.0.0.1:8099/api/routines/routine-1/fire",
      "qp_rt_token",
    );

    expect(examples.minimal).not.toContain("Content-Type");
    expect(examples.minimal).not.toContain("-d ");
    expect(examples.withText).toContain('{"text":"本次任务信息"}');
    expect(examples.withText).not.toContain("event_id");
  });
});
