# Why agent-readable-ts?

Coding agents often guess a library API from stale memory: inventing methods,
using old signatures, or missing lifecycle rules that are not visible from a
method list alone.

`agent-readable-ts` gives agents a small, live, API-shaped context before they
write code:

- the public callable surface that can be discovered safely;
- TypeScript signatures when the CLI can parse source or declaration files;
- author-supplied usage rules from `agentNotes()`;
- full custom guidance from `agentHelp()` when a library needs it.

This reduces failed edit-test-retry loops and keeps the agent focused on the API
that exists in the current project.

## Why Not Just README Docs?

README files are written for people and often cover happy-path examples. Coding
agents need a compact answer to narrower questions:

- What members exist on this object right now?
- Which methods are public?
- What is the current call shape?
- Are there ordering, cleanup, async, or safety rules?

`agent-readable-ts` puts that information next to the implementation and exposes
it through one consistent inspection path.

## Runtime and Source Inspection

TypeScript type annotations do not exist at runtime. The library API therefore
uses conservative JavaScript reflection. The CLI fills more gaps by parsing
`.ts` source or adjacent `.d.ts` declaration files for packages and JavaScript
modules.

When type detail matters, prefer the CLI:

```sh
npx agent-readable-ts ./src/widget.ts:Widget
npx agent-readable-ts commander:Command
```
