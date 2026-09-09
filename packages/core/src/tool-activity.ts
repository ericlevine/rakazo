import type { MessageBlock } from "@rakazo/contracts";

export function isToolActivityBlock(block: MessageBlock): boolean {
  return (
    (block.kind === "steps" && !block.calls?.length) ||
    (block.kind === "progress" && block.activity === true)
  );
}
