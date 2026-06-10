import { describe, it, before, mock } from "node:test";
import assert from "node:assert/strict";
import type * as Model from "../src/model.js";

// Solitary unit: model.ts's only runtime collaborator is protocol.ts
// (`hasAgentNoter`). We mock it so this run touches only model.ts, then assert
// the format-neutral HelpDoc — no Markdown rendering is involved.

const protocolUrl = new URL("../src/protocol.js", import.meta.url).href;

let model: typeof Model;

before(async () => {
  mock.module(protocolUrl, {
    namedExports: {
      hasAgentNoter: (t: unknown): boolean =>
        !!t && typeof (t as { agentNotes?: unknown }).agentNotes === "function",
    },
  });
  model = await import("../src/model.js");
});

describe("buildClassDoc", () => {
  it("extracts title, members, usage rules, and empty notes", () => {
    class Widget {
      configure(_a: string, _b: number): void { /* stub */ }
      reset(): void { /* stub */ }
    }
    const d = model.buildClassDoc(Widget, null);
    assert.equal(d.title, "Widget");
    assert.equal(d.signature, null);
    assert.equal(d.usageRules.length, 4);
    assert.deepEqual(d.notes, []);
    assert.deepEqual(d.members, [
      { name: "configure", kind: "method", signature: "(_a, _b)" },
      { name: "reset", kind: "method", signature: "()" },
    ]);
  });

  it("uses provided type signatures for member signatures", () => {
    class Store {
      get(_k: string): void { /* stub */ }
    }
    const typeSigs = new Map([
      ["get", { params: [{ name: "k", type: "string" }], returnType: "unknown" }],
    ]);
    const d = model.buildClassDoc(Store, null, typeSigs);
    assert.deepEqual(d.members?.[0], { name: "get", kind: "method", signature: "(k: string): unknown" });
  });

  it("filters runtime members not exposed by declarations", () => {
    class Client {
      visible(_input: string): void { /* stub */ }
      hidden(): void { /* stub */ }
    }
    const typeSigs = new Map([
      ["visible", { params: [{ name: "input", type: "string" }], returnType: "void" }],
    ]) as Model.TypeSignatureMap;
    typeSigs.declaredMembers = new Set(["visible"]);

    const d = model.buildClassDoc(Client, null, typeSigs);
    assert.deepEqual(d.members, [
      { name: "visible", kind: "method", signature: "(input: string): void" },
    ]);
  });

  it("names anonymous classes AnonymousClass and yields empty members", () => {
    const Cls = class { // NOSONAR: intentionally empty test fixture
    };
    Object.defineProperty(Cls, "name", { value: "", configurable: true });
    const d = model.buildClassDoc(Cls, null);
    assert.equal(d.title, "AnonymousClass");
    assert.deepEqual(d.members, []);
  });

  it("accumulates notes across the prototype chain with a precedence marker", () => {
    class Parent {
      agentNotes(): string { return "Parent note."; }
    }
    class Child extends Parent {
      override agentNotes(): string { return "Child note."; }
    }
    const d = model.buildClassDoc(Child, null);
    assert.deepEqual(d.notes, [
      { className: "Parent", inherited: [], body: "Parent note." },
      { className: "Child", inherited: ["Parent"], body: "Child note." },
    ]);
  });
});

describe("buildObjectDoc", () => {
  it("uses Object as title and lists properties for a plain object", () => {
    const d = model.buildObjectDoc({ a: 1, b: "x" });
    assert.equal(d.title, "Object");
    assert.deepEqual(d.members, [
      { name: "a", kind: "property", signature: null },
      { name: "b", kind: "property", signature: null },
    ]);
  });

  it("uses the constructor name and merges prototype + own members for an instance", () => {
    class Config {
      load(): void { /* stub */ }
      name = "default";
    }
    const d = model.buildObjectDoc(new Config());
    assert.equal(d.title, "Config");
    assert.deepEqual(d.members, [
      { name: "load", kind: "method", signature: "()" },
      { name: "name", kind: "property", signature: null },
    ]);
  });
});

describe("buildFunctionDoc", () => {
  it("extracts a signature, null members, and function usage rules", () => {
    function connect(_host: string, _port: number): void { /* stub */ } // NOSONAR: fixture
    const d = model.buildFunctionDoc(connect);
    assert.equal(d.title, "connect");
    assert.equal(d.signature, "connect(_host, _port)");
    assert.equal(d.members, null);
    assert.equal(d.usageRules.length, 4);
    assert.deepEqual(d.notes, []);
  });

  it("appends a note when the function is an AgentNoter (via the mocked guard)", () => {
    function go(): void { /* stub */ } // NOSONAR: fixture
    (go as unknown as Record<string, unknown>).agentNotes = () => "Use carefully.";
    const d = model.buildFunctionDoc(go);
    assert.deepEqual(d.notes, [{ className: "go", inherited: [], body: "Use carefully." }]);
  });

  it("falls back to arg names when Function.prototype.toString throws", () => {
    function fake(_a: unknown, _b: unknown) { /* noop */ } // NOSONAR: fixture
    const original = Function.prototype.toString;
    Function.prototype.toString = function () { throw new Error("nope"); };
    try {
      const d = model.buildFunctionDoc(fake);
      assert.equal(d.signature, "fake(arg0, arg1)");
    } finally {
      Function.prototype.toString = original;
    }
  });
});
