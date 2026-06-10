import { describe, it, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as Pkgs from "../src/packages.js";
import type { ExportDescriptor } from "../src/source-types.js";

// Solitary unit: packages.ts's only project collaborator is source-types
// (`parseTypeSignatures`, used by loadTypeSigs). We mock it so this run touches
// only packages.ts — loadTypeSigs is verified by how it routes/delegates, not by
// the real parser's output (that lives in source-types.test.ts).

const sourceTypesUrl = new URL("../src/source-types.js", import.meta.url).href;
const SIG = new Map([["m", { params: [], returnType: null }]]);
const parseStub = mock.fn((_src: string, _name: string | null, _path?: string): unknown => SIG);

function lastParsedPath(): unknown {
  return parseStub.mock.calls.at(-1)?.arguments[2];
}

let pkgs: typeof Pkgs;

before(async () => {
  mock.module(sourceTypesUrl, { namedExports: { parseTypeSignatures: parseStub } });
  pkgs = await import("../src/packages.js");
});

// ── pure helpers (no collaborators) ─────────────────────────────────────────────

describe("parseSpecifier", () => {
  it("splits on the last colon", () => {
    assert.deepEqual(pkgs.parseSpecifier("mod.ts:Widget"), { modulePath: "mod.ts", exportName: "Widget" });
  });
  it("returns null export when no colon is present", () => {
    assert.deepEqual(pkgs.parseSpecifier("mod.ts"), { modulePath: "mod.ts", exportName: null });
  });
  it("ignores a Windows drive-letter colon", () => {
    const winPath = String.raw`C:\src\mod.ts`;
    assert.deepEqual(pkgs.parseSpecifier(winPath), { modulePath: winPath, exportName: null });
  });
  it("splits a scoped package with an export", () => {
    assert.deepEqual(pkgs.parseSpecifier("@scope/pkg:Thing"), { modulePath: "@scope/pkg", exportName: "Thing" });
  });
});

describe("isBarePackageName", () => {
  it("treats package names as bare", () => {
    assert.equal(pkgs.isBarePackageName("commander"), true);
    assert.equal(pkgs.isBarePackageName("@scope/pkg"), true);
    assert.equal(pkgs.isBarePackageName("zod@3"), true);
  });
  it("treats paths and node specifiers as non-bare", () => {
    assert.equal(pkgs.isBarePackageName("./local"), false);
    assert.equal(pkgs.isBarePackageName("/abs/path"), false);
    assert.equal(pkgs.isBarePackageName("node:fs"), false);
    assert.equal(pkgs.isBarePackageName("mod.ts"), false);
    assert.equal(pkgs.isBarePackageName("lib.js"), false);
  });
});

describe("splitPackageSpec", () => {
  it("returns the name unchanged when no version is present", () => {
    assert.deepEqual(pkgs.splitPackageSpec("zod"), { name: "zod", install: "zod" });
    assert.deepEqual(pkgs.splitPackageSpec("@scope/pkg"), { name: "@scope/pkg", install: "@scope/pkg" });
  });
  it("strips the version from the import name but keeps it for install", () => {
    assert.deepEqual(pkgs.splitPackageSpec("zod@3"), { name: "zod", install: "zod@3" });
    assert.deepEqual(pkgs.splitPackageSpec("@scope/pkg@1.2.3"), { name: "@scope/pkg", install: "@scope/pkg@1.2.3" });
  });
});

describe("walkExportPath", () => {
  it("resolves a simple and a nested path", () => {
    assert.equal(pkgs.walkExportPath({ a: 1 }, "a"), 1);
    assert.equal(pkgs.walkExportPath({ a: { b: 42 } }, "a.b"), 42);
  });
  it("throws with available names when a part is missing", () => {
    assert.throws(() => pkgs.walkExportPath({ real: 1 }, "missing"), /not found.*real/s);
  });
  it("reports (none) when walking an empty object", () => {
    assert.throws(() => pkgs.walkExportPath({}, "x"), /\(none\)/);
  });
  it("throws when walking through null/undefined", () => {
    assert.throws(() => pkgs.walkExportPath({ a: null }, "a.b"), /null\/undefined/);
  });
});

describe("isModuleNotFound", () => {
  it("recognizes both ESM and CJS not-found codes", () => {
    assert.equal(pkgs.isModuleNotFound({ code: "ERR_MODULE_NOT_FOUND" }), true);
    assert.equal(pkgs.isModuleNotFound({ code: "MODULE_NOT_FOUND" }), true);
  });
  it("rejects other errors", () => {
    assert.equal(pkgs.isModuleNotFound({ code: "EACCES" }), false);
    assert.equal(pkgs.isModuleNotFound(new Error("boom")), false);
  });
});

describe("formatExportList", () => {
  it("formats every export kind", () => {
    const exports: ExportDescriptor[] = [
      { name: "Widget", kind: "class" },
      { name: "build", kind: "function" },
      { name: "noSig", kind: "function" },
      { name: "thing", kind: "default" },
      { name: "config", kind: "constant" },
    ];
    const typeSigs = new Map([
      ["build", { params: [{ name: "x", type: "number" }], returnType: "void" }],
    ]);
    const out = pkgs.formatExportList("pkg", exports, typeSigs);
    assert.ok(out.startsWith("# pkg\n\n## Exports\n\n"));
    assert.ok(out.includes("- `Widget` class"));
    assert.ok(out.includes("- `build(x: number): void` function"));
    assert.ok(out.includes("- `noSig(...)` function"));
    assert.ok(out.includes("- `thing` (default export)"));
    assert.ok(out.includes("- `config` object"));
  });
});

describe("listRuntimeExports", () => {
  it("lists runtime module namespace exports when declarations are unavailable", () => {
    class Widget {}
    function build() { /* fixture */ }
    const out = pkgs.listRuntimeExports({
      Widget,
      build,
      config: { enabled: true },
      default: Widget,
      __esModule: true,
    });

    assert.deepEqual(out, [
      { name: "Widget", kind: "class" },
      { name: "build", kind: "function" },
      { name: "config", kind: "constant" },
      { name: "default", kind: "default" },
    ]);
  });
});

// ── loadTypeSigs: routing + delegation (parser mocked) ──────────────────────────

describe("loadTypeSigs", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ar-loadtypes-"));
    parseStub.mock.resetCalls();
    parseStub.mock.mockImplementation(() => SIG);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, source = "// content"): string {
    const p = join(dir, name);
    writeFileSync(p, source);
    return p;
  }

  it("parses a .d.ts file directly and returns the parser result", () => {
    const p = write("a.d.ts");
    assert.equal(pkgs.loadTypeSigs(p, "A"), SIG);
    assert.equal(parseStub.mock.callCount(), 1);
    assert.equal(lastParsedPath(), p);
  });

  it("parses .ts and .tsx source directly", () => {
    assert.equal(pkgs.loadTypeSigs(write("b.ts"), "B"), SIG);
    assert.equal(lastParsedPath(), join(dir, "b.ts"));
    assert.equal(pkgs.loadTypeSigs(write("c.tsx"), "C"), SIG);
    assert.equal(lastParsedPath(), join(dir, "c.tsx"));
  });

  it("routes .js/.mjs/.cjs to the adjacent declaration file", () => {
    write("d.d.ts");
    assert.equal(pkgs.loadTypeSigs(write("d.js"), "D"), SIG);
    assert.equal(lastParsedPath(), join(dir, "d.d.ts"));

    write("e.d.mts");
    assert.equal(pkgs.loadTypeSigs(write("e.mjs"), "E"), SIG);
    assert.equal(lastParsedPath(), join(dir, "e.d.mts"));

    write("f.d.cts");
    assert.equal(pkgs.loadTypeSigs(write("f.cjs"), "F"), SIG);
    assert.equal(lastParsedPath(), join(dir, "f.d.cts"));
  });

  it("returns undefined and does not call the parser for a .js with no adjacent declarations", () => {
    const js = write("g.js");
    assert.equal(pkgs.loadTypeSigs(js, "G"), undefined);
    assert.equal(parseStub.mock.callCount(), 0);
  });

  it("returns undefined and does not call the parser for an unknown extension", () => {
    assert.equal(pkgs.loadTypeSigs(write("notes.txt"), null), undefined);
    assert.equal(parseStub.mock.callCount(), 0);
  });

  it("returns undefined when the declaration file is unreadable", () => {
    assert.equal(pkgs.loadTypeSigs(join(dir, "missing.d.ts"), null), undefined);
    assert.equal(parseStub.mock.callCount(), 0);
  });

  it("returns undefined when the parser yields null", () => {
    parseStub.mock.mockImplementation(() => null);
    assert.equal(pkgs.loadTypeSigs(write("h.d.ts"), null), undefined);
    assert.equal(parseStub.mock.callCount(), 1);
  });
});

// ── isInstalledIn ───────────────────────────────────────────────────────────────

describe("isInstalledIn", () => {
  it("returns true for a package resolvable from the directory", () => {
    assert.equal(pkgs.isInstalledIn("commander", process.cwd()), true);
  });
  it("returns false for a package that is not installed", () => {
    assert.equal(pkgs.isInstalledIn("not-a-real-pkg-zzz-987", process.cwd()), false);
  });
});

describe("local package load", () => {
  it("returns the actual package root for locally resolvable packages", async () => {
    const root = pkgs.resolveLocalPackageRoot("commander");
    assert.ok(root);
    assert.ok(root.endsWith(join("node_modules", "commander")));

    const loaded = await pkgs.loadPackage("commander");
    assert.equal(loaded.typesDir, root);
    assert.ok("Command" in loaded.mod);
  });
});

// ── on-demand load (no network) ─────────────────────────────────────────────────

describe("on-demand package load", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ar-cache-"));
    const pkgDir = join(root, "node_modules", "fakepkg");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "fakepkg", version: "1.0.0", type: "module", main: "index.js" }),
    );
    writeFileSync(join(pkgDir, "index.js"), "export const hello = 1;\nexport default { hi: 2 };\n");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("importFromDir loads a package's namespace from the directory", async () => {
    const mod = await pkgs.importFromDir("fakepkg", root);
    assert.equal(mod.hello, 1);
    assert.deepEqual(mod.default, { hi: 2 });
  });

  it("importFromDir falls back to CJS entry resolution when bare ESM import is not exported", async () => {
    // exports only declares a `require` condition, so `import("cjsonly")` is not
    // resolvable as a bare ESM specifier — the fallback must resolve e.cjs.
    const pkgDir = join(root, "node_modules", "cjsonly");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "cjsonly", version: "1.0.0", exports: { ".": { require: "./e.cjs" } } }),
    );
    writeFileSync(join(pkgDir, "e.cjs"), "module.exports = { tag: 'CJS' };\n");

    const mod = await pkgs.importFromDir("cjsonly", root);
    assert.deepEqual(mod.default, { tag: "CJS" });
  });

  it("ensureCacheInstall skips installing when already present and writes the cache package.json", () => {
    const returned = pkgs.ensureCacheInstall("fakepkg", "fakepkg", root);
    assert.equal(returned, root);
    assert.ok(existsSync(join(root, "package.json")));
  });

  it("importFromDir throws when package has no resolvable entry", async () => {
    const pkgDir = join(root, "node_modules", "norev");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "norev", exports: {} }));
    await assert.rejects(() => pkgs.importFromDir("norev", root));
  });

  it("loadPackage loads from cache when package is not installed locally", async () => {
    const mod = await pkgs.loadPackage("fakepkg", root);
    assert.equal(mod.typesDir, root);
    assert.equal(mod.mod.hello, 1);
  });

  it("loadPackage rethrows a non-module-not-found error from the local import", async () => {
    // "@" is an invalid specifier (ERR_INVALID_MODULE_SPECIFIER on newer
    // Node, ERR_MODULE_NOT_FOUND on older), so the local-import attempt
    // rethrows rather than falling through to on-demand install.
    await assert.rejects(() => pkgs.loadPackage("@", root), /Cannot import package "|"|Failed to install "@"|ERR_INVALID_MODULE_SPECIFIER/);
  });
});
