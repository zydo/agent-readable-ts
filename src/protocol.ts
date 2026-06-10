/**
 * Agent-documentation protocols.
 *
 * A target may opt into either protocol independently:
 * - {@link AgentHelper} is full replacement — its return value IS the output.
 * - {@link AgentNoter} is additive — its return value is appended to auto-docs.
 *
 * The type guards here are the only place that decides whether a runtime value
 * implements a protocol, so both the orchestrator and the extractor agree.
 */

/** Full-replacement protocol. Returned string IS the output verbatim. */
export interface AgentHelper {
  agentHelp(): string;
}

/** Additive protocol. Returned string is appended to auto-generated docs. */
export interface AgentNoter {
  agentNotes(): string;
}

export function hasAgentHelper(target: unknown): target is AgentHelper {
  return (
    target !== null &&
    target !== undefined &&
    typeof (target as Record<string, unknown>).agentHelp === "function"
  );
}

export function hasAgentNoter(target: unknown): target is AgentNoter {
  return (
    target !== null &&
    target !== undefined &&
    typeof (target as Record<string, unknown>).agentNotes === "function"
  );
}
