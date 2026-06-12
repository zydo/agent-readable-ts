#!/usr/bin/env node
import { agentHelp } from "./index.js";
import { resolvePackageTypesPath, listPackageExports } from "./source-types.js";
import {
  parseSpecifier,
  isBarePackageName,
  splitPackageSpec,
  walkExportPath,
  loadTypeSigs,
  formatExportList,
  listRuntimeExports,
  loadPackage,
} from "./packages.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

function usage(): never {
  process.stderr.write(
    "Usage: agent-readable-ts [--install] <module-path>[:<export-name>]\n" +
    "       agent-readable-ts [--install] <package-name>[:<export-name>]\n" +
    "\n" +
    "Options:\n" +
    "  --install  Allow fetching a package on demand (with npm install) when it\n" +
    "             is not already installed locally or in the cache.\n",
  );
  process.exit(1);
}

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────────

/** Extract the leaf name from a dotted export path for type-signature lookup. */
function leafName(exportName: string | null): string | null {
  if (!exportName) return null;
  const lastDot = exportName.lastIndexOf(".");
  return lastDot >= 0 ? exportName.slice(lastDot + 1) : exportName;
}

// ── file-based handling ────────────────────────────────────────────────────────

async function handleFile(modulePath: string, exportName: string | null): Promise<void> {
  const absolutePath = resolve(process.cwd(), modulePath);
  const fileUrl = pathToFileURL(absolutePath).href;

  let mod: Record<string, unknown>;
  try {
    mod = (await import(fileUrl)) as Record<string, unknown>;
  } catch (err) {
    fail(`Cannot import "${modulePath}": ${err instanceof Error ? err.message : String(err)}`);
  }

  const target = exportName ? walkExportPath(mod, exportName) : mod;
  const typeSigs = loadTypeSigs(absolutePath, leafName(exportName));
  process.stdout.write(agentHelp(target, typeSigs));
}

// ── package-based handling ─────────────────────────────────────────────────────

async function handlePackage(spec: string, exportName: string | null, allowInstall: boolean): Promise<void> {
  const { name } = splitPackageSpec(spec);
  const { mod, typesDir } = await loadPackage(spec, undefined, allowInstall);

  const dtsPath = resolvePackageTypesPath(name, typesDir);

  // No export name: list all exports
  if (!exportName) {
    const dtsExports = dtsPath ? listPackageExports(readFileSync(dtsPath, "utf-8"), dtsPath) : [];
    const exports = dtsExports.length > 0 ? dtsExports : listRuntimeExports(mod);
    if (exports.length === 0) fail(`No exports found in "${name}".`);
    const typeSigs = dtsPath ? loadTypeSigs(dtsPath, null) : undefined;
    process.stdout.write(formatExportList(name, exports, typeSigs));
    return;
  }

  // Specific export: walk and document
  const target = walkExportPath(mod, exportName);
  const typeSigs = dtsPath ? loadTypeSigs(dtsPath, leafName(exportName)) : undefined;
  process.stdout.write(agentHelp(target, typeSigs));
}

// ── main ───────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const allowInstall = args.includes("--install");
const positional = args.filter((arg) => arg !== "--install");

const unknownFlag = positional.find((arg) => arg.startsWith("--"));
if (unknownFlag) {
  process.stderr.write(`Error: Unknown option "${unknownFlag}"\n`);
  usage();
}

const specifier = positional[0];
if (!specifier) usage();

try {
  const { modulePath, exportName } = parseSpecifier(specifier);
  if (isBarePackageName(modulePath)) {
    await handlePackage(modulePath, exportName, allowInstall);
  } else {
    await handleFile(modulePath, exportName);
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
