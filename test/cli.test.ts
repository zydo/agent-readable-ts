import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { chmodSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dirname, "..", "src", "cli.js");
const FIXTURES_DIR = join(import.meta.dirname, "..", ".cli-fixtures");

function exitCode(err: ExecFileException | null): number {
  if (!err) return 0;
  if (typeof err.code === "number") return err.code;
  return 1;
}

function runCli(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const options = { timeout: 30000, env: { ...process.env, ...env } };
    const child = execFile("node", [CLI_PATH, ...args], options, (err, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: exitCode(err),
      });
    });
    child.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: 1 });
    });
  });
}

describe("CLI", () => {
  beforeEach(() => {
    mkdirSync(FIXTURES_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(FIXTURES_DIR, { recursive: true, force: true });
  });

  it("prints usage to stderr with no args", async () => {
    const result = await runCli([]);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("Usage"));
    assert.equal(result.stdout, "");
  });

  it("prints help for a class instance from .mjs fixture", async () => {
    const fixturePath = join(FIXTURES_DIR, "sensor.mjs");
    writeFileSync(fixturePath, String.raw`
export class Sensor {
  calibrate(offset) { /* stub */ }
  read() { return 0; }
  agentNotes() {
    return "## Do\n\n- Call calibrate() before read().";
  }
}
`);
    const result = await runCli([`${fixturePath}:Sensor`]);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("# Sensor"));
    assert.ok(result.stdout.includes("calibrate(offset)"));
    assert.ok(result.stdout.includes("read()"));
    assert.ok(result.stdout.includes("## Notes from Sensor"));
  });

  it("prints help for a function from .mjs fixture", async () => {
    const fixturePath = join(FIXTURES_DIR, "fn.mjs");
    writeFileSync(fixturePath, `
export function connect(host, port) { /* stub */ }
`);
    const result = await runCli([`${fixturePath}:connect`]);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("# connect"));
    assert.ok(result.stdout.includes("connect(host, port)"));
    assert.ok(result.stdout.includes("## Signature"));
  });

  it("prints help for a module namespace (no colon)", async () => {
    const fixturePath = join(FIXTURES_DIR, "mod.mjs");
    writeFileSync(fixturePath, `
export function go() { /* stub */ }
export class Widget { run() { /* stub */ } }
`);
    const result = await runCli([fixturePath]);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("# Object"));
  });

  it("prints error for invalid module path", async () => {
    const result = await runCli(["/nonexistent/path/blah.mjs:Foo"]);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("Cannot import"));
  });

  it("prints error for missing export name", async () => {
    const fixturePath = join(FIXTURES_DIR, "missing.mjs");
    writeFileSync(fixturePath, `
export class Real { /* stub */ }
`);
    const result = await runCli([`${fixturePath}:DoesNotExist`]);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes('not found'));
    assert.ok(result.stderr.includes("Real"));
  });

  it("resolves nested export path with dots", async () => {
    const fixturePath = join(FIXTURES_DIR, "nested.mjs");
    writeFileSync(fixturePath, `
export const Things = {
  Helper: class Helper {
    doWork() { /* stub */ }
  }
};
`);
    const result = await runCli([`${fixturePath}:Things.Helper`]);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("# Helper"));
    assert.ok(result.stdout.includes("doWork()"));
  });

  it("extracts types from adjacent .d.mts for .mjs file", async () => {
    const jsPath = join(FIXTURES_DIR, "typed.mjs");
    const dtsPath = join(FIXTURES_DIR, "typed.d.mts");
    writeFileSync(jsPath, `
export class Store {
  get(key) { return undefined; }
  set(key, value) {}
}
`);
    writeFileSync(dtsPath, `
export declare class Store {
  get(key: string): unknown;
  set(key: string, value: number): void;
}
`);
    const result = await runCli([`${jsPath}:Store`]);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("get(key: string): unknown"));
    assert.ok(result.stdout.includes("set(key: string, value: number): void"));
  });

  it("extracts types from adjacent .d.ts for .js file", async () => {
    const jsPath = join(FIXTURES_DIR, "api.js");
    const dtsPath = join(FIXTURES_DIR, "api.d.ts");
    writeFileSync(jsPath, `
export function fetch(url) { /* stub */ }
`);
    writeFileSync(dtsPath, `
export declare function fetch(url: string, options?: RequestInit): Promise<Response>;
`);
    const result = await runCli([`${jsPath}:fetch`]);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("fetch(url: string, options: RequestInit): Promise<Response>"));
  });

  // ── package-name resolution ─────────────────────────────────────────────────

  it("lists exports from a package name", async () => {
    const result = await runCli(["commander"]);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("# commander"));
    assert.ok(result.stdout.includes("`Command` class"));
    assert.ok(result.stdout.includes("`Option` class"));
    assert.ok(result.stdout.includes("`program` object"));
    assert.ok(result.stdout.includes("createCommand") && result.stdout.includes("function"));
  });

  it("documents a specific export from a package", async () => {
    const result = await runCli(["commander:Command"]);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("# Command"));
    assert.ok(result.stdout.includes("## Public API"));
    assert.ok(result.stdout.includes("option(flags: string"));
    assert.ok(result.stdout.includes("parse(argv: readonly string[]"));
  });

  it("documents a function export from a package", async () => {
    const result = await runCli(["commander:createCommand"]);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("# createCommand"));
    assert.ok(result.stdout.includes("## Signature"));
  });

  it("lists runtime exports when package declarations are unavailable", async () => {
    const cacheDir = join(FIXTURES_DIR, "cache");
    const packageDir = join(cacheDir, "node_modules", "runtimeonly");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "runtimeonly", version: "1.0.0", type: "module", main: "index.js" }),
    );
    writeFileSync(join(packageDir, "index.js"), `
export class RuntimeClient {}
export function toFile() {}
export const config = {};
export default RuntimeClient;
`);

    const result = await runCli(["runtimeonly"], {
      AGENT_READABLE_CACHE: cacheDir,
    });
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("# runtimeonly"));
    assert.ok(result.stdout.includes("## Exports"));
    assert.ok(result.stdout.includes("`RuntimeClient` class"));
    assert.ok(result.stdout.includes("`toFile(...)` function"));
    assert.ok(result.stdout.includes("`config` object"));
  });

  it("extracts types from an on-demand cached package", async () => {
    const cacheDir = join(FIXTURES_DIR, "typed-cache");
    const packageDir = join(cacheDir, "node_modules", "typedcache");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "typedcache",
        version: "1.0.0",
        type: "module",
        main: "index.js",
        types: "index.d.ts",
        exports: {
          ".": {
            types: "./index.d.ts",
            default: "./index.js",
          },
        },
      }),
    );
    writeFileSync(join(packageDir, "index.js"), `
export class Client {
  run(input) {}
}
`);
    writeFileSync(join(packageDir, "index.d.ts"), `
export declare class Client {
  run(input: string): Promise<void>;
}
`);

    const result = await runCli(["typedcache:Client"], {
      AGENT_READABLE_CACHE: cacheDir,
    });
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes("# Client"));
    assert.ok(result.stdout.includes("run(input: string): Promise<void>"));
  });

  it("prints error for unknown package (on-demand install fails)", async () => {
    const fakeBinDir = join(FIXTURES_DIR, "bin");
    mkdirSync(fakeBinDir, { recursive: true });
    const fakeNpm = join(fakeBinDir, "npm");
    writeFileSync(fakeNpm, "#!/bin/sh\necho 'simulated npm install failure' >&2\nexit 1\n");
    chmodSync(fakeNpm, 0o755);

    const result = await runCli(["nonexistent-pkg-xyz-12345"], {
      AGENT_READABLE_CACHE: join(FIXTURES_DIR, "cache"),
      PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
    });
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("Failed to install"));
  });

  it("prints error for missing export from a package", async () => {
    const result = await runCli(["commander:DoesNotExist"]);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes("not found"));
  });
});
