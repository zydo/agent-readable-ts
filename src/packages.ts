/**
 * Specifier parsing, type-declaration loading, and on-demand package
 * acquisition for the CLI.
 *
 * Everything here is side-effect-light and free of `process.exit`: functions
 * that hit an unrecoverable condition throw, so the CLI entry point can convert
 * the error to a message and the logic stays unit-testable.
 */

import { parseTypeSignatures } from "./source-types.js";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { TypeSignatureMap } from "./model.js";
import type { ExportDescriptor } from "./source-types.js";

export const CACHE_DIR =
  process.env.AGENT_READABLE_CACHE ?? join(homedir(), ".cache", "agent-readable-ts");

// ── specifier parsing ──────────────────────────────────────────────────────────

export function parseSpecifier(specifier: string): { modulePath: string; exportName: string | null } {
  const colonIdx = specifier.lastIndexOf(":");
  // Ignore a Windows drive-letter colon (e.g. "C:\path") so paths without an
  // explicit export are not split at the drive letter.
  if (colonIdx <= 1) {
    return { modulePath: specifier, exportName: null };
  }
  return { modulePath: specifier.slice(0, colonIdx), exportName: specifier.slice(colonIdx + 1) };
}

export function isBarePackageName(modulePath: string): boolean {
  if (modulePath.startsWith(".")) return false;
  if (modulePath.startsWith("/")) return false;
  if (modulePath.startsWith("node:")) return false;
  if (/\.[a-zA-Z]{1,4}$/.test(modulePath)) return false;
  return true;
}

export function splitPackageSpec(spec: string): { name: string; install: string } {
  // Separate an install spec (which may carry a version) from the import name.
  // Scoped: "@scope/pkg@1.2.3" → name "@scope/pkg". Plain: "pkg@1" → name "pkg".
  const at = spec.startsWith("@") ? spec.indexOf("@", 1) : spec.indexOf("@");
  return at > 0 ? { name: spec.slice(0, at), install: spec } : { name: spec, install: spec };
}

// ── export walking ─────────────────────────────────────────────────────────────

export function walkExportPath(target: unknown, exportPath: string): unknown {
  let current: unknown = target;
  for (const part of exportPath.split(".")) {
    if (current === null || current === undefined) {
      throw new Error(`Cannot resolve "${part}" on null/undefined while walking "${exportPath}".`);
    }
    const obj = current as Record<string, unknown>;
    if (!(part in obj)) {
      const available = Object.keys(obj).join(", ");
      throw new Error(`Export "${part}" not found. Available exports: ${available || "(none)"}`);
    }
    current = obj[part];
  }
  return current;
}

// ── type signature loading ─────────────────────────────────────────────────────

function parseFile(path: string, exportName: string | null): TypeSignatureMap | undefined {
  try {
    const source = readFileSync(path, "utf-8");
    return parseTypeSignatures(source, exportName, path) ?? undefined;
  } catch {
    return undefined;
  }
}

function adjacentDtsPath(absolutePath: string): string | null {
  if (absolutePath.endsWith(".js")) return absolutePath.replace(/\.js$/, ".d.ts");
  if (absolutePath.endsWith(".mjs")) return absolutePath.replace(/\.mjs$/, ".d.mts");
  if (absolutePath.endsWith(".cjs")) return absolutePath.replace(/\.cjs$/, ".d.cts");
  return null;
}

export function loadTypeSigs(absolutePath: string, exportName: string | null): TypeSignatureMap | undefined {
  // Declaration files: parse directly.
  if (absolutePath.endsWith(".d.ts") || absolutePath.endsWith(".d.mts") || absolutePath.endsWith(".d.cts")) {
    return parseFile(absolutePath, exportName);
  }

  // Source files (.ts excluding .d.ts, or .tsx): parse directly.
  if (absolutePath.endsWith(".tsx") || (absolutePath.endsWith(".ts") && !absolutePath.endsWith(".d.ts"))) {
    return parseFile(absolutePath, exportName);
  }

  // .js/.mjs/.cjs: look for an adjacent declaration file.
  const dtsPath = adjacentDtsPath(absolutePath);
  return dtsPath ? parseFile(dtsPath, exportName) : undefined;
}

// ── export list formatting ─────────────────────────────────────────────────────

export function formatExportList(packageName: string, exports: ExportDescriptor[], typeSigs?: TypeSignatureMap): string {
  const lines = exports.map((e) => {
    if (e.kind === "class") return `- \`${e.name}\` class`;
    if (e.kind === "function") {
      const sig = typeSigs?.get(e.name);
      if (sig) {
        const params = sig.params.map((p) => `${p.name}: ${p.type}`).join(", ");
        const ret = sig.returnType ? `: ${sig.returnType}` : "";
        return `- \`${e.name}(${params})${ret}\` function`;
      }
      return `- \`${e.name}(...)\` function`;
    }
    if (e.kind === "default") return `- \`${e.name}\` (default export)`;
    return `- \`${e.name}\` object`;
  });

  return `# ${packageName}\n\n## Exports\n\n${lines.join("\n")}\n`;
}

function isClassValue(value: unknown): boolean {
  return typeof value === "function" && /^class\s/.test(Function.prototype.toString.call(value));
}

function runtimeExportKind(name: string, value: unknown): ExportDescriptor["kind"] {
  if (name === "default") return "default";
  if (isClassValue(value)) return "class";
  if (typeof value === "function") return "function";
  return "constant";
}

export function listRuntimeExports(mod: Record<string, unknown>): ExportDescriptor[] {
  return Object.keys(mod)
    .filter((name) => name !== "__esModule")
    .map((name): ExportDescriptor => ({ name, kind: runtimeExportKind(name, mod[name]) }));
}

// ── on-demand package acquisition ───────────────────────────────────────────────

export function isModuleNotFound(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

export function isInstalledIn(name: string, dir: string): boolean {
  const req = createRequire(join(dir, "__resolve__.js"));
  try {
    req.resolve(name);
    return true;
  } catch {
    // ESM-only packages can refuse `require.resolve`; fall back to package.json.
  }
  try {
    req.resolve(`${name}/package.json`);
    return true;
  } catch {
    return false;
  }
}

export function ensureCacheInstall(name: string, install: string, dir: string = CACHE_DIR): string {
  mkdirSync(dir, { recursive: true });
  const pkgJson = join(dir, "package.json");
  if (!existsSync(pkgJson)) {
    writeFileSync(pkgJson, JSON.stringify({ name: "agent-readable-cache", private: true }) + "\n");
  }
  if (!isInstalledIn(name, dir)) {
    process.stderr.write(`Installing ${install} on demand into ${dir} ...\n`);
    try {
      // Save into the cache's own package.json so previously fetched packages are
      // not pruned as "extraneous" when a different package is installed later.
      execFileSync(
        "npm",
        ["install", install, "--prefix", dir, "--save", "--no-audit", "--no-fund", "--loglevel=error"],
        { stdio: ["ignore", "ignore", "inherit"] },
      );
    } catch (err) {
      throw new Error(`Failed to install "${install}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return dir;
}

function resolveEntry(name: string, dir: string): string | null {
  try {
    return createRequire(join(dir, "__resolve__.js")).resolve(name);
  } catch {
    return null;
  }
}

export async function importFromDir(name: string, dir: string): Promise<Record<string, unknown>> {
  // A loader placed in `dir` resolves the bare specifier against dir/node_modules;
  // dynamic import transparently handles both CJS and ESM packages.
  const loaderPath = join(dir, `.arload-${randomUUID()}.mjs`);
  writeFileSync(loaderPath, `export default await import(${JSON.stringify(name)});\n`);
  try {
    const loaded = (await import(pathToFileURL(loaderPath).href)) as { default: Record<string, unknown> };
    return loaded.default;
  } catch (err) {
    // Some package layouts (CJS, no "exports" map) trip ESM bare-specifier
    // resolution, which falls back to a non-existent index.js. Resolve the real
    // entry via Node's CJS resolver and import that file directly instead.
    const entry = resolveEntry(name, dir);
    if (!entry) throw err;
    return (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
  } finally {
    rmSync(loaderPath, { force: true });
  }
}

export interface LoadedPackage {
  mod: Record<string, unknown>;
  typesDir: string;
}

export async function loadPackage(spec: string, cacheDir: string = CACHE_DIR): Promise<LoadedPackage> {
  const { name, install } = splitPackageSpec(spec);

  // Prefer a copy already resolvable from the current project.
  try {
    const mod = (await import(name)) as Record<string, unknown>;
    return { mod, typesDir: process.cwd() };
  } catch (err) {
    if (!isModuleNotFound(err)) {
      throw new Error(`Cannot import package "${name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Not installed locally: fetch on demand into the cache, then load from there.
  const dir = ensureCacheInstall(name, install, cacheDir);
  const mod = await importFromDir(name, dir);
  return { mod, typesDir: dir };
}
