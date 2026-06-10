import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import {
  parseTypeSignatures,
  listPackageExports,
  resolvePackageTypesPath,
} from "../src/source-types.js";

const FIXTURES_DIR = join(import.meta.dirname, "..", ".source-types-fixtures");

// ── parseTypeSignatures ─────────────────────────────────────────────────────────

describe("parseTypeSignatures", () => {
  it("returns null when no classes or functions are present", () => {
    assert.equal(parseTypeSignatures("const x = 1;", null), null);
  });

  it("extracts method params and return types from a class", () => {
    const source = `
export declare class Store {
  get(key: string): unknown;
  set(key: string, value: number): void;
}
`;
    const sigs = parseTypeSignatures(source, "Store");
    assert.ok(sigs);
    assert.deepEqual(sigs.get("get"), {
      params: [{ name: "key", type: "string" }],
      returnType: "unknown",
    });
    assert.deepEqual(sigs.get("set"), {
      params: [
        { name: "key", type: "string" },
        { name: "value", type: "number" },
      ],
      returnType: "void",
    });
  });

  it("defaults missing param types to 'any' and missing return type to null", () => {
    const source = `
export declare class Loose {
  run(flag);
}
`;
    const sigs = parseTypeSignatures(source, "Loose");
    assert.ok(sigs);
    assert.deepEqual(sigs.get("run"), {
      params: [{ name: "flag", type: "any" }],
      returnType: null,
    });
  });

  it("marks declared non-private class members and skips private declarations", () => {
    const source = `
export declare class Client {
  publicMethod(input: string): void;
  protected protectedMethod(count: number): boolean;
  private privateMethod;
}
`;
    const sigs = parseTypeSignatures(source, "Client");
    assert.ok(sigs);
    assert.deepEqual(sigs.get("publicMethod"), {
      params: [{ name: "input", type: "string" }],
      returnType: "void",
    });
    assert.deepEqual(sigs.get("protectedMethod"), {
      params: [{ name: "count", type: "number" }],
      returnType: "boolean",
    });
    assert.ok(sigs.declaredMembers?.has("publicMethod"));
    assert.ok(sigs.declaredMembers?.has("protectedMethod"));
    assert.equal(sigs.declaredMembers?.has("privateMethod"), false);
  });

  it("walks the inheritance chain to collect inherited methods", () => {
    const source = `
declare class Base {
  baseMethod(x: number): void;
}
export declare class Derived extends Base {
  derivedMethod(): string;
}
`;
    const sigs = parseTypeSignatures(source, "Derived");
    assert.ok(sigs);
    assert.ok(sigs.has("derivedMethod"));
    assert.ok(sigs.has("baseMethod"));
  });

  it("collects functions declared inside a namespace body", () => {
    const source = `
declare namespace NS {
  export function inner(a: string): void;
}
`;
    const sigs = parseTypeSignatures(source, null);
    assert.ok(sigs);
    assert.deepEqual(sigs.get("inner"), {
      params: [{ name: "a", type: "string" }],
      returnType: "void",
    });
  });

  it("collects all functions when no export name is given", () => {
    const source = `
export declare function one(a: string): void;
export declare function two(b: number): boolean;
`;
    const sigs = parseTypeSignatures(source, null);
    assert.ok(sigs);
    assert.ok(sigs.has("one"));
    assert.ok(sigs.has("two"));
  });

  // ── re-export following ────────────────────────────────────────────────────────

  describe("re-export resolution", () => {
    beforeEach(() => {
      mkdirSync(FIXTURES_DIR, { recursive: true });
    });
    afterEach(() => {
      rmSync(FIXTURES_DIR, { recursive: true, force: true });
    });

    it("follows `export * from` to a relative .d.ts file", () => {
      const implPath = join(FIXTURES_DIR, "impl.d.ts");
      const indexPath = join(FIXTURES_DIR, "index.d.ts");
      writeFileSync(
        implPath,
        `export declare class Store { get(key: string): unknown; }\n`,
      );
      writeFileSync(indexPath, `export * from "./impl";\n`);

      const sigs = parseTypeSignatures(`export * from "./impl";\n`, "Store", indexPath);
      assert.ok(sigs);
      assert.deepEqual(sigs.get("get"), {
        params: [{ name: "key", type: "string" }],
        returnType: "unknown",
      });
    });

    it("returns null when a re-export target cannot be resolved", () => {
      const indexPath = join(FIXTURES_DIR, "index.d.ts");
      const source = `export * from "./does-not-exist";\n`;
      writeFileSync(indexPath, source);
      assert.equal(parseTypeSignatures(source, "Missing", indexPath), null);
    });

    it("resolves node: specifiers in re-exports", () => {
      const indexPath = join(FIXTURES_DIR, "node-reexport.d.ts");
      const source = `export * from "node:path";\n`;
      writeFileSync(indexPath, source);
      const sigs = parseTypeSignatures(source, null, indexPath);
      // If @types/node is reachable, functions like resolve/join should appear.
      // The assertion is soft: we just want to exercise the resolution path.
      if (sigs) {
        assert.ok(sigs.size > 0);
      }
    });

    it("resolves relative specifiers without extension", () => {
      const targetPath = join(FIXTURES_DIR, "helper.d.ts");
      const indexPath = join(FIXTURES_DIR, "rel-index.d.ts");
      writeFileSync(targetPath, `export declare function helper(x: number): void;\n`);
      writeFileSync(indexPath, `export * from "./helper";\n`);
      const sigs = parseTypeSignatures(`export * from "./helper";\n`, null, indexPath);
      assert.ok(sigs);
      assert.ok(sigs.has("helper"));
    });

    it("collects inherited methods from an imported parent class", () => {
      const basePath = join(FIXTURES_DIR, "base.d.ts");
      const childPath = join(FIXTURES_DIR, "child.d.ts");
      writeFileSync(basePath, `export declare class Base { baseMethod(x: number): void; }\n`);
      const childSource = `
import { Base } from "./base";
export declare class Child extends Base {
  childMethod(y: string): boolean;
}
`;
      writeFileSync(childPath, childSource);

      const sigs = parseTypeSignatures(childSource, "Child", childPath);
      assert.ok(sigs);
      assert.deepEqual(sigs.get("childMethod"), {
        params: [{ name: "y", type: "string" }],
        returnType: "boolean",
      });
      assert.deepEqual(sigs.get("baseMethod"), {
        params: [{ name: "x", type: "number" }],
        returnType: "void",
      });
    });

    it("tracks re-export visits per requested export while resolving inheritance", () => {
      const basePath = join(FIXTURES_DIR, "base.d.ts");
      const childPath = join(FIXTURES_DIR, "child.d.ts");
      const indexPath = join(FIXTURES_DIR, "index.d.ts");
      writeFileSync(basePath, `export declare class Base { baseMethod(x: number): void; }\n`);
      writeFileSync(
        childPath,
        `
import { Base } from "./base";
export declare class Child extends Base {
  childMethod(y: string): boolean;
}
`,
      );
      const indexSource = `
export { Base } from "./base";
export { Child } from "./child";
`;
      writeFileSync(indexPath, indexSource);

      const sigs = parseTypeSignatures(indexSource, "Child", indexPath);
      assert.ok(sigs);
      assert.ok(sigs.has("childMethod"));
      assert.ok(sigs.has("baseMethod"));
    });

    it("returns null for unresolvable node: specifier", () => {
      const indexPath = join(FIXTURES_DIR, "node-bad.d.ts");
      const source = `export * from "node:nonexistent_xyz";\n`;
      writeFileSync(indexPath, source);
      assert.equal(parseTypeSignatures(source, "Whatever", indexPath), null);
    });

    it("skips re-export when resolved file is unreadable", () => {
      const targetPath = join(FIXTURES_DIR, "secret.d.ts");
      const indexPath = join(FIXTURES_DIR, "secret-index.d.ts");
      writeFileSync(targetPath, `export declare function go(): void;\n`);
      writeFileSync(indexPath, `export * from "./secret";\n`);
      chmodSync(targetPath, 0o000);
      try {
        const result = parseTypeSignatures(`export * from "./secret";\n`, null, indexPath);
        assert.equal(result, null);
      } finally {
        chmodSync(targetPath, 0o644);
      }
    });
  });
});

// ── listPackageExports ──────────────────────────────────────────────────────────

describe("listPackageExports", () => {
  it("lists classes, functions, and constants", () => {
    const source = `
export declare class Widget {}
export declare function build(): void;
export declare const VERSION: string;
`;
    const exports = listPackageExports(source, "pkg.d.ts");
    assert.deepEqual(
      exports.find((e) => e.name === "Widget"),
      { name: "Widget", kind: "class" },
    );
    assert.deepEqual(
      exports.find((e) => e.name === "build"),
      { name: "build", kind: "function" },
    );
    assert.deepEqual(
      exports.find((e) => e.name === "VERSION"),
      { name: "VERSION", kind: "constant" },
    );
  });

  it("lists names from a named re-export declaration", () => {
    const source = `export { alpha, beta } from "./other";\n`;
    const exports = listPackageExports(source, "pkg.d.ts");
    assert.ok(exports.some((e) => e.name === "alpha" && e.kind === "constant"));
    assert.ok(exports.some((e) => e.name === "beta" && e.kind === "constant"));
  });

  it("lists an identifier default export", () => {
    const source = `
declare const thing: number;
export default thing;
`;
    const exports = listPackageExports(source, "pkg.d.ts");
    assert.ok(exports.some((e) => e.name === "thing" && e.kind === "default"));
  });

  it("ignores a non-identifier default export", () => {
    const exports = listPackageExports(`export default 42;\n`, "pkg.d.ts");
    assert.equal(exports.length, 0);
  });

  it("de-duplicates repeated export names", () => {
    const source = `
export declare function dup(): void;
export { dup } from "./other";
`;
    const exports = listPackageExports(source, "pkg.d.ts");
    assert.equal(exports.filter((e) => e.name === "dup").length, 1);
  });

  it("ignores non-exported declarations", () => {
    const source = `
declare class Hidden {}
export declare class Shown {}
`;
    const exports = listPackageExports(source, "pkg.d.ts");
    assert.ok(!exports.some((e) => e.name === "Hidden"));
    assert.ok(exports.some((e) => e.name === "Shown"));
  });
});

// ── resolvePackageTypesPath ─────────────────────────────────────────────────────

describe("resolvePackageTypesPath", () => {
  beforeEach(() => {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  it("resolves the declaration path of an installed package", () => {
    const path = resolvePackageTypesPath("typescript");
    assert.ok(path);
    assert.ok(path.endsWith(".d.ts"));
  });

  it("uses a package root directory directly when provided", () => {
    const pkgDir = join(FIXTURES_DIR, "rootpkg");
    const typesPath = join(pkgDir, "types", "index.d.ts");
    mkdirSync(join(pkgDir, "types"), { recursive: true });
    writeFileSync(typesPath, "export declare class Root { run(flag: boolean): void; }\n");
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "rootpkg", version: "1.0.0", types: "types/index.d.ts" }),
    );

    assert.equal(resolvePackageTypesPath("rootpkg", pkgDir), typesPath);
  });

  it("returns null for a package that is not installed", () => {
    assert.equal(resolvePackageTypesPath("nonexistent-pkg-xyz-98765"), null);
  });
});
