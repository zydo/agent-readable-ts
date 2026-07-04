# FAQ

## Which Node versions are supported?

Node 20 or newer.

## Should I use the library API or the CLI?

Use `agentHelp(target)` when the target is already loaded in your program.

Use the CLI when you want better TypeScript signatures from source files or
declaration files:

```sh
npx agent-readable-ts ./src/widget.ts:Widget
npx agent-readable-ts commander:Command
```

## Can runtime reflection recover TypeScript types?

No. TypeScript types, interfaces, overloads, generic parameters, return types,
and doc comments are erased from compiled JavaScript.

The CLI can recover more type information by parsing `.ts` files or adjacent
declaration files.

## Why do some parameters show up as `arg0`?

Parameter names come from `Function.prototype.toString()` when possible. Native
functions, bound functions, destructured parameters, and some compiled output do
not preserve useful names, so the library falls back to `arg0`, `arg1`, and so
on.

## Are constructors or getters invoked?

No. Constructors are not called during introspection, and getters are not
invoked.

## Are private members shown?

JavaScript `#private` fields and methods are not reflectable and never appear.

TypeScript `private` and `protected` are compile-time constructs. The library
excludes names starting with `_`, but runtime JavaScript cannot perfectly detect
TypeScript visibility.

## Does the CLI fetch packages automatically?

No. Missing packages are only fetched when you pass `--install`.

Fetched packages go into an isolated cache and are installed with
`--ignore-scripts`. See [Getting Started](getting-started.md#on-demand-package-fetching).

## Is this the same as the Python package?

It is the TypeScript and JavaScript sibling of
[agent-readable](https://github.com/zydo/agent-readable). The shared idea is the
same: inspect the current API surface and author-provided usage rules before
coding against an unfamiliar target.
