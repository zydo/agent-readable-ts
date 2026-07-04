# Getting Started

`agent-readable-ts` can be used as a library from TypeScript or JavaScript, and
as a CLI for inspecting local files or npm packages.

## Install

```sh
npm install agent-readable-ts
```

Node 20 or newer is required.

## Library Usage

```ts
import { agentHelp } from "agent-readable-ts";

console.log(agentHelp(SomeClass));        // class constructor
console.log(agentHelp(new SomeClass()));  // class instance
console.log(agentHelp(someFunction));     // function or arrow function
console.log(agentHelp({ a: 1 }));         // plain object
```

The programmatic API uses runtime JavaScript reflection. It can show public
members, parameter names when available, and `agentNotes()`/`agentHelp()` output,
but it cannot recover TypeScript-only types from compiled JavaScript.

## CLI Usage

The CLI can inspect installed npm packages, local JavaScript files, and local
TypeScript files.

```sh
npx agent-readable-ts commander
npx agent-readable-ts commander:Command
npx agent-readable-ts ./src/widget.ts:Widget
```

`commander` is only an example target. Use any trusted installed package, local
module, or local TypeScript file.

Usage:

```sh
agent-readable-ts [--install] <package-name>[:<export-name>]
agent-readable-ts <module-path>[:<export-name>]
```

- `package-name`: an installed npm package, such as `commander`, `pino`, or
  `@scope/package`.
- `module-path`: a `.js`, `.mjs`, `.cjs`, or `.ts` file path relative to the
  current directory.
- `export-name`: the named export to document. Use dots for nested access, such
  as `Things.Helper`.
- `--install`: allow the CLI to fetch a package on demand when it is not
  installed locally.

If no export name is given for a package, all exports are listed. If no export
name is given for a file, the module namespace object is documented.

`.ts` files require `tsx`. It is included as a dev dependency in this repo, and
`npx` resolves it automatically when running from this package.

## One-Off Execution

Use one of these when you do not want to add a dependency to the current project:

```sh
npx agent-readable-ts commander
npm exec -- agent-readable-ts commander:Command
pnpm dlx agent-readable-ts ./src/widget.ts:Widget
```

## On-Demand Package Fetching

Packages already installed in the current project load directly. For anything
else, the CLI refuses to fetch unless `--install` is passed:

```sh
npx agent-readable-ts --install left-pad
```

Fetched packages go into `~/.cache/agent-readable-ts`, or the directory named by
`AGENT_READABLE_CACHE`. They are never installed into the current project.

The install uses `npm install --ignore-scripts`, so package lifecycle scripts are
not run. Cached packages load offline without requiring `--install` again.

## Security

The CLI imports packages and local modules in order to inspect them. Importing a
module executes its top-level code. Only inspect packages and files you trust to
run on your machine.
