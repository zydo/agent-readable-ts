/**
 * agent-readable-ts
 *
 * Attach agent-oriented documentation to any class, object, or function.
 * Coding agents call `agentHelp(target)` to see the real callable surface
 * and author-supplied behavioral rules before writing code against the target.
 *
 * This module is the orchestrator: it handles the `AgentHelper` full-replacement
 * path and the advisory warning sink, then delegates to `model.ts` (extraction
 * into a format-neutral `HelpDoc`) and `render.ts` (Markdown rendering).
 */

import { hasAgentHelper, hasAgentNoter } from "./protocol.js";
import {
  FAILED,
  safeCall,
  isClassConstructor,
  protoOf,
  buildClassDoc,
  buildObjectDoc,
  buildFunctionDoc,
} from "./model.js";
import { renderMarkdown } from "./render.js";
import type { TypeSignatureMap } from "./model.js";

export type { AgentHelper, AgentNoter } from "./protocol.js";
export type { ParamTypeInfo, MethodTypeSignature, TypeSignatureMap } from "./model.js";
export type { HelpDoc, HelpMember, HelpNote } from "./model.js";

// ── advisory warning sink ───────────────────────────────────────────────────────

/** A sink for advisory warnings. */
export type WarningSink =
  | { write(chunk: string): unknown }
  | ((chunk: string) => unknown);

let warnSink: WarningSink | null =
  typeof process !== "undefined" && process.stderr ? process.stderr : null;

/** Replace the advisory warning sink. Pass `null` to silence warnings. */
export function setWarnOutput(sink: WarningSink | null): void {
  warnSink = sink;
}

/** Return the current advisory warning sink. */
export function getWarnOutput(): WarningSink | null {
  return warnSink;
}

function warn(message: string): void {
  if (warnSink === null) return;
  try {
    if (typeof warnSink === "function") {
      warnSink(message + "\n");
    } else {
      warnSink.write(message + "\n");
    }
  } catch {
    // swallow
  }
}

// ── AgentHelper full-replacement path ───────────────────────────────────────────

function tryAgentHelperOutput(receiver: unknown): string | null {
  if (!hasAgentHelper(receiver)) return null;
  const hadNotes = hasAgentNoter(receiver);
  const result = safeCall(() => receiver.agentHelp());
  if (result !== FAILED) {
    if (hadNotes) {
      warn("agentNotes() is ignored because agentHelp() owns the full output.");
    }
    const str = String(result);
    return str.endsWith("\n") ? str : str + "\n";
  }
  return null;
}

// ── public API ──────────────────────────────────────────────────────────────────

const NULL_MSG = "No documentation available: null or undefined value.\n";

/**
 * Return agent-oriented help for a class constructor, class instance,
 * plain object, function, arrow function, bound method, or callable object.
 *
 * If the target implements `AgentHelper.agentHelp()`, the returned string is
 * used verbatim. Otherwise auto-generated documentation is produced from
 * safe runtime introspection, with any `AgentNoter.agentNotes()` appended.
 */
export function agentHelp(target: unknown, typeSigs?: TypeSignatureMap): string {
  if (target === null || target === undefined) {
    return NULL_MSG;
  }

  // AgentHelper: full replacement (direct target or class prototype)
  const directOutput = tryAgentHelperOutput(target);
  if (directOutput !== null) return directOutput;

  if (typeof target === "function") {
    if (isClassConstructor(target)) {
      const proto = protoOf(target);
      if (proto) {
        const instance = Object.create(proto);
        const protoOutput = tryAgentHelperOutput(instance);
        if (protoOutput !== null) return protoOutput;
      }
      return renderMarkdown(buildClassDoc(target, null, typeSigs));
    }
    return renderMarkdown(buildFunctionDoc(target, typeSigs));
  }

  return renderMarkdown(buildObjectDoc(target as object, typeSigs)); // NOSONAR: narrowed by earlier typeof/function checks
}
