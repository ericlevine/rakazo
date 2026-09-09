import { describe, expect, it } from "vitest";
import { displayToolCallValue, sanitizeToolCallDetail } from "./tool-call-details.js";

describe("sanitizeToolCallDetail", () => {
  it("redacts known secrets and sensitive keys recursively", () => {
    const value = sanitizeToolCallDetail(
      {
        command: "curl -H 'Authorization: Bearer hidden-token' https://example.test",
        nested: {
          api_key: "hidden-key",
          accessToken: "hidden-access-token",
          visible: "hello hidden-value",
        },
      },
      ["hidden-value"],
    );
    expect(value).toEqual({
      command: "curl -H 'Authorization: [redacted] [redacted]' https://example.test",
      nested: { api_key: "[redacted]", accessToken: "[redacted]", visible: "hello [redacted]" },
    });
  });

  it("replaces encoded binary and bounds large values", () => {
    expect(sanitizeToolCallDetail({ image: "a".repeat(2_000) })).toEqual({
      image: "[binary data: 2000 characters]",
    });
    const bounded = displayToolCallValue(sanitizeToolCallDetail({ text: "x ".repeat(30_000) }));
    expect(bounded.length).toBeLessThan(33_000);
    expect(bounded).toContain("truncated");
  });
});
