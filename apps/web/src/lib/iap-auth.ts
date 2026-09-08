export interface IapSessionResult {
  ok: true;
  spaceId: string;
}

/**
 * Exchange the identity assertion injected by IAP for a normal Rakazo session.
 * A non-IAP deployment answers 401/404 and continues to the ordinary sign-in UI.
 */
export async function provisionIapSession(
  fetcher: typeof fetch = fetch,
): Promise<IapSessionResult | null> {
  const response = await fetcher("/api/auth/sign-in/iap", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("ok" in data) ||
    data.ok !== true ||
    !("spaceId" in data) ||
    typeof data.spaceId !== "string" ||
    data.spaceId.length === 0
  ) {
    return null;
  }
  return { ok: true, spaceId: data.spaceId };
}
