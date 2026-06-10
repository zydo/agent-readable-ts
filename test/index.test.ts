import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agentHelp,
  setWarnOutput,
  getWarnOutput,
  type WarningSink,
} from "../src/index.js";

// ── null / undefined ──────────────────────────────────────────────────────────

describe("null and undefined", () => {
  it("returns fixed message for null", () => {
    assert.equal(
      agentHelp(null),
      "No documentation available: null or undefined value.\n",
    );
  });

  it("returns fixed message for undefined", () => {
    assert.equal(
      agentHelp(undefined),
      "No documentation available: null or undefined value.\n",
    );
  });
});

// ── AgentHelper (full replacement) ────────────────────────────────────────────

describe("AgentHelper", () => {
  it("returns agentHelp() verbatim", () => {
    class Doc {
      agentHelp(): string {
        return "Custom doc.";
      }
    }
    assert.equal(agentHelp(new Doc()), "Custom doc.\n");
  });

  it("returns agentHelp() verbatim on class constructor", () => {
    class Doc {
      static agentHelp(): string {
        return "Class doc.";
      }
    }
    assert.equal(agentHelp(Doc), "Class doc.\n");
  });

  it("returns empty string from agentHelp() as-is", () => {
    class Empty {
      agentHelp(): string {
        return "";
      }
    }
    assert.equal(agentHelp(new Empty()), "\n");
  });

  it("warns when agentNotes() is also present", () => {
    const warnings: string[] = [];
    const sink: WarningSink = (chunk: string) => warnings.push(chunk.trim());
    setWarnOutput(sink);
    try {
      class Both {
        agentHelp(): string {
          return "Full.";
        }
        agentNotes(): string {
          return "Ignored.";
        }
      }
      const result = agentHelp(new Both());
      assert.equal(result, "Full.\n");
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0].includes("agentNotes"));
      assert.ok(warnings[0].includes("ignored"));
    } finally {
      setWarnOutput(null);
    }
  });

  it("falls back to auto-doc when agentHelp() throws", () => {
    class Broken {
      doThing(): void { /* stub */ }
      agentHelp(): string {
        throw new Error("boom");
      }
      agentNotes(): string {
        return "Kept note.";
      }
    }
    const result = agentHelp(new Broken());
    assert.ok(result.includes("# Broken"));
    assert.ok(result.includes("doThing"));
    assert.ok(result.includes("Kept note."));
  });
});

// ── AgentNoter (additive) ─────────────────────────────────────────────────────

describe("AgentNoter", () => {
  it("appends notes to auto-generated docs", () => {
    class Noted {
      doWork(): void { /* stub */ }
      agentNotes(): string {
        return "## Do\n\n- Use doWork.";
      }
    }
    const result = agentHelp(new Noted());
    assert.ok(result.includes("# Noted"));
    assert.ok(result.includes("doWork"));
    assert.ok(result.includes("## Notes from Noted"));
    assert.ok(result.includes("Use doWork."));
  });

  it("skips notes section when agentNotes() returns empty", () => {
    class EmptyNotes {
      go(): void { /* stub */ }
      agentNotes(): string {
        return "";
      }
    }
    const result = agentHelp(new EmptyNotes());
    assert.ok(result.includes("# EmptyNotes"));
    assert.ok(!result.includes("## Notes from"));
  });

  it("skips notes section when agentNotes() throws", () => {
    class BadNotes {
      run(): void { /* stub */ }
      agentNotes(): string {
        throw new Error("fail");
      }
    }
    const result = agentHelp(new BadNotes());
    assert.ok(result.includes("# BadNotes"));
    assert.ok(result.includes("run"));
    assert.ok(!result.includes("## Notes from"));
  });
});

// ── Class constructor target ──────────────────────────────────────────────────

describe("class constructor target", () => {
  it("renders public methods with arity", () => {
    class Widget {
      configure(_a: string, _b: number): void { /* stub */ }
      reset(): void { /* stub */ }
    }
    const result = agentHelp(Widget);
    assert.ok(result.startsWith("# Widget\n"));
    assert.ok(result.includes("`configure(_a, _b)` method"));
    assert.ok(result.includes("`reset()` method"));
    assert.ok(result.includes("## Agent usage rules"));
  });

  it("uses AnonymousClass for anonymous class", () => {
    const Cls = class { // NOSONAR: intentionally empty test fixture
    };
    Object.defineProperty(Cls, "name", { value: "", configurable: true });
    const result = agentHelp(Cls);
    assert.ok(result.startsWith("# AnonymousClass\n"));
  });

  it("excludes constructor, agentHelp, agentNotes from public API", () => {
    class Demo {
      doWork(): void { /* stub */ }
    }
    (Demo.prototype as unknown as Record<string, unknown>).agentHelp = () => { throw new Error("boom"); };
    (Demo.prototype as unknown as Record<string, unknown>).agentNotes = () => "Notes";
    const result = agentHelp(Demo);
    assert.ok(result.includes("doWork"));
    assert.ok(!result.includes("`constructor`"));
    assert.ok(!result.includes("`agentHelp"));
    assert.ok(!result.includes("`agentNotes"));
  });
});

// ── Class instance target ─────────────────────────────────────────────────────

describe("class instance target", () => {
  it("renders class name and methods", () => {
    class Engine {
      start(): void { /* stub */ }
      stop(): void { /* stub */ }
    }
    const result = agentHelp(new Engine());
    assert.ok(result.startsWith("# Engine\n"));
    assert.ok(result.includes("`start()` method"));
    assert.ok(result.includes("`stop()` method"));
  });

  it("includes own enumerable properties", () => {
    class Config {
      name = "default";
      version = 1;
    }
    const result = agentHelp(new Config());
    assert.ok(result.includes("`name` property"));
    assert.ok(result.includes("`version` property"));
  });

  it("excludes underscored properties", () => {
    class Secret {
      _hidden = true;
      visible = true;
    }
    const result = agentHelp(new Secret());
    assert.ok(!result.includes("_hidden"));
    assert.ok(result.includes("`visible` property"));
  });

  it("detects accessors without invoking getters", () => {
    let getterCalled = false;
    class Accessor {
      get value(): number {
        getterCalled = true;
        return 42;
      }
    }
    const result = agentHelp(new Accessor());
    assert.ok(result.includes("`value` accessor"));
    assert.equal(getterCalled, false);
  });

  it("skips function-valued own properties on class instances", () => {
    class WithFuncProp {
      method(): void { /* stub */ }
      handler = () => { /* noop */ };
      count = 0;
    }
    const result = agentHelp(new WithFuncProp());
    assert.ok(result.includes("`method()` method"));
    assert.ok(result.includes("`count` property"));
    assert.ok(!result.includes("handler"));
  });

  it("excludes non-enumerable own properties", () => {
    class WithNonEnum {
      visible = 1;
    }
    const inst = new WithNonEnum();
    Object.defineProperty(inst, "hidden", {
      value: 2,
      enumerable: false,
      configurable: true,
    });
    const result = agentHelp(inst);
    assert.ok(result.includes("`visible` property"));
    assert.ok(!result.includes("hidden"));
  });
});

// ── Plain object target ───────────────────────────────────────────────────────

describe("plain object target", () => {
  it("uses Object as heading", () => {
    const result = agentHelp({ a: 1, b: "hello" });
    assert.ok(result.startsWith("# Object\n"));
    assert.ok(result.includes("`a` property"));
    assert.ok(result.includes("`b` property"));
  });

  it("excludes function-valued own properties", () => {
    const obj = {
      count: 5,
      doStuff: () => { /* noop */ },
    };
    const result = agentHelp(obj);
    assert.ok(result.includes("`count` property"));
    assert.ok(!result.includes("doStuff"));
  });

  it("excludes underscored keys", () => {
    const result = agentHelp({ _secret: 1, public: 2 });
    assert.ok(!result.includes("_secret"));
    assert.ok(result.includes("`public` property"));
  });

  it("detects accessors on plain objects", () => {
    const obj: Record<string, unknown> = { count: 5 };
    Object.defineProperty(obj, "computed", {
      get() {
        return 42;
      },
      enumerable: true,
      configurable: true,
    });
    const result = agentHelp(obj);
    assert.ok(result.includes("`computed` accessor"));
    assert.ok(result.includes("`count` property"));
  });

  it("excludes non-enumerable properties on plain objects", () => {
    const obj: Record<string, unknown> = { visible: 1 };
    Object.defineProperty(obj, "hidden", {
      value: 2,
      enumerable: false,
      configurable: true,
    });
    const result = agentHelp(obj);
    assert.ok(result.includes("`visible` property"));
    assert.ok(!result.includes("hidden"));
  });
});

// ── Function target ───────────────────────────────────────────────────────────

describe("function target", () => {
  it("renders function signature with arity", () => {
    function connect(_host: string, _port: number): void { /* stub */ } // NOSONAR: test-local fixture
    const result = agentHelp(connect);
    assert.ok(result.startsWith("# connect\n"));
    assert.ok(result.includes("connect(_host, _port)"));
    assert.ok(result.includes("## Signature"));
    assert.ok(result.includes("## Agent usage rules"));
    assert.ok(!result.includes("## Public API"));
  });

  it("renders arrow function", () => {
    const fn = (x: number, y: number): number => x + y;
    const result = agentHelp(fn);
    assert.ok(result.includes("fn"));
    assert.ok(result.includes("## Signature"));
    assert.ok(result.includes("## Agent usage rules"));
  });

  it("uses 'function' for arrow function with cleared name", () => {
    const fn = (x: number): number => x;
    Object.defineProperty(fn, "name", { value: "", configurable: true });
    const result = agentHelp(fn);
    assert.ok(result.startsWith("# function\n"));
  });

  it("strips 'bound ' prefix from bound functions", () => {
    class Runner {
      execute(_cmd: string): number {
        return 0;
      }
    }
    const runner = new Runner();
    const result = agentHelp(runner.execute.bind(runner));
    assert.ok(result.startsWith("# execute\n"));
    assert.ok(result.includes("execute(arg0)"));
  });

  it("uses 'function' for anonymous function with no name", () => {
    const fn = function () { /* noop */ }; // NOSONAR: test-local fixture
    Object.defineProperty(fn, "name", { value: "", configurable: true });
    const result = agentHelp(fn);
    assert.ok(result.startsWith("# function\n"));
  });

  it("does not list public members for functions", () => {
    function go(): void { /* stub */ } // NOSONAR: test-local fixture
    const result = agentHelp(go);
    assert.ok(!result.includes("## Public API"));
  });

  it("appends agentNotes on a function", () => {
    function fetch(_url: string): void { /* stub */ } // NOSONAR: test-local fixture
    (fetch as unknown as Record<string, unknown>).agentNotes = () =>
      "## Do\n\n- Check the URL.";
    const result = agentHelp(fetch);
    assert.ok(result.includes("## Notes from fetch"));
    assert.ok(result.includes("Check the URL."));
  });
});

// ── Bound method target ───────────────────────────────────────────────────────

describe("bound method", () => {
  it("renders as function without receiver parameter", () => {
    class Pool {
      rotated(_n: number): this {
        return this;
      }
    }
    const result = agentHelp(new Pool().rotated.bind(new Pool()));
    assert.ok(result.includes("rotated(arg0)"));
    assert.ok(!result.includes("self"));
  });
});

// ── Inheritance ───────────────────────────────────────────────────────────────

describe("inheritance", () => {
  it("lists inherited methods", () => {
    class Base {
      baseMethod(): void { /* stub */ }
    }
    class Derived extends Base {
      derivedMethod(): void { /* stub */ }
    }
    const result = agentHelp(new Derived());
    assert.ok(result.includes("`baseMethod()` method"));
    assert.ok(result.includes("`derivedMethod()` method"));
  });

  it("lists overridden method only once", () => {
    class Base {
      doIt(): void { /* stub */ }
    }
    class Derived extends Base {
      override doIt(): void { /* stub */ }
    }
    const result = agentHelp(new Derived());
    const count = (result.match(/`doIt\(\)` method/g) || []).length;
    assert.equal(count, 1);
  });

  it("does not list Object.prototype methods", () => {
    class Plain {
      go(): void { /* stub */ }
    }
    const result = agentHelp(new Plain());
    assert.ok(!result.includes("`toString`"));
    assert.ok(!result.includes("`valueOf`"));
    assert.ok(!result.includes("`hasOwnProperty`"));
  });

  it("includes toString if directly declared", () => {
    class WithToString {
      toString(): string {
        return "custom";
      }
    }
    const result = agentHelp(new WithToString());
    assert.ok(result.includes("`toString()` method"));
  });
});

// ── Notes accumulation ────────────────────────────────────────────────────────

describe("notes accumulation", () => {
  it("emits parent notes first, then leaf notes", () => {
    class Parent {
      go(): void { /* stub */ }
      agentNotes(): string {
        return "Parent note.";
      }
    }
    class Child extends Parent {
      stop(): void { /* stub */ }
      override agentNotes(): string {
        return "Child note.";
      }
    }
    const result = agentHelp(new Child());
    const parentIdx = result.indexOf("## Notes from Parent");
    const childIdx = result.indexOf("## Notes from Child");
    assert.ok(parentIdx > 0);
    assert.ok(childIdx > parentIdx);
    assert.ok(result.includes("Parent note."));
    assert.ok(result.includes("Child note."));
  });

  it("leaf notes get precedence clause when parent has notes", () => {
    class Base {
      agentNotes(): string {
        return "Base.";
      }
    }
    class Leaf extends Base {
      override agentNotes(): string {
        return "Leaf.";
      }
    }
    const result = agentHelp(new Leaf());
    assert.ok(
      result.includes(
        "## Notes from Leaf (extends Base; if notes conflict, these take precedence)",
      ),
    );
  });

  it("does not duplicate inherited notes", () => {
    class Parent {
      agentNotes(): string {
        return "Parent only.";
      }
    }
    class Child extends Parent {
      doWork(): void { /* stub */ }
    }
    const result = agentHelp(new Child());
    const count = (result.match(/## Notes from/g) || []).length;
    assert.equal(count, 1);
    assert.ok(result.includes("## Notes from Parent"));
  });

  it("three-level inheritance produces base-to-leaf order", () => {
    class A {
      agentNotes(): string {
        return "A note.";
      }
    }
    class B extends A {
      override agentNotes(): string {
        return "B note.";
      }
    }
    class C extends B {
      override agentNotes(): string {
        return "C note.";
      }
    }
    const result = agentHelp(new C());
    const aIdx = result.indexOf("## Notes from A");
    const bIdx = result.indexOf("## Notes from B");
    const cIdx = result.indexOf("## Notes from C");
    assert.ok(aIdx > 0);
    assert.ok(bIdx > aIdx);
    assert.ok(cIdx > bIdx);
    assert.ok(
      result.includes(
        "## Notes from C (extends A, B; if notes conflict, these take precedence)",
      ),
    );
  });
});

// ── Empty public API ──────────────────────────────────────────────────────────

describe("empty public API", () => {
  it("shows (none) when no public members", () => {
    class Empty { // NOSONAR: intentionally empty test fixture
    }
    const result = agentHelp(new Empty());
    assert.ok(result.includes("- (none)"));
  });
});

// ── Ordering ──────────────────────────────────────────────────────────────────

describe("ordering", () => {
  it("sorts methods alphabetically", () => {
    class Ordered {
      zebra(): void { /* stub */ }
      alpha(): void { /* stub */ }
      middle(): void { /* stub */ }
    }
    const result = agentHelp(new Ordered());
    const alphaIdx = result.indexOf("`alpha()` method");
    const middleIdx = result.indexOf("`middle()` method");
    const zebraIdx = result.indexOf("`zebra()` method");
    assert.ok(alphaIdx < middleIdx);
    assert.ok(middleIdx < zebraIdx);
  });

  it("orders methods, then accessors, then properties", () => {
    class Mixed {
      method1(): void { /* stub */ }
      get prop1(): number {
        return 1;
      }
      field1 = "hello";
    }
    const result = agentHelp(new Mixed());
    const methodIdx = result.indexOf("`method1()` method");
    const accessorIdx = result.indexOf("`prop1` accessor");
    const propIdx = result.indexOf("`field1` property");
    assert.ok(methodIdx < accessorIdx);
    assert.ok(accessorIdx < propIdx);
  });
});

// ── Callable objects ──────────────────────────────────────────────────────────

describe("callable object", () => {
  it("treats callable object as a function", () => {
    function callable(): void { /* noop */ } // NOSONAR: test-local fixture
    callable.version = 1;
    const result = agentHelp(callable);
    assert.ok(result.startsWith("# callable\n"));
  });
});

// ── Parameter name recovery edge cases ────────────────────────────────────────

describe("parameter name recovery", () => {
  it("handles string default with closing paren", () => {
    function tricky(_x: unknown, _y: unknown = ")") { /* noop */ } // NOSONAR: fixture
    const result = agentHelp(tricky);
    assert.ok(result.includes("tricky(_x"));
    assert.ok(!result.includes("arg0"));
  });

  it("handles template literal with expression in default", () => {
    function tpl(_x: unknown, _y: unknown = `${1})`) { /* noop */ } // NOSONAR: fixture
    const result = agentHelp(tpl);
    assert.ok(result.includes("tpl(_x"));
  });

  it("handles nested template literal in default", () => {
    function nested(_x: unknown, _y: unknown = `${`hi`})`) { /* noop */ } // NOSONAR: fixture
    const result = agentHelp(nested);
    assert.ok(result.includes("nested(_x"));
  });

  it("handles escaped quote in string default", () => {
    function esc(_x: unknown, _y: unknown = "\"") { /* noop */ } // NOSONAR: fixture
    const result = agentHelp(esc);
    assert.ok(result.includes("esc(_x"));
  });

  it("handles string default with comma", () => {
    function comma(_x: unknown, _y: unknown = ",") { /* noop */ } // NOSONAR: fixture
    const result = agentHelp(comma);
    assert.ok(result.includes("comma(_x"));
    assert.ok(!result.includes("arg0"));
  });

  it("handles string default with comma", () => {
    function comma(_x: unknown, _y: unknown = ",") { /* noop */ } // NOSONAR: fixture
    const result = agentHelp(comma);
    assert.ok(result.includes("comma(_x"));
    assert.ok(!result.includes("arg0"));
  });
});

// ── Warning sink ──────────────────────────────────────────────────────────────

describe("warning sink", () => {
  it("can be replaced and observed", () => {
    const chunks: string[] = [];
    const sink: WarningSink = (chunk: string) => chunks.push(chunk);
    setWarnOutput(sink);
    try {
      assert.equal(getWarnOutput(), sink);
      class Both {
        agentHelp(): string {
          return "Full.";
        }
        agentNotes(): string {
          return "Ignored.";
        }
      }
      agentHelp(new Both());
      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].includes("agentNotes"));
    } finally {
      setWarnOutput(null);
    }
  });

  it("can be disabled with null", () => {
    setWarnOutput(null);
    assert.equal(getWarnOutput(), null);
    class Both {
      agentHelp(): string {
        return "Full.";
      }
      agentNotes(): string {
        return "Ignored.";
      }
    }
    const result = agentHelp(new Both());
    assert.equal(result, "Full.\n");
  });

  it("can be restored to stderr", () => {
    setWarnOutput(process.stderr);
    assert.equal(getWarnOutput(), process.stderr);
    setWarnOutput(null);
  });

  it("uses write method on object sink", () => {
    const chunks: string[] = [];
    const sink = {
      write(chunk: string) {
        chunks.push(chunk);
      },
    };
    setWarnOutput(sink);
    try {
      class Both {
        agentHelp(): string {
          return "Full.";
        }
        agentNotes(): string {
          return "Ignored.";
        }
      }
      agentHelp(new Both());
      assert.equal(chunks.length, 1);
    } finally {
      setWarnOutput(null);
    }
  });

  it("swallows errors from a throwing function sink", () => {
    setWarnOutput(() => { throw new Error("sink broken"); });
    try {
      class Both {
        agentHelp(): string {
          return "Full.";
        }
        agentNotes(): string {
          return "Ignored.";
        }
      }
      const result = agentHelp(new Both());
      assert.equal(result, "Full.\n");
    } finally {
      setWarnOutput(null);
    }
  });

  it("swallows errors from a throwing object sink", () => {
    setWarnOutput({ write() { throw new Error("sink broken"); } });
    try {
      class Both {
        agentHelp(): string {
          return "Full.";
        }
        agentNotes(): string {
          return "Ignored.";
        }
      }
      const result = agentHelp(new Both());
      assert.equal(result, "Full.\n");
    } finally {
      setWarnOutput(null);
    }
  });
});

// ── Output formatting ─────────────────────────────────────────────────────────

describe("output formatting", () => {
  it("ends with trailing newline", () => {
    class X {
      go(): void { /* stub */ }
    }
    const result = agentHelp(new X());
    assert.ok(result.endsWith("\n"));
  });

  it("separates sections with single blank line", () => {
    class X {
      go(): void { /* stub */ }
    }
    const result = agentHelp(new X());
    assert.ok(!result.includes("\n\n\n"));
  });

  it("includes the four usage rule bullets for classes", () => {
    class X {
      go(): void { /* stub */ }
    }
    const result = agentHelp(new X());
    assert.ok(result.includes("Prefer the public API listed above."));
    assert.ok(
      result.includes(
        "Do not use private, protected, underscored, or internal members.",
      ),
    );
    assert.ok(result.includes("Do not invent unsupported behavior."));
    assert.ok(
      result.includes(
        "If usage is ambiguous, prefer the simplest documented usage pattern.",
      ),
    );
  });

  it("includes the four usage rule bullets for functions", () => {
    function go(): void { /* stub */ } // NOSONAR: test-local fixture
    const result = agentHelp(go);
    assert.ok(
      result.includes(
        "Call this function according to the signature above.",
      ),
    );
    assert.ok(
      result.includes(
        "Do not invent unsupported parameters, return values, side effects, or lifecycle behavior.",
      ),
    );
    assert.ok(
      result.includes(
        "Do not use private, underscored, or internal implementation details.",
      ),
    );
    assert.ok(
      result.includes(
        "If usage is ambiguous, prefer the simplest documented usage pattern.",
      ),
    );
  });
});
