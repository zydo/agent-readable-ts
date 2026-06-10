import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasAgentHelper, hasAgentNoter } from "../src/protocol.js";

// Solitary unit: protocol.ts has no collaborators, so this run touches only it.

describe("hasAgentHelper", () => {
  it("is true when agentHelp is a function", () => {
    assert.equal(hasAgentHelper({ agentHelp: () => "x" }), true);
  });
  it("is false when agentHelp is missing or not a function", () => {
    assert.equal(hasAgentHelper({}), false);
    assert.equal(hasAgentHelper({ agentHelp: 42 }), false);
  });
  it("is false for null and undefined", () => {
    assert.equal(hasAgentHelper(null), false);
    assert.equal(hasAgentHelper(undefined), false);
  });
});

describe("hasAgentNoter", () => {
  it("is true when agentNotes is a function", () => {
    assert.equal(hasAgentNoter({ agentNotes: () => "x" }), true);
  });
  it("is false when agentNotes is missing or not a function", () => {
    assert.equal(hasAgentNoter({}), false);
    assert.equal(hasAgentNoter({ agentNotes: "no" }), false);
  });
  it("is false for null and undefined", () => {
    assert.equal(hasAgentNoter(null), false);
    assert.equal(hasAgentNoter(undefined), false);
  });
});
