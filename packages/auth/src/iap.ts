import { bootstrapCollaborativeUserSpace, type PrismaClient } from "@rakazo/db";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";

const IAP_ISSUER = "https://cloud.google.com/iap";
const IAP_JWKS = createRemoteJWKSet(new URL("https://www.gstatic.com/iap/verify/public_key-jwk"));
const IAP_PROVIDER = "google-iap";

export interface IapIdentity {
  subject: string;
  email: string;
}

export type VerifyIapAssertion = (assertion: string, audience: string) => Promise<IapIdentity>;

export async function verifyIapAssertion(
  assertion: string,
  audience: string,
  key: JWTVerifyGetKey = IAP_JWKS,
): Promise<IapIdentity> {
  const { payload } = await jwtVerify(assertion, key, {
    audience,
    issuer: IAP_ISSUER,
  });
  return identityFromPayload(payload);
}

export function identityFromPayload(payload: JWTPayload): IapIdentity {
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("IAP assertion has no subject");
  }
  if (typeof payload.email !== "string" || payload.email.length === 0) {
    throw new Error("IAP assertion has no email");
  }
  return { subject: payload.sub, email: payload.email.toLowerCase() };
}

interface IapAuthOptions {
  audience: string;
  prisma: PrismaClient;
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
  verify?: VerifyIapAssertion;
}

export function iapAuth(options: IapAuthOptions): BetterAuthPlugin {
  const verify = options.verify ?? verifyIapAssertion;
  return {
    id: "google-iap",
    endpoints: {
      signInIap: createAuthEndpoint(
        "/sign-in/iap",
        { method: "POST", requireHeaders: true },
        async (ctx) => {
          const assertion =
            ctx.request?.headers.get("x-goog-iap-jwt-assertion") ??
            ctx.headers?.get("x-goog-iap-jwt-assertion");
          if (!assertion) {
            throw new APIError("UNAUTHORIZED", {
              message: "IAP identity required",
            });
          }

          let identity: IapIdentity;
          try {
            identity = await verify(assertion, options.audience);
          } catch {
            throw new APIError("UNAUTHORIZED", {
              message: "Invalid IAP identity",
            });
          }

          const subjectOwner = await ctx.context.internalAdapter.findAccountOwnerByKey({
            providerId: IAP_PROVIDER,
            accountId: identity.subject,
          });
          let user = subjectOwner?.kind === "owned" ? subjectOwner.user : null;
          if (subjectOwner?.kind === "orphaned") {
            throw new APIError("FORBIDDEN", {
              message: "IAP identity is unavailable",
            });
          }
          if (user && user.email.toLowerCase() !== identity.email) {
            throw new APIError("FORBIDDEN", {
              message: "IAP identity email changed",
            });
          }

          if (!user) {
            const emailOwner = await ctx.context.internalAdapter.findUserByEmail(identity.email, {
              includeAccounts: true,
            });
            user = emailOwner?.user ?? null;
            const existingIapAccount = emailOwner?.accounts.find(
              (account) => account.providerId === IAP_PROVIDER,
            );
            if (existingIapAccount && existingIapAccount.accountId !== identity.subject) {
              throw new APIError("FORBIDDEN", {
                message: "Rakazo account belongs to another IAP identity",
              });
            }
            if (!user) {
              user = await ctx.context.internalAdapter.createUser(
                {
                  email: identity.email,
                  emailVerified: true,
                  name: identity.email.split("@")[0] || "User",
                },
                { method: "iap" },
              );
            } else if (!user.emailVerified) {
              user = await ctx.context.internalAdapter.updateUser(user.id, {
                emailVerified: true,
              });
            }
            await ctx.context.internalAdapter.linkAccount({
              userId: user.id,
              providerId: IAP_PROVIDER,
              accountId: identity.subject,
            });
          }

          const { spaceId } = await bootstrapCollaborativeUserSpace(options.prisma, user, {
            signupsEnabled: options.signupsEnabled,
            signupAllowlist: options.signupAllowlist,
          });
          const session = await ctx.context.internalAdapter.createSession(user.id, false);
          await setSessionCookie(ctx, { session, user }, false);
          return ctx.json({ ok: true, spaceId });
        },
      ),
    },
  };
}
