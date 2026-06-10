/**
 * Structured, format-neutral model of agent-oriented documentation.
 *
 * This module owns **extraction**: turning a class, instance, plain object, or
 * function into a {@link HelpDoc} — a renderer-agnostic intermediate
 * representation. A renderer (see `render.ts` for the Markdown one) turns a
 * `HelpDoc` into a concrete string. Keeping the two apart means new output
 * formats (plain text, HTML, JSON for MCP servers) only need a new renderer;
 * the introspection logic here is shared by all of them.
 */

import { hasAgentNoter } from "./protocol.js";

// ── TypeScript source type signatures (consumed during extraction) ──────────────

/** Parameter type info extracted from TypeScript source. */
export interface ParamTypeInfo {
  name: string;
  type: string;
}

/** Method/function type signature extracted from TypeScript source. */
export interface MethodTypeSignature {
  params: ParamTypeInfo[];
  returnType: string | null;
}

/** Map from member name to its TypeScript type signature. */
export type TypeSignatureMap = Map<string, MethodTypeSignature>;

// ── format-neutral intermediate representation ──────────────────────────────────

/** One public member of a class, instance, or plain object. */
export interface HelpMember {
  name: string;
  kind: "method" | "accessor" | "property";
  /** Call signature starting at `(` (e.g. `"(key: string): unknown"`); `null` for non-callable members. */
  signature: string | null;
}

/** One class's `agentNotes()` contribution. */
export interface HelpNote {
  className: string;
  /** Ancestor class names this note overrides (leaf only); empty otherwise. */
  inherited: string[];
  body: string;
}

/**
 * Format-neutral model of an object's agent-oriented documentation.
 *
 * A single shape covers classes, objects, and functions: each populates the
 * fields that apply to it and leaves the rest at their empty defaults. A
 * `null` `members` means "no Public API section" (functions); an empty array
 * means the section renders with `(none)`. A non-null `signature` is a
 * function's call signature.
 */
export interface HelpDoc {
  title: string;
  signature: string | null;
  members: HelpMember[] | null;
  usageRules: string[];
  notes: HelpNote[];
}

const CLASS_RULES = [
  "- Prefer the public API listed above.",
  "- Do not use private, protected, underscored, or internal members.",
  "- Do not invent unsupported behavior.",
  "- If usage is ambiguous, prefer the simplest documented usage pattern.",
];

const FUNCTION_RULES = [
  "- Call this function according to the signature above.",
  "- Do not invent unsupported parameters, return values, side effects, or lifecycle behavior.",
  "- Do not use private, underscored, or internal implementation details.",
  "- If usage is ambiguous, prefer the simplest documented usage pattern.",
];

// ── shared low-level helpers ────────────────────────────────────────────────────

function getName(val: unknown): string {
  const raw = (val as { name?: unknown }).name;
  return typeof raw === "string" ? raw : "";
}

function getProto(val: unknown): unknown {
  return (val as { prototype?: unknown }).prototype;
}

function getCtor(val: unknown): unknown {
  return (val as { constructor?: unknown }).constructor;
}

export const FAILED = Symbol("FAILED");

export function safeCall<T>(fn: () => T): T | typeof FAILED {
  try {
    return fn();
  } catch {
    return FAILED;
  }
}

export function protoOf(ctor: Function): object | null {
  const p = getProto(ctor);
  return typeof p === "object" && p !== null ? p : null;
}

const EXCLUDED = new Set(["constructor", "agentHelp", "agentNotes"]);

function isExcluded(name: string): boolean {
  return EXCLUDED.has(name) || name.startsWith("_");
}

function isPublicProtoMember(n: string): boolean {
  return !isExcluded(n);
}

export function isClassConstructor(fn: Function): boolean {
  const src = Function.prototype.toString.call(fn);
  if (src.startsWith("class ") || src.startsWith("class{")) return true;
  const proto = getProto(fn);
  if (proto == null || typeof proto !== "object") return false;
  return Object.getOwnPropertyNames(proto).some(isPublicProtoMember);
}

function buildPrototypeChain(ctor: Function): object[] {
  const chain: object[] = [];
  let p = getProto(ctor);
  while (p != null) {
    if (typeof p === "object") {
      chain.unshift(p);
    }
    p = Object.getPrototypeOf(p);
  }
  return chain;
}

// ── parameter name recovery ───────────────────────────────────────────────────

function fallbackArgs(arity: number): string[] {
  const args: string[] = [];
  for (let i = 0; i < arity; i++) args.push(`arg${i}`);
  return args;
}

const QUOTES = new Set(["'", '"', "`"]);

function skipTemplateExpr(src: string, start: number): number {
  let i = start;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "`") { i = skipStringLike(src, i); continue; }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return i;
}

function skipStringLike(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === quote) return i + 1;
    if (quote === "`" && ch === "$" && src[i + 1] === "{") {
      i = skipTemplateExpr(src, i + 2);
      continue;
    }
    i++;
  } /* node:coverage disable */
  // Unterminated string is impossible for valid fn source from Function.prototype.toString.
  return src.length;
  /* node:coverage enable */
}

const BRACKET_DEPTH: Record<string, number> = { "(": 1, ")": -1, "{": 1, "}": -1, "[": 1, "]": -1 };

function splitCommas(str: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (QUOTES.has(ch)) {
      const end = skipStringLike(str, i);
      current += str.slice(i, end);
      i = end;
      continue;
    }
    depth += BRACKET_DEPTH[ch] ?? 0;
    if (ch === "," && depth === 0) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
    i++;
  }
  if (current) result.push(current);
  return result;
}

function extractParamName(seg: string): string | null {
  seg = seg.trim();
  if (seg.startsWith("{") || seg.startsWith("[")) return null;
  if (seg.startsWith("...")) seg = seg.slice(3).trim();
  const match = /^([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(seg);
  return match ? match[1] : null;
}

const PAREN_DEPTH: Record<string, number> = { "(": 1, ")": -1 };

function findMatchingCloseParen(src: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipStringLike(src, i);
      continue;
    }
    depth += PAREN_DEPTH[ch] ?? 0;
    if (depth === 0) return i;
    i++;
  } /* node:coverage disable */
  // Unbalanced parens are impossible for valid fn source from Function.prototype.toString.
  return -1;
  /* node:coverage enable */
}

function extractParamString(src: string): string | null {
  const openIdx = src.indexOf("(");
  if (openIdx === -1) return null;
  const closeIdx = findMatchingCloseParen(src, openIdx);
  if (closeIdx === -1) return null;
  return src.slice(openIdx + 1, closeIdx).trim();
}

function buildParamNames(paramStr: string, arity: number): string[] {
  const segments = splitCommas(paramStr);
  const names: string[] = [];
  for (let i = 0; i < segments.length && names.length < arity; i++) {
    const name = extractParamName(segments[i]);
    names.push(name ?? `arg${names.length}`);
  }
  while (names.length < arity) names.push(`arg${names.length}`);
  return names.slice(0, arity);
}

function parseParamNames(fn: Function): string[] {
  const arity = fn.length;
  if (arity === 0) return [];

  try {
    const src = Function.prototype.toString.call(fn);
    if (src.includes("[native code]")) return fallbackArgs(arity);

    const paramStr = extractParamString(src);
    if (paramStr === null) return fallbackArgs(arity);
    if (!paramStr) return [];

    return buildParamNames(paramStr, arity);
  } catch {
    return fallbackArgs(arity);
  }
}

// ── method meta (arity + param names) ──────────────────────────────────────────

function methodMeta(ctor: Function, name: string): { arity: number; paramNames: string[] } {
  let p = getProto(ctor);
  while (p != null && p !== Object.prototype) {
    if (typeof p === "object") {
      const desc = Object.getOwnPropertyDescriptor(p, name);
      if (desc && typeof desc.value === "function") {
        const fn = desc.value as Function;
        return { arity: fn.length, paramNames: parseParamNames(fn) };
      }
    }
    p = Object.getPrototypeOf(p);
  } /* node:coverage disable */
  // Name is always found on the prototype chain it was collected from.
  return { arity: 0, paramNames: [] };
  /* node:coverage enable */
}

// ── internal member collection ──────────────────────────────────────────────────

interface Member {
  name: string;
  kind: "method" | "accessor" | "property";
  arity: number;
  paramNames: string[];
  typeSig?: MethodTypeSignature;
}

const KIND_ORDER: Record<string, number> = {
  method: 0,
  accessor: 1,
  property: 2,
};

function sortMembers(members: Member[]): Member[] {
  return members.sort((a, b) => {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return k === 0 ? a.name.localeCompare(b.name) : k;
  });
}

function argList(arity: number, paramNames?: string[]): string {
  if (paramNames && paramNames.length > 0) {
    return paramNames.join(", ");
  }
  const args: string[] = [];
  for (let i = 0; i < arity; i++) args.push(`arg${i}`);
  return args.join(", ");
}

function formatTypedSig(typeSig: MethodTypeSignature): string {
  const params = typeSig.params.length > 0
    ? typeSig.params.map((p) => `${p.name}: ${p.type}`).join(", ")
    : "";
  const ret = typeSig.returnType ? `: ${typeSig.returnType}` : "";
  return `(${params})${ret}`;
}

/** Build the call-signature suffix (`(params)` or `(params): ret`) for a method. */
function methodSignature(m: Member): string {
  return m.typeSig ? formatTypedSig(m.typeSig) : `(${argList(m.arity, m.paramNames)})`;
}

function toHelpMember(m: Member): HelpMember {
  return {
    name: m.name,
    kind: m.kind,
    signature: m.kind === "method" ? methodSignature(m) : null,
  };
}

function collectMemberFromDesc(
  name: string,
  desc: PropertyDescriptor,
  objProtoNames: Set<string>,
  ctor: Function,
  seen: Set<string>,
  members: Member[],
  typeSigs?: TypeSignatureMap,
): void {
  if (seen.has(name) || isExcluded(name)) return;
  if (objProtoNames.has(name) && typeof desc.value !== "function") return;
  if (typeof desc.value === "function") {
    seen.add(name);
    const meta = methodMeta(ctor, name);
    members.push({ name, kind: "method", arity: meta.arity, paramNames: meta.paramNames, typeSig: typeSigs?.get(name) });
  } else if (desc.get || desc.set) {
    seen.add(name);
    members.push({ name, kind: "accessor", arity: 0, paramNames: [] });
  }
}

function collectPrototypeMembers(ctor: Function, typeSigs?: TypeSignatureMap): Member[] {
  const seen = new Set<string>();
  const members: Member[] = [];
  const chain = buildPrototypeChain(ctor);

  const objProtoNames = new Set(
    Object.getOwnPropertyNames(Object.prototype),
  );

  for (let i = chain.length - 1; i >= 0; i--) {
    const proto = chain[i];
    if (proto === Object.prototype) continue;
    const descs = Object.getOwnPropertyDescriptors(proto);
    for (const [name, desc] of Object.entries(descs)) {
      collectMemberFromDesc(name, desc, objProtoNames, ctor, seen, members, typeSigs);
    }
  }

  return sortMembers(members);
}

function ownMemberKind(desc: PropertyDescriptor): "accessor" | "property" | null {
  if (typeof desc.value === "function") return null;
  if (desc.enumerable === false) return null;
  return (desc.get || desc.set) ? "accessor" : "property";
}

function collectOwnMembers(
  target: object,
  seen: Set<string>,
  members: Member[],
): void {
  const descs = Object.getOwnPropertyDescriptors(target);
  for (const [name, desc] of Object.entries(descs)) {
    if (seen.has(name) || isExcluded(name)) continue;
    const kind = ownMemberKind(desc);
    if (kind) {
      members.push({ name, kind, arity: 0, paramNames: [] });
      seen.add(name);
    }
  }
}

function collectInstanceMembers(target: object, ctor: Function | null, typeSigs?: TypeSignatureMap): Member[] {
  const seen = new Set<string>();
  const members: Member[] = [];

  if (ctor != null) {
    for (const m of collectPrototypeMembers(ctor, typeSigs)) {
      members.push(m);
      seen.add(m.name);
    }
  }

  collectOwnMembers(target, seen, members);
  return sortMembers(members);
}

// ── notes collection ──────────────────────────────────────────────────────────

function collectNoteFromProto(
  proto: object,
  isLeaf: boolean,
  parentNames: string[],
  instance: unknown,
): HelpNote | null {
  const desc = Object.getOwnPropertyDescriptor(proto, "agentNotes");
  if (!desc || typeof desc.value !== "function") return null;

  const ctorOfProto = getCtor(proto);
  const sectionName =
    ctorOfProto ? String(getName(ctorOfProto) || "Object") : "Object";

  const receiver =
    instance != null && proto.isPrototypeOf(instance as object) // NOSONAR: dynamic type guard
      ? instance
      : Object.create(proto);

  const result = safeCall(() => (desc.value as Function).call(receiver));
  if (result === FAILED) return null;

  const body = String(result).trim();
  if (!body) return null;

  return {
    className: sectionName,
    body,
    inherited: isLeaf && parentNames.length > 0 ? [...parentNames] : [],
  };
}

function collectNotes(ctor: Function, instance: unknown): HelpNote[] {
  const notes: HelpNote[] = [];
  const parentNames: string[] = [];
  const chain = buildPrototypeChain(ctor);

  for (const proto of chain) {
    if (proto === Object.prototype) continue;
    const isLeaf = proto === chain.at(-1);
    const note = collectNoteFromProto(proto, !!isLeaf, parentNames, instance);
    if (!note) continue;
    notes.push(note);
    if (!isLeaf) {
      parentNames.push(note.className);
    }
  }

  return notes;
}

// ── function signature + name ───────────────────────────────────────────────────

function resolveFunctionName(fn: Function): string {
  let name = getName(fn) || "function";
  if (name.startsWith("bound ")) name = name.slice(6);
  return name || "function";
}

function functionSignature(fn: Function, name: string, typeSigs?: TypeSignatureMap): string {
  const typeSig = typeSigs?.get(name);
  const suffix = typeSig ? formatTypedSig(typeSig) : `(${argList(fn.length, parseParamNames(fn))})`;
  return `${name}${suffix}`;
}

function functionNotes(fn: Function, name: string): HelpNote[] {
  if (!hasAgentNoter(fn)) return [];
  const result = safeCall(() => fn.agentNotes());
  if (result === FAILED) return [];
  const body = String(result).trim();
  return body ? [{ className: name, inherited: [], body }] : [];
}

// ── doc builders (extraction → HelpDoc) ─────────────────────────────────────────

export function buildClassDoc(ctor: Function, instance: unknown, typeSigs?: TypeSignatureMap): HelpDoc {
  return {
    title: getName(ctor) || "AnonymousClass",
    signature: null,
    members: collectPrototypeMembers(ctor, typeSigs).map(toHelpMember),
    usageRules: CLASS_RULES,
    notes: collectNotes(ctor, instance),
  };
}

export function buildObjectDoc(target: object, typeSigs?: TypeSignatureMap): HelpDoc {
  const ctorRaw = getCtor(target);
  const ctor = typeof ctorRaw === "function" ? ctorRaw : null;
  const title =
    ctor && ctor !== Object && getName(ctor) ? getName(ctor) : "Object";
  return {
    title,
    signature: null,
    members: collectInstanceMembers(target, ctor, typeSigs).map(toHelpMember),
    usageRules: CLASS_RULES,
    notes: ctor ? collectNotes(ctor, target) : [],
  };
}

export function buildFunctionDoc(fn: Function, typeSigs?: TypeSignatureMap): HelpDoc {
  const name = resolveFunctionName(fn);
  return {
    title: name,
    signature: functionSignature(fn, name, typeSigs),
    members: null,
    usageRules: FUNCTION_RULES,
    notes: functionNotes(fn, name),
  };
}
