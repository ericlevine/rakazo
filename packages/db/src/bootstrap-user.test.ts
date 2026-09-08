import { describe, expect, it, vi } from "vitest";
import { bootstrapCollaborativeUserSpace, bootstrapUserSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";

function makePrisma(settings: { id: string; ownerUserId: string | null } | null) {
  const create = () => vi.fn(async (_input: { data: Record<string, unknown> }) => ({}));
  const prisma = {
    organization: {
      create: create(),
      findUniqueOrThrow: vi.fn(async () => {
        throw new Error("not found");
      }),
    },
    member: { create: create() },
    space: { create: create() },
    spaceMember: { create: create() },
    deploymentSettings: {
      findUnique: vi.fn(async () => settings),
      create: create(),
      update: create(),
      upsert: vi.fn(
        async (_input: { create: Record<string, unknown>; update: Record<string, unknown> }) =>
          settings ?? { id: "default" },
      ),
      updateMany: vi.fn(async () => ({
        count: settings && !settings.ownerUserId ? 1 : 0,
      })),
    },
    memoryDocument: { findFirst: vi.fn(async () => null), create: create() },
    notificationPreference: { create: create() },
  };
  return prisma;
}

const env = {
  signupsEnabled: "false",
  signupAllowlist: "a@example.com, b@example.com",
};

describe("bootstrapUserSpace", () => {
  it("creates a personal organization with a default workspace", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: "user-1" });
    const result = await bootstrapUserSpace(
      prisma as unknown as PrismaClient,
      { id: "user-1" },
      env,
    );

    expect(prisma.organization.create).toHaveBeenCalledTimes(1);
    const orgData = prisma.organization.create.mock.calls[0]![0].data;
    expect(orgData.name).toBe("Personal");
    expect(orgData.slug).toBe("user-user-1".slice(0, 16));
    expect(result.spaceId).toBe(orgData.id);

    const memberData = prisma.member.create.mock.calls[0]![0].data;
    expect(memberData.organizationId).toBe(orgData.id);
    expect(memberData.userId).toBe("user-1");
    expect(memberData.role).toBe("owner");

    const spaceData = prisma.space.create.mock.calls[0]![0].data;
    expect(spaceData).toEqual(
      expect.objectContaining({
        id: orgData.id,
        organizationId: orgData.id,
        name: "Personal",
      }),
    );
    const spaceMemberData = prisma.spaceMember.create.mock.calls[0]![0].data;
    expect(spaceMemberData).toEqual(
      expect.objectContaining({
        spaceId: orgData.id,
        organizationId: orgData.id,
        userId: "user-1",
      }),
    );
  });

  it("seeds deployment settings from the env policy when none exist", async () => {
    const prisma = makePrisma(null);
    await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" }, env);

    const { create, update } = prisma.deploymentSettings.upsert.mock.calls[0]![0];
    expect(create.id).toBe("default");
    expect(create.ownerUserId).toBe("user-1");
    expect(create.signupsEnabled).toBe(false);
    expect(create.signupAllowlist).toBe("a@example.com,b@example.com");
    expect(create.signupPolicyInitialized).toBe(true);
    expect(update).toEqual({});
  });

  it("claims the deployment owner when settings exist without one", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: null });
    await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" }, env);

    // Conditional claim: the database predicate decides, so a concurrent
    // claimant that already holds the seat is never overwritten.
    expect(prisma.deploymentSettings.updateMany).toHaveBeenCalledWith({
      where: { id: "default", ownerUserId: null },
      data: { ownerUserId: "user-1" },
    });
  });

  it("leaves existing owned settings untouched", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: "user-0" });
    await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" }, env);

    const { update } = prisma.deploymentSettings.upsert.mock.calls[0]![0];
    expect(update).toEqual({});
    // The only owner write is the conditional claim, which excludes rows
    // that already have an owner.
    expect(prisma.deploymentSettings.updateMany).toHaveBeenCalledWith({
      where: { id: "default", ownerUserId: null },
      data: { ownerUserId: "user-1" },
    });
  });

  it("never claims deployment ownership when claimDeploymentOwner is false", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: null });
    await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" }, env, {
      claimDeploymentOwner: false,
    });

    expect(prisma.deploymentSettings.updateMany).not.toHaveBeenCalled();
  });

  it("seeds settings without an owner when claimDeploymentOwner is false", async () => {
    const prisma = makePrisma(null);
    await bootstrapUserSpace(prisma as unknown as PrismaClient, { id: "user-1" }, env, {
      claimDeploymentOwner: false,
    });

    const { create } = prisma.deploymentSettings.upsert.mock.calls[0]![0];
    expect(create.ownerUserId).toBeNull();
  });

  it("creates the user memory document and notification preference in the new workspace", async () => {
    const prisma = makePrisma({ id: "default", ownerUserId: "user-1" });
    const { spaceId } = await bootstrapUserSpace(
      prisma as unknown as PrismaClient,
      { id: "user-1" },
      env,
    );

    const memoryData = prisma.memoryDocument.create.mock.calls[0]![0].data;
    expect(memoryData.spaceId).toBe(spaceId);
    expect(memoryData.userId).toBe("user-1");
    expect(memoryData.scope).toBe("user");
    expect(memoryData.path).toBe("MEMORY.md");

    const prefData = prisma.notificationPreference.create.mock.calls[0]![0].data;
    expect(prefData.spaceId).toBe(spaceId);
    expect(prefData.userId).toBe("user-1");
  });
});

describe("bootstrapUserSpace concurrency", () => {
  it("recovers when a concurrent bootstrap wins the org, member, and settings races", async () => {
    const uniqueViolation = async () => {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
    };
    const prisma = {
      organization: {
        create: vi.fn(uniqueViolation),
        findUniqueOrThrow: vi.fn(async () => ({ id: "org-winner" })),
      },
      member: { create: vi.fn(uniqueViolation) },
      space: { create: vi.fn(uniqueViolation) },
      spaceMember: { create: vi.fn(uniqueViolation) },
      deploymentSettings: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(uniqueViolation),
        upsert: vi.fn(async () => ({ id: "default" })),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      memoryDocument: {
        findFirst: vi.fn(async () => ({ id: "mem-1" })),
        create: vi.fn(async () => ({})),
      },
      notificationPreference: { create: vi.fn(uniqueViolation) },
    };
    const result = await bootstrapUserSpace(
      prisma as unknown as PrismaClient,
      { id: "user-1" },
      env,
    );

    expect(result.spaceId).toBe("org-winner");
  });
});

describe("bootstrapCollaborativeUserSpace", () => {
  function makeCollaborativePrisma({
    ownerUserId = "owner-1",
    existingMembership = null,
  }: {
    ownerUserId?: string | null;
    existingMembership?: { spaceId: string; organizationId: string } | null;
  } = {}) {
    const create = () => vi.fn(async (_input: { data: Record<string, unknown> }) => ({}));
    const settings = { id: "default", ownerUserId };
    const ownerSpace = {
      id: "membership-1",
      userId: "owner-1",
      spaceId: "shared-space",
      organizationId: "shared-org",
      createdAt: new Date(0),
    };
    return {
      organization: { create: create(), findUniqueOrThrow: vi.fn() },
      member: { create: create() },
      space: { create: create() },
      spaceMember: {
        create: create(),
        findFirst: vi.fn(async ({ where }: { where: { userId: string } }) =>
          where.userId === "owner-1" ? ownerSpace : existingMembership,
        ),
      },
      deploymentSettings: {
        findUnique: vi.fn(async () => settings),
        upsert: vi.fn(async () => settings),
        updateMany: vi.fn(async ({ data }: { data: { ownerUserId: string } }) => {
          if (settings.ownerUserId === null) settings.ownerUserId = data.ownerUserId;
          return { count: 1 };
        }),
      },
      memoryDocument: { findFirst: vi.fn(async () => null), create: create() },
      notificationPreference: { create: create() },
    };
  }

  it("returns the deployment owner's existing default space", async () => {
    const prisma = makeCollaborativePrisma();
    await expect(
      bootstrapCollaborativeUserSpace(prisma as unknown as PrismaClient, { id: "owner-1" }, env),
    ).resolves.toEqual({ spaceId: "shared-space" });
    expect(prisma.member.create).not.toHaveBeenCalled();
  });

  it("adds a later identity to the owner's organization and default space", async () => {
    const prisma = makeCollaborativePrisma();
    const result = await bootstrapCollaborativeUserSpace(
      prisma as unknown as PrismaClient,
      { id: "user-2" },
      env,
    );

    expect(result).toEqual({ spaceId: "shared-space" });
    expect(prisma.member.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "shared-org",
        userId: "user-2",
        role: "member",
      }),
    });
    expect(prisma.spaceMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        spaceId: "shared-space",
        organizationId: "shared-org",
        userId: "user-2",
        role: "member",
      }),
    });
    expect(prisma.memoryDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        spaceId: "shared-space",
        userId: "user-2",
      }),
    });
    expect(prisma.notificationPreference.create).toHaveBeenCalledWith({
      data: { spaceId: "shared-space", userId: "user-2" },
    });
  });

  it("adopts an existing first user's space as the deployment space", async () => {
    const prisma = makeCollaborativePrisma({
      ownerUserId: null,
      existingMembership: {
        spaceId: "manual-space",
        organizationId: "manual-org",
      },
    });
    prisma.spaceMember.findFirst.mockImplementation(
      async ({ where }: { where: { userId: string } }) => ({
        id: "membership-existing",
        userId: where.userId,
        spaceId: "manual-space",
        organizationId: "manual-org",
        createdAt: new Date(0),
      }),
    );

    await expect(
      bootstrapCollaborativeUserSpace(
        prisma as unknown as PrismaClient,
        { id: "manual-user" },
        env,
      ),
    ).resolves.toEqual({ spaceId: "manual-space" });
    expect(prisma.deploymentSettings.updateMany).toHaveBeenCalledWith({
      where: { id: "default", ownerUserId: null },
      data: { ownerUserId: "manual-user" },
    });
  });
});
