import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { identityFromPayload, verifyIapAssertion } from "./iap.js";

const issuer = "https://cloud.google.com/iap";
const audience = "/projects/123456789/global/backendServices/987654321";

async function signedAssertion(
  claims: Record<string, unknown> = {},
  options: { issuer?: string; audience?: string } = {},
) {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const assertion = await new SignJWT({
    sub: "accounts.google.com:subject-1",
    email: "Person@Example.com",
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { assertion, key: createLocalJWKSet({ keys: [jwk] }) };
}

describe("identityFromPayload", () => {
  it("normalizes a verified email and preserves the stable subject", () => {
    expect(identityFromPayload({ sub: "subject-1", email: "Person@Example.com" })).toEqual({
      subject: "subject-1",
      email: "person@example.com",
    });
  });

  it.each([
    [{ email: "person@example.com" }, "subject"],
    [{ sub: "subject-1" }, "email"],
    [{ sub: "", email: "person@example.com" }, "subject"],
    [{ sub: "subject-1", email: "" }, "email"],
  ])("rejects a payload without a usable %s", (payload, field) => {
    expect(() => identityFromPayload(payload)).toThrow(String(field));
  });
});

describe("verifyIapAssertion", () => {
  it("accepts a valid assertion using an offline JWKS", async () => {
    const { assertion, key } = await signedAssertion();
    await expect(verifyIapAssertion(assertion, audience, key)).resolves.toEqual({
      subject: "accounts.google.com:subject-1",
      email: "person@example.com",
    });
  });

  it("rejects the wrong audience", async () => {
    const { assertion, key } = await signedAssertion({}, { audience: "wrong-audience" });
    await expect(verifyIapAssertion(assertion, audience, key)).rejects.toThrow();
  });

  it("rejects the wrong issuer", async () => {
    const { assertion, key } = await signedAssertion({}, { issuer: "https://example.test" });
    await expect(verifyIapAssertion(assertion, audience, key)).rejects.toThrow();
  });

  it("rejects an assertion signed by an untrusted key", async () => {
    const trusted = await signedAssertion();
    const untrusted = await signedAssertion();
    await expect(verifyIapAssertion(untrusted.assertion, audience, trusted.key)).rejects.toThrow();
  });
});
