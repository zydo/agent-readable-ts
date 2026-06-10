import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/render.js";
import type { HelpDoc } from "../src/model.js";

// Solitary unit: render.ts imports only types from model, so this run touches
// only render.ts. Inputs are hand-built HelpDoc values — no extraction runs.

function doc(overrides: Partial<HelpDoc>): HelpDoc {
  return {
    title: "T",
    signature: null,
    members: null,
    usageRules: ["- rule one", "- rule two"],
    notes: [],
    ...overrides,
  };
}

describe("renderMarkdown", () => {
  it("always emits a title and usage rules, joined by blank lines, with a trailing newline", () => {
    const out = renderMarkdown(doc({ title: "Widget" }));
    assert.equal(out, "# Widget\n\n## Agent usage rules\n\n- rule one\n- rule two\n");
  });

  it("renders a signature code block when signature is set (function shape)", () => {
    const out = renderMarkdown(doc({ title: "connect", signature: "connect(host: string): void" }));
    assert.ok(out.includes("## Signature\n\n```ts\nconnect(host: string): void\n```"));
    assert.ok(!out.includes("## Public API"));
  });

  it("omits the Public API section when members is null", () => {
    const out = renderMarkdown(doc({ members: null }));
    assert.ok(!out.includes("## Public API"));
  });

  it("renders (none) when members is an empty array", () => {
    const out = renderMarkdown(doc({ members: [] }));
    assert.ok(out.includes("## Public API\n\n- (none)"));
  });

  it("renders members with name+signature and kind", () => {
    const out = renderMarkdown(doc({
      members: [
        { name: "get", kind: "method", signature: "(key: string): unknown" },
        { name: "value", kind: "accessor", signature: null },
        { name: "count", kind: "property", signature: null },
      ],
    }));
    assert.ok(out.includes("- `get(key: string): unknown` method"));
    assert.ok(out.includes("- `value` accessor"));
    assert.ok(out.includes("- `count` property"));
  });

  it("renders a plain note header without an inherited clause", () => {
    const out = renderMarkdown(doc({ notes: [{ className: "Foo", inherited: [], body: "Body." }] }));
    assert.ok(out.includes("## Notes from Foo\n\nBody."));
    assert.ok(!out.includes("extends"));
  });

  it("adds the precedence clause when a note lists inherited ancestors", () => {
    const out = renderMarkdown(doc({ notes: [{ className: "Leaf", inherited: ["A", "B"], body: "B." }] }));
    assert.ok(out.includes("## Notes from Leaf (extends A, B; if notes conflict, these take precedence)\n\nB."));
  });

  it("never produces three consecutive newlines between sections", () => {
    const out = renderMarkdown(doc({
      signature: "f()",
      notes: [{ className: "F", inherited: [], body: "x" }],
    }));
    assert.ok(!out.includes("\n\n\n"));
  });
});
