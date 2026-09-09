import { useLingui } from "@lingui/react/macro";
import type { MessageBlock } from "@rakazo/contracts";
import { displayToolCallValue, humanizeToolName } from "@rakazo/core";
import { ChevronDown } from "lucide-react";

export function ToolCallsBlock({ block }: { block: Extract<MessageBlock, { kind: "steps" }> }) {
  const { t } = useLingui();
  const calls = block.calls ?? [];
  if (calls.length === 0) return null;
  return (
    <details
      data-testid="tool-calls"
      className="group/tool rounded-xl border border-border bg-background/70 text-[13px]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted-foreground">
        <ChevronDown
          aria-hidden="true"
          size={14}
          className="transition-transform group-open/tool:rotate-180"
        />
        <span>{calls.length === 1 ? t`1 tool call` : t`${calls.length} tool calls`}</span>
      </summary>
      <div className="border-t border-border px-2 py-1.5">
        {calls.map((call, index) => {
          const status =
            call.status === "running"
              ? t`Running`
              : call.status === "failed"
                ? t`Failed`
                : call.status === "paused"
                  ? t`Paused`
                  : t`Completed`;
          return (
            <details key={call.executionId || index} className="group/call">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted">
                <span className="min-w-0 truncate font-medium text-foreground/80">
                  {humanizeToolName(call.name)}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{status}</span>
              </summary>
              <div className="space-y-2 px-2 pb-3">
                {call.input !== undefined ? (
                  <ToolCallValue label={t`Input`} value={call.input} />
                ) : null}
                {call.output !== undefined ? (
                  <ToolCallValue label={t`Output`} value={call.output} />
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
    </details>
  );
}

function ToolCallValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted px-3 py-2 font-mono text-[11px] leading-4 text-foreground/80">
        {displayToolCallValue(value)}
      </pre>
    </div>
  );
}
