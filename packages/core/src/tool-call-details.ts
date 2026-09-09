import type { MessageBlock } from "@rakazo/contracts";
import { redactSecrets } from "./events.js";

export type ToolCallDetail = NonNullable<Extract<MessageBlock, { kind: "steps" }>["calls"]>[number];

const SENSITIVE_KEY =
  /(?:^|[_-])(auth|authorization|cookie|credential|key|password|secret|token)(?:$|[_-])/i;
const MAX_STRING = 8_000;
const MAX_SERIALIZED = 32_000;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 100;

function sanitizeText(value: string, secrets: string[]): string {
  const redacted = redactSecrets(value, secrets)
    .replace(/Bearer\s+[^\s"',;&]+/gi, "Bearer [redacted]")
    .replace(/sk-or-v1-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|secret|authorization)\s*[=:]\s*)[^\s"',;&]+/gi,
      "$1[redacted]",
    );
  if (redacted.length <= MAX_STRING) return redacted;
  return `${redacted.slice(0, MAX_STRING)}… [truncated]`;
}

function looksLikeEncodedBinary(value: string): boolean {
  return value.length > 1_024 && /^[A-Za-z0-9+/=_-]+$/.test(value);
}

function isSensitiveKey(value: string): boolean {
  return SENSITIVE_KEY.test(value.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));
}

function sanitizeValue(value: unknown, secrets: string[], depth: number): unknown {
  if (depth > MAX_DEPTH) return "[maximum depth reached]";
  if (typeof value === "string") {
    if (looksLikeEncodedBinary(value)) return `[binary data: ${value.length} characters]`;
    return sanitizeText(value, secrets);
  }
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `[binary data: ${value.byteLength} bytes]`;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ENTRIES)
      .map((item) => sanitizeValue(item, secrets, depth + 1));
    if (value.length > MAX_ENTRIES) items.push(`[${value.length - MAX_ENTRIES} more items]`);
    return items;
  }
  if (typeof value !== "object") return String(value);
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_ENTRIES);
  const result: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    const safeKey = sanitizeText(key, secrets);
    result[safeKey] = isSensitiveKey(key) ? "[redacted]" : sanitizeValue(item, secrets, depth + 1);
  }
  if (Object.keys(value as Record<string, unknown>).length > MAX_ENTRIES) {
    result["[truncated]"] = "Additional fields omitted";
  }
  return result;
}

/** JSON-safe detail suitable for durable thread events and UI display. */
export function sanitizeToolCallDetail(value: unknown, secrets: string[] = []): unknown {
  let sanitized: unknown;
  try {
    sanitized = sanitizeValue(value, secrets, 0);
  } catch {
    return "[unserializable]";
  }
  try {
    const serialized = JSON.stringify(sanitized);
    if (serialized.length <= MAX_SERIALIZED) return sanitized;
    return {
      preview: `${serialized.slice(0, MAX_SERIALIZED)}…`,
      truncated: true,
    };
  } catch {
    return "[unserializable]";
  }
}

export function displayToolCallValue(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}
