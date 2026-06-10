import type { TypeSignatureMap, ParamTypeInfo } from "./model.js";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

type TsApi = typeof import("typescript");

let _ts: TsApi | null | undefined;

interface ImportBinding {
  specifier: string;
  exportName: string;
  namespace: boolean;
}

function getTs(): TsApi | null {
  if (_ts === undefined) {
    try {
      _ts = createRequire(import.meta.url)("typescript") as TsApi; /* node:coverage disable */
    } catch {
      _ts = null;
    } /* node:coverage enable */
  }
  return _ts;
}

function extractParams(params: unknown[]): ParamTypeInfo[] {
  return (params as Array<{ name: { getText(): string }; type?: { getText(): string } }>).map((p) => ({
    name: p.name.getText(),
    type: p.type ? p.type.getText().replace(/\s+/g, " ").trim() : "any",
  }));
}

function isPrivateMember(ts: TsApi, node: unknown): boolean {
  const modifiers = (node as { modifiers?: unknown[] }).modifiers;
  return !!modifiers?.some((m) => (m as { kind: number }).kind === ts.SyntaxKind.PrivateKeyword);
}

function markDeclaredMember(result: TypeSignatureMap, name: string): void {
  result.declaredMembers ??= new Set<string>();
  result.declaredMembers.add(name);
}

function mergeDeclaredMembers(target: TypeSignatureMap, source: TypeSignatureMap): void {
  if (!source.declaredMembers) return;
  target.declaredMembers ??= new Set<string>();
  for (const name of source.declaredMembers) {
    target.declaredMembers.add(name);
  }
}

function visitClass(ts: TsApi, node: unknown, result: TypeSignatureMap): void {
  const decl = node as { members: unknown[] };
  for (const member of decl.members) {
    const m = member as {
      name?: { getText(): string };
      parameters?: unknown[];
      type?: { getText(): string };
      kind: number;
    };
    if (!m.name) continue;
    if (isPrivateMember(ts, member)) continue;

    const name = m.name.getText();
    if (m.kind === ts.SyntaxKind.MethodDeclaration && !result.has(m.name.getText())) {
      markDeclaredMember(result, name);
      result.set(name, {
        params: extractParams(m.parameters ?? []),
        returnType: m.type ? m.type.getText().replace(/\s+/g, " ").trim() : null,
      });
    } else if (m.kind === ts.SyntaxKind.GetAccessor && !result.has(m.name.getText())) {
      markDeclaredMember(result, name);
      result.set(name, {
        params: [],
        returnType: m.type ? m.type.getText().replace(/\s+/g, " ").trim() : null,
      });
    } else if (m.kind === ts.SyntaxKind.PropertyDeclaration) {
      markDeclaredMember(result, name);
    }
  }
}

// ── module resolution helpers ──────────────────────────────────────────────────

function makeResolutionHost() {
  return {
    fileExists(path: string): boolean {
      return existsSync(path);
    },
    readFile(path: string): string | undefined {
      try {
        return readFileSync(path, "utf-8"); /* node:coverage disable */
      } catch {
        return undefined;
      } /* node:coverage enable */
    },
    directoryExists(path: string): boolean {
      try {
        return existsSync(path) && statSync(path).isDirectory(); /* node:coverage disable */
      } catch {
        return false;
      } /* node:coverage enable */
    },
    getCurrentDirectory(): string {
      return process.cwd();
    },
  };
}

function tryTsResolve(ts: TsApi, specifier: string, fromFile: string): string | null {
  const host = makeResolutionHost();
  for (const kind of [ts.ModuleResolutionKind.Node10, ts.ModuleResolutionKind.Node16]) {
    const result = ts.resolveModuleName(specifier, fromFile, { moduleResolution: kind }, host);
    if (result.resolvedModule?.resolvedFileName) {
      return result.resolvedModule.resolvedFileName;
    }
  }
  return null;
}

function resolveDirectPackageTypes(packageName: string, fromDir: string): string | null {
  const pkgJsonPath = resolve(fromDir, "package.json");
  if (!existsSync(pkgJsonPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
      name?: unknown;
      types?: unknown;
      typings?: unknown;
    };
    if (pkg.name !== packageName) return null;
    const typesPath =
      (typeof pkg.types === "string" && pkg.types) ||
      (typeof pkg.typings === "string" && pkg.typings);
    if (!typesPath) return null;
    const absoluteTypesPath = resolve(dirname(pkgJsonPath), typesPath);
    return existsSync(absoluteTypesPath) ? absoluteTypesPath : null;
  } catch {
    return null;
  }
}

function resolveNodeSpecifier(specifier: string, fromFile: string): string | null {
  const nodeMatch = /^node:(.+)$/.exec(specifier);
  if (!nodeMatch) return null;
  const moduleName = nodeMatch[1];
  for (const searchDir of getSearchDirs(fromFile)) {
    const dtsPath = resolve(searchDir, "node_modules", "@types", "node", `${moduleName}.d.ts`);
    if (existsSync(dtsPath)) return dtsPath;
  }
  return null;
}

function resolveRelativeSpecifier(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const dir = dirname(fromFile);
  for (const ext of [".d.ts", ".d.mts", ".ts", ".tsx"]) {
    const p = resolve(dir, specifier + ext);
    if (existsSync(p)) return p;
  }
  for (const ext of [".d.ts", ".d.mts"]) {
    const p = resolve(dir, specifier, "index" + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

function resolveModulePath(ts: TsApi, specifier: string, fromFile: string): string | null {
  return tryTsResolve(ts, specifier, fromFile)
    ?? resolveNodeSpecifier(specifier, fromFile)
    ?? resolveRelativeSpecifier(specifier, fromFile);
}

function visitKey(filePath: string, exportName: string | null): string {
  return `${filePath}\0${exportName ?? "*"}`;
}

function getSearchDirs(fromFile: string): string[] {
  const dirs: string[] = [];
  let dir = dirname(fromFile);
  while (dir !== dirname(dir)) {
    dirs.push(dir);
    dir = dirname(dir);
  }
  dirs.push(dir);
  return dirs;
}

// ── AST visitor helpers ────────────────────────────────────────────────────────

function collectClassAndFunc(
  api: TsApi,
  node: unknown,
  exportName: string | null,
  classMap: Map<string, unknown>,
  result: TypeSignatureMap,
): void {
  const n = node as {
    name?: { getText(): string };
    kind: number;
    parameters?: unknown[];
    type?: { getText(): string };
  };

  if (api.isClassDeclaration(node as Parameters<typeof api.isClassDeclaration>[0]) && n.name) {
    classMap.set(n.name.getText(), node);
  }

  if (api.isFunctionDeclaration(node as Parameters<typeof api.isFunctionDeclaration>[0]) && n.name) {
    const fnName = n.name.getText();
    if (!exportName || fnName === exportName) {
      if (!result.has(fnName)) {
        result.set(fnName, {
          params: extractParams(n.parameters ?? []),
          returnType: n.type ? n.type.getText().replace(/\s+/g, " ").trim() : null,
        });
      }
    }
  }
}

function collectModuleBody(api: TsApi, node: unknown, visit: (n: unknown) => void): void {
  if (!api.isModuleDeclaration(node as Parameters<typeof api.isModuleDeclaration>[0])) return;
  const body = (node as { body?: { kind: number; statements?: unknown[] } }).body;
  if (body && api.isModuleBlock(body as Parameters<typeof api.isModuleBlock>[0])) {
    for (const stmt of (body as { statements: unknown[] }).statements) {
      visit(stmt);
    }
  }
}

function collectImportBindings(api: TsApi, sf: unknown): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  api.forEachChild(sf as Parameters<typeof api.forEachChild>[0], (node: unknown) => {
    if (!api.isImportDeclaration(node as Parameters<typeof api.isImportDeclaration>[0])) return;
    const n = node as {
      moduleSpecifier?: { text?: unknown };
      importClause?: {
        name?: { getText(): string };
        namedBindings?: unknown;
      };
    };
    const specifier = typeof n.moduleSpecifier?.text === "string" ? n.moduleSpecifier.text : null;
    if (!specifier || !n.importClause) return;

    const defaultName = n.importClause.name?.getText();
    if (defaultName) {
      bindings.set(defaultName, { specifier, exportName: defaultName, namespace: false });
    }

    const namedBindings = n.importClause.namedBindings;
    if (!namedBindings) return;
    if (api.isNamedImports(namedBindings as Parameters<typeof api.isNamedImports>[0])) {
      const imports = namedBindings as { elements: Array<{ name: { getText(): string }; propertyName?: { getText(): string } }> };
      for (const el of imports.elements) {
        bindings.set(el.name.getText(), {
          specifier,
          exportName: el.propertyName?.getText() ?? el.name.getText(),
          namespace: false,
        });
      }
    } else if (api.isNamespaceImport(namedBindings as Parameters<typeof api.isNamespaceImport>[0])) {
      const ns = namedBindings as { name: { getText(): string } };
      bindings.set(ns.name.getText(), { specifier, exportName: "*", namespace: true });
    }
  });

  return bindings;
}

function importBindingForParent(
  parentExpression: string | undefined,
  imports: Map<string, ImportBinding>,
): { specifier: string; exportName: string } | null {
  if (!parentExpression) return null;
  const parts = parentExpression.split(".");
  const binding = imports.get(parts[0]);
  if (!binding) return null;
  if (binding.namespace) {
    const exportName = parts.slice(1).join(".");
    return exportName ? { specifier: binding.specifier, exportName } : null;
  }
  return { specifier: binding.specifier, exportName: binding.exportName };
}

function mergeImportedParentSigs(
  api: TsApi,
  parentExpression: string | undefined,
  filePath: string | null,
  imports: Map<string, ImportBinding>,
  visited: Set<string>,
  result: TypeSignatureMap,
): boolean {
  if (!filePath) return false;
  const binding = importBindingForParent(parentExpression, imports);
  if (!binding) return false;

  const resolvedPath = resolveModulePath(api, binding.specifier, filePath);
  if (!resolvedPath || visited.has(visitKey(resolvedPath, binding.exportName))) return false;
  visited.add(visitKey(resolvedPath, binding.exportName));

  try {
    const source = readFileSync(resolvedPath, "utf-8");
    const inherited = parseSourceForTypes(api, source, binding.exportName, resolvedPath, visited);
    for (const [key, value] of inherited) {
      if (!result.has(key)) result.set(key, value);
    }
    mergeDeclaredMembers(result, inherited);
    return inherited.size > 0;
  } catch {
    return false;
  }
}

function collectReExport(
  api: TsApi,
  node: unknown,
  exportName: string | null,
  filePath: string | null,
  visited: Set<string>,
  result: TypeSignatureMap,
): void {
  if (!api.isExportDeclaration(node as Parameters<typeof api.isExportDeclaration>[0])) return;
  const n = node as { moduleSpecifier?: { text: string } };
  if (!n.moduleSpecifier || typeof n.moduleSpecifier.text !== "string" || !filePath) return;

  const resolvedPath = resolveModulePath(api, n.moduleSpecifier.text, filePath);
  if (!resolvedPath || visited.has(visitKey(resolvedPath, exportName))) return;
  visited.add(visitKey(resolvedPath, exportName));

  try {
    const resolvedSource = readFileSync(resolvedPath, "utf-8");
    const resolvedSigs = parseSourceForTypes(api, resolvedSource, exportName, resolvedPath, visited);
    for (const [key, value] of resolvedSigs) {
      if (!result.has(key)) result.set(key, value);
    }
    mergeDeclaredMembers(result, resolvedSigs);
  } catch {
    // resolved file not readable, skip
  }
}

function collectInheritanceChain(
  api: TsApi,
  exportName: string,
  classMap: Map<string, unknown>,
  filePath: string | null,
  imports: Map<string, ImportBinding>,
  visited: Set<string>,
  result: TypeSignatureMap,
): void {
  const targetClass = classMap.get(exportName);
  if (!targetClass) return;

  const chainVisited = new Set<string>();
  let current = exportName;
  while (current) {
    const decl = classMap.get(current);
    if (!decl || chainVisited.has(current)) break;
    chainVisited.add(current);
    visitClass(api, decl, result);
    const cls = decl as { heritageClauses?: Array<{ types: Array<{ expression: { getText(): string } }> }> };
    const parent = cls.heritageClauses?.[0]?.types?.[0]?.expression?.getText();
    if (parent && classMap.has(parent)) {
      current = parent;
    } else {
      mergeImportedParentSigs(api, parent, filePath, imports, visited, result);
      current = "";
    }
  }
}

// ── main parsing ───────────────────────────────────────────────────────────────

function parseSourceForTypes(
  ts: TsApi,
  source: string,
  exportName: string | null,
  filePath: string | null,
  visited: Set<string>,
): TypeSignatureMap {
  const sf = ts.createSourceFile(filePath ?? "input.ts", source, ts.ScriptTarget.Latest, true);
  if (filePath) visited.add(visitKey(filePath, exportName));
  const result: TypeSignatureMap = new Map();
  const api = ts;
  const classMap = new Map<string, unknown>();
  const imports = collectImportBindings(api, sf);

  function visit(node: unknown): void {
    collectClassAndFunc(api, node, exportName, classMap, result);
    collectModuleBody(api, node, visit);
    collectReExport(api, node, exportName, filePath, visited, result);
    api.forEachChild(node as Parameters<typeof api.forEachChild>[0], visit);
  }

  api.forEachChild(sf, visit);

  if (exportName) {
    collectInheritanceChain(api, exportName, classMap, filePath, imports, visited, result);
  } else {
    for (const [, decl] of classMap) {
      visitClass(api, decl, result);
    }
  }

  return result;
}

// ── package resolution ──────────────────────────────────────────────────────────

export function resolvePackageTypesPath(packageName: string, fromDir: string = process.cwd()): string | null {
  const directTypesPath = resolveDirectPackageTypes(packageName, fromDir);
  if (directTypesPath) return directTypesPath;

  const ts = getTs();
  if (!ts) return null;
  const virtualFrom = resolve(fromDir, "__resolve__.ts");
  return tryTsResolve(ts, packageName, virtualFrom);
}

// ── export listing ─────────────────────────────────────────────────────────────

export interface ExportDescriptor {
  name: string;
  kind: "class" | "function" | "constant" | "default";
}

function hasExportModifier(api: TsApi, node: unknown): boolean {
  const modifiers = (node as { modifiers?: unknown[] }).modifiers;
  if (!modifiers) return false;
  return modifiers.some(
    (m) => (m as { kind: number }).kind === api.SyntaxKind.ExportKeyword,
  );
}

interface ExportNodeShape {
  name?: { getText(): string };
  declarationList?: { declarations: Array<{ name: { getText(): string } }> };
  expression?: { getText(): string };
  exportClause?: { elements?: Array<{ name: { getText(): string } }> };
}

function variableExports(n: ExportNodeShape): ExportDescriptor[] {
  return (n.declarationList?.declarations ?? []).map(
    (d): ExportDescriptor => ({ name: d.name.getText(), kind: "constant" }),
  );
}

function defaultExport(expression?: { getText(): string }): ExportDescriptor[] {
  if (!expression) return [];
  const name = expression.getText();
  return /^[A-Za-z_$]/.test(name) ? [{ name, kind: "default" }] : [];
}

function reExportNames(clause?: { elements?: Array<{ name: { getText(): string } }> }): ExportDescriptor[] {
  return (clause?.elements ?? []).map(
    (e): ExportDescriptor => ({ name: e.name.getText(), kind: "constant" }),
  );
}

function isExported(api: TsApi, node: unknown): boolean {
  // `export { … }` / `export … from` (ExportDeclaration) and `export default …`
  // (ExportAssignment) are exports by syntax and carry no `export` modifier.
  return (
    hasExportModifier(api, node) ||
    api.isExportDeclaration(node as Parameters<typeof api.isExportDeclaration>[0]) ||
    api.isExportAssignment(node as Parameters<typeof api.isExportAssignment>[0])
  );
}

function exportDescriptors(api: TsApi, node: unknown, n: ExportNodeShape): ExportDescriptor[] {
  if (api.isClassDeclaration(node as Parameters<typeof api.isClassDeclaration>[0]) && n.name) {
    return [{ name: n.name.getText(), kind: "class" }];
  }
  if (api.isFunctionDeclaration(node as Parameters<typeof api.isFunctionDeclaration>[0]) && n.name) {
    return [{ name: n.name.getText(), kind: "function" }];
  }
  if (api.isVariableStatement(node as Parameters<typeof api.isVariableStatement>[0])) {
    return variableExports(n);
  }
  if (api.isExportAssignment(node as Parameters<typeof api.isExportAssignment>[0])) {
    return defaultExport(n.expression);
  }
  if (api.isExportDeclaration(node as Parameters<typeof api.isExportDeclaration>[0])) {
    return reExportNames(n.exportClause);
  }
  return [];
}

function collectExportedDeclarations(api: TsApi, sf: unknown): ExportDescriptor[] {
  const seen = new Set<string>();
  const exports: ExportDescriptor[] = [];

  function visitStatement(node: unknown): void {
    if (!isExported(api, node)) return;
    const n = node as ExportNodeShape;
    for (const d of exportDescriptors(api, node, n)) {
      if (!seen.has(d.name)) {
        seen.add(d.name);
        exports.push(d);
      }
    }
  }

  api.forEachChild(sf as Parameters<typeof api.forEachChild>[0], visitStatement);
  return exports;
}

export function listPackageExports(source: string, filePath: string): ExportDescriptor[] {
  const ts = getTs();
  if (!ts) return [];
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  return collectExportedDeclarations(ts, sf);
}

// ── type signature parsing ─────────────────────────────────────────────────────

export function parseTypeSignatures(
  source: string,
  exportName: string | null,
  filePath?: string,
): TypeSignatureMap | null {
  const ts = getTs();
  if (!ts) return null;

  const visited = new Set<string>();
  if (filePath) visited.add(visitKey(filePath, exportName));

  const result = parseSourceForTypes(ts, source, exportName, filePath ?? null, visited);
  return result.size > 0 ? result : null;
}
