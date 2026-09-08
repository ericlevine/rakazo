import { describe, expect, it, vi } from "vitest";
import { provisionIapSession } from "./iap-auth.js";

describe("provisionIapSession", () => {
  it("returns the shared space selected by an IAP sign-in", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ ok: true, spaceId: "space-team" }),
    ) as unknown as typeof fetch;

    await expect(provisionIapSession(fetcher)).resolves.toEqual({
      ok: true,
      spaceId: "space-team",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/sign-in/iap",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("falls back to password auth when IAP is unavailable", async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(provisionIapSession(fetcher)).resolves.toBeNull();
  });

  it("rejects a malformed success response", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true })) as unknown as typeof fetch;
    await expect(provisionIapSession(fetcher)).resolves.toBeNull();
  });
});
