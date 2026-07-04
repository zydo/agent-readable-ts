# Authoring Notes

Start with clear public method names and JSDoc. Add `agentNotes()` only when a
class or object has cross-method rules that are easy to miss.

Use `agentHelp()` rarely, when the auto-generated output is not the right shape
and you want to provide the full Markdown response yourself.

## `agentNotes()`

Define `agentNotes()` to append usage guidance after the generated public API
docs.

```ts
import { AgentNoter } from "agent-readable-ts";

interface Connection {}

class DatabasePool implements AgentNoter {
  acquire(): Promise<Connection> {
    throw new Error("not implemented");
  }

  release(conn: Connection): void {}

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  agentNotes(): string {
    return `
## Do

- Always call \`release(conn)\` after every \`acquire()\`, even on error.
- Call \`shutdown()\` during graceful application teardown.

## Do not

- Do not call \`acquire()\` after \`shutdown()\`.
- Do not share a \`Connection\` object across async tasks.
`;
  }
}
```

`agentNotes()` is a good fit for:

- lifecycle and call ordering rules;
- preconditions and cleanup requirements;
- sync vs async constraints;
- streaming vs non-streaming behavior;
- important do and do-not guidance.

Avoid duplicating obvious method-level information that belongs in names,
signatures, or JSDoc.

## Inheritance

Notes accumulate across the inheritance chain in parent-to-child order.

Unlike Python, TypeScript does not automatically merge notes from separate
prototype methods. Implement `agentNotes()` on each class that has its own
cross-method rules.

## `agentHelp()`

Implement `agentHelp()` for full control over the returned Markdown:

```ts
import { AgentHelper } from "agent-readable-ts";

class RateLimiter implements AgentHelper {
  agentHelp(): string {
    return `# RateLimiter

## Usage

- Create with \`new RateLimiter(maxRequests)\`.
- Call \`acquire()\` before making a request.
- Call \`release()\` after the request completes.
`;
  }
}
```

If both `agentHelp()` and `agentNotes()` are defined on the same target,
`agentHelp()` wins and `agentNotes()` is ignored. The library emits a warning,
but authors should treat this as an API design error.

## Warning Output

By default, advisory warnings are written to `process.stderr`. You can redirect
or silence them:

```ts
import { getWarnOutput, setWarnOutput } from "agent-readable-ts";

setWarnOutput((chunk: string) => {
  console.log("[WARN]", chunk.trim());
});

setWarnOutput({
  write(chunk: string) {
    console.log(chunk);
  },
});

setWarnOutput(null);
setWarnOutput(process.stderr);
```

`getWarnOutput()` returns the current warning sink.
