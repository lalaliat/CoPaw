import { describe, expect, it } from "vitest";
import type { CronDispatchTargetItem } from "../../../../api/types";
import {
  mergeSelectOptions,
  sessionIdsForTarget,
  userIdsForChannel,
} from "./dispatchOptions";

const targets: CronDispatchTargetItem[] = [
  { channel: "console", user_id: "console-user", session_id: "console-1" },
  { channel: "console", user_id: "console-user", session_id: "console-2" },
  { channel: "dingtalk", user_id: "ding-user", session_id: "ding-1" },
];

describe("Routine dispatch options", () => {
  it("only shows users belonging to the selected channel", () => {
    expect(userIdsForChannel(targets, "console")).toEqual([
      "console-user",
      "console-user",
    ]);
    expect(userIdsForChannel(targets, "console")).not.toContain("ding-user");
  });

  it("only shows sessions belonging to the selected channel and user", () => {
    expect(sessionIdsForTarget(targets, "console", "console-user")).toEqual([
      "console-1",
      "console-2",
    ]);
  });

  it("adds a searched custom value to the selectable options", () => {
    expect(mergeSelectOptions(["known"], undefined, "new-user")).toEqual([
      { value: "known", label: "known" },
      { value: "new-user", label: "new-user" },
    ]);
  });
});
