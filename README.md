# agent-readable-ts

Coding agents hallucinate a library's API — inventing methods, using stale signatures, or misusing real methods because the correct usage rules (lifecycle order, preconditions, anti-patterns) are not visible from the API surface alone.

`agent-readable-ts` lets a library author attach those rules next to a class, object, or function. A package-level function `agentHelp(target)` returns curated, agent-oriented Markdown: the real public runtime surface that can be discovered safely, plus any author-supplied behavioral rules. An agent that calls `agentHelp(target)` before writing code against the target sees the real callable surface and the right usage rules.

> **For coding agents:** Install the agent skill to have this run automatically before coding against unfamiliar packages:
> ```sh
> npx skills add zydo/skills --skill agent-readable
> ```

**Token efficiency.** When an agent hallucinates an API, the resulting code fails — and each failed attempt triggers a retry cycle that burns tokens without making progress. `agent-readable-ts` generates compact, precise, accurate descriptions of publicly exposed interfaces (verified by runtime introspection on live packages). Calling `npx agent-readable-ts <package>` on unfamiliar packages and classes *before* writing code surfaces the real API upfront, preventing that waste.

## Other languages

- **Python:** [agent-readable](https://github.com/zydo/agent-readable) — same idea for Python packages and classes.

## Install

```sh
npm install agent-readable-ts
```

## CLI

The package includes a CLI for generating documentation from the command line. It works with local files **and installed npm packages**.

```sh
npx agent-readable-ts commander           # list all exports
npx agent-readable-ts commander:Command   # document a specific export
npx agent-readable-ts ./src/widget.ts:Widget   # a local TypeScript file
```

### Usage

```sh
agent-readable-ts <package-name>[:<export-name>]
agent-readable-ts <module-path>[:<export-name>]
```

- **`package-name`** — any installed npm package (e.g. `commander`, `pino`, `@scope/package`)
- **`module-path`** — a file path (`.js`, `.mjs`, or `.ts`) relative to the current directory
- **`export-name`** — the named export to document (use dots for nested access, e.g. `Things.Helper`)

If no export name is given for a **package**, all exports are listed. If no export name is given for a **file**, the module namespace object is documented.

> `.ts` files require `tsx` to be installed. It is included as a devDependency, and `npx` resolves it automatically.

### Examples

List all exports from an installed package:

```sh
npm install commander
npx agent-readable-ts commander
```

Output:

```markdown
# commander

## Exports

- `CommanderError` class
- `InvalidArgumentError` class
- `Argument` class
- `Option` class
- `Help` class
- `Command` class
- `createCommand(name: string): Command` function
- `createOption(flags: string, description: string): Option` function
- `createArgument(name: string, description: string): Argument` function
- `program` object
```

Document a specific export with full type signatures:

```sh
npx agent-readable-ts commander:Command
```

Output:

```markdown
# Command

## Public API

- `action(fn: (this: this, ...args: any[]) => void | Promise<void>): this` method
- `addArgument(arg: Argument): this` method
- `addCommand(cmd: Command, opts: CommandOptions): this` method
- `addOption(option: Option): this` method
- `alias(): string` method
- `argument(name: string, description: string, defaultValue: unknown): this` method
- `command(nameAndArgs: string, description: string, opts: ExecutableCommandOptions): this` method
- `description(): string` method
- `error(message: string, errorOptions: ErrorOptions): never` method
- `hook(event: HookEvent, listener: (...args: any[]) => void | Promise<void>): this` method
- `option(flags: string, description: string, defaultValue: unknown): this` method
- `parse(argv: readonly string[], parseOptions: ParseOptions): this` method
- `parseAsync(argv: readonly string[], parseOptions: ParseOptions): Promise<this>` method
- `requiredOption(flags: string, description: string, defaultValue: unknown): this` method
- `version(str: string, flags: string, description: string): this` method
- ... (80+ methods total)

## Agent usage rules

- Prefer the public API listed above.
- Do not use private, protected, underscored, or internal members.
- Do not invent unsupported behavior.
- If usage is ambiguous, prefer the simplest documented usage pattern.
```

Document a local file:

```sh
npx agent-readable-ts ./src/widget.ts:Widget    # a class export
npx agent-readable-ts ./src/util.ts:connect     # a function export
npx agent-readable-ts ./dist/api.js:fetch       # a .js file with adjacent api.d.ts
```

## Two protocols

| Protocol       | Role              | Output behavior                                  |
| -------------- | ----------------- | ------------------------------------------------ |
| `agentHelp()`  | Full replacement  | Returned Markdown is used verbatim               |
| `agentNotes()` | Additive guidance | Notes are appended after auto-generated API docs |

### `agentHelp()` — Full replacement

If a target implements `agentHelp()`, the returned string **is** the output verbatim. No auto-generated sections are added.

```ts
import { AgentHelper, agentHelp } from "agent-readable-ts";

class RateLimiter implements AgentHelper {
  agentHelp(): string {
    return `# RateLimiter

## Usage

- Create with \`new RateLimiter(maxRequests)\`.
- Call \`acquire()\` before making a request.
- Call \`release()\` after the request completes.

## Limits

- Default max is 100 concurrent requests.
- Exceeding the limit blocks until a slot opens.
`;
  }
}

console.log(agentHelp(new RateLimiter()));
```

Output:

```markdown
# RateLimiter

## Usage

- Create with `new RateLimiter(maxRequests)`.
- Call `acquire()` before making a request.
- Call `release()` after the request completes.

## Limits

- Default max is 100 concurrent requests.
- Exceeding the limit blocks until a slot opens.
```

If the target also defines `agentNotes()`, a warning is written to stderr and the notes are dropped.

### `agentNotes()` — Additive guidance

Define `agentNotes()` on any class to append usage rules to the auto-generated documentation. Notes accumulate across the inheritance chain in parent-to-child order.

```ts
import { AgentNoter, agentHelp } from "agent-readable-ts";

class Sensor {
  calibrate(offset: number): void {}
  read(): number {
    return 0;
  }

  agentNotes(): string {
    return `
## Do

- Call \`calibrate()\` once during setup, before \`read()\`.

## Do not

- Do not call \`read()\` before \`calibrate()\` on first use.
`;
  }
}

console.log(agentHelp(new Sensor()));
```

### `agentHelp(target)` entry point

The single entry point accepts:

- Class constructors
- Class instances
- Plain objects
- Plain functions
- Arrow functions
- Bound method values
- Callable objects

```ts
import { agentHelp } from "agent-readable-ts";

agentHelp(MyClass);          // class constructor
agentHelp(new MyClass());    // class instance
agentHelp({ a: 1 });        // plain object
agentHelp(myFunction);       // function
agentHelp(obj.method.bind(obj)); // bound method
```

## Examples

### Example 1: Wrapping a class you do not own

```ts
import { agentHelp } from "agent-readable-ts";

class Client {
  connect(url: string): void {}
  query(sql: string): unknown {
    return undefined;
  }
}

class DocumentedClient extends Client {
  agentNotes(): string {
    return `
## Do

- Call \`connect()\` before \`query()\`.

## Do not

- Do not pass untrusted SQL directly to \`query()\`.
`;
  }
}

console.log(agentHelp(new DocumentedClient()));
```

Output:

```markdown
# DocumentedClient

## Public API

- `connect(url)` method
- `query(sql)` method

## Agent usage rules

- Prefer the public API listed above.
- Do not use private, protected, underscored, or internal members.
- Do not invent unsupported behavior.
- If usage is ambiguous, prefer the simplest documented usage pattern.

## Notes from DocumentedClient

## Do

- Call `connect()` before `query()`.

## Do not

- Do not pass untrusted SQL directly to `query()`.
```

### Example 2: Inheritance with accumulated notes

```ts
import { agentHelp } from "agent-readable-ts";

class Sensor {
  calibrate(offset: number): void {}
  read(): number {
    return 0;
  }

  agentNotes(): string {
    return `
## Do

- Call \`calibrate()\` once during setup, before \`read()\`.

## Do not

- Do not call \`read()\` before \`calibrate()\` on first use.
`;
  }
}

class CalibratedSensor extends Sensor {
  reset(): void {}

  override agentNotes(): string {
    return `
## Do

- Use \`reset()\` only when recalibration is required.

## Do not

- Do not call \`reset()\` in the hot read path.
`;
  }
}

console.log(agentHelp(new CalibratedSensor()));
```

Output:

```markdown
# CalibratedSensor

## Public API

- `calibrate(offset)` method
- `read()` method
- `reset()` method

## Agent usage rules

- Prefer the public API listed above.
- Do not use private, protected, underscored, or internal members.
- Do not invent unsupported behavior.
- If usage is ambiguous, prefer the simplest documented usage pattern.

## Notes from Sensor

## Do

- Call `calibrate()` once during setup, before `read()`.

## Do not

- Do not call `read()` before `calibrate()` on first use.

## Notes from CalibratedSensor (extends Sensor; if notes conflict, these take precedence)

## Do

- Use `reset()` only when recalibration is required.

## Do not

- Do not call `reset()` in the hot read path.
```

### Example 3: Full control via `agentHelp()`

```ts
import { agentHelp } from "agent-readable-ts";

class RateLimiter {
  agentHelp(): string {
    return `# RateLimiter

## Usage

- Create with \`new RateLimiter(maxRequests)\`.
- Call \`acquire()\` before making a request.
- Call \`release()\` after the request completes.

## Limits

- Default max is 100 concurrent requests.
- Exceeding the limit blocks until a slot opens.
`;
  }
  agentNotes(): string {
    return "This is ignored because agentHelp() owns the full output.";
  }
}

console.log(agentHelp(new RateLimiter()));
```

Output:

```markdown
# RateLimiter

## Usage

- Create with `new RateLimiter(maxRequests)`.
- Call `acquire()` before making a request.
- Call `release()` after the request completes.

## Limits

- Default max is 100 concurrent requests.
- Exceeding the limit blocks until a slot opens.
```

A warning is written to stderr noting that `agentNotes()` is ignored.

### Example 4: Any class, no setup

```ts
import { agentHelp } from "agent-readable-ts";

class Cache {
  get(key: string): unknown {
    return undefined;
  }
  set(key: string, value: unknown): void {}
  clear(): void {}
}

console.log(agentHelp(new Cache()));
```

Output:

```markdown
# Cache

## Public API

- `clear()` method
- `get(key)` method
- `set(key, value)` method

## Agent usage rules

- Prefer the public API listed above.
- Do not use private, protected, underscored, or internal members.
- Do not invent unsupported behavior.
- If usage is ambiguous, prefer the simplest documented usage pattern.
```

### Example 5: Functions and bound methods

```ts
import { agentHelp } from "agent-readable-ts";

function connect(host: string, port: number): void {}

class Runner {
  execute(command: string): number {
    return 0;
  }
}

const runner = new Runner();

console.log(agentHelp(connect));
console.log(agentHelp(runner.execute.bind(runner)));
```

Output for `connect`:

````markdown
# connect

## Signature

```ts
connect(host, port)
```

## Agent usage rules

- Call this function according to the signature above.
- Do not invent unsupported parameters, return values, side effects, or lifecycle behavior.
- Do not use private, underscored, or internal implementation details.
- If usage is ambiguous, prefer the simplest documented usage pattern.
````

Output for the bound method:

````markdown
# execute

## Signature

```ts
execute(arg0)
```

## Agent usage rules

- Call this function according to the signature above.
- Do not invent unsupported parameters, return values, side effects, or lifecycle behavior.
- Do not use private, underscored, or internal implementation details.
- If usage is ambiguous, prefer the simplest documented usage pattern.
````

## Warning output

By default, advisory warnings are written to `process.stderr`. You can redirect or silence them:

```ts
import { setWarnOutput, getWarnOutput } from "agent-readable-ts";

// Redirect to a custom sink
setWarnOutput((chunk: string) => {
  console.log("[WARN]", chunk.trim());
});

// Or use an object with a write method
setWarnOutput({ write(chunk: string) { /* handle */ } });

// Silence warnings
setWarnOutput(null);

// Restore default
setWarnOutput(process.stderr);
```

## Limitations in TypeScript

Runtime JavaScript reflection cannot read TypeScript type annotations, interfaces, overloads, generic parameters, return types, or doc comments. The auto-generated documentation is intentionally conservative:

- **Parameter names** are recovered from `Function.prototype.toString()` when possible. For native or bound functions, names fall back to `arg0`, `arg1`, etc. using `Function.length`. Destructured parameters also fall back to `argN`.
- **Type information** is available in two ways:
  - **CLI with `.ts` source**: full types are extracted by parsing the source file with the TypeScript compiler API.
  - **CLI with `.js`/`.mjs`/`.cjs` files**: types are extracted from adjacent `.d.ts`/`.d.mts`/`.d.cts` declaration files if present (covers published packages).
  - **Library API (`agentHelp()`)**: no type information — only runtime parameter names and arity.
- **No per-method descriptions.** Authors convey prose through `agentNotes()` or by implementing `agentHelp()`.
- **Constructors are not invoked** during introspection. Construction guidance belongs in notes.
- **Instance fields** can only be discovered from an actual instance or plain object, not from a class constructor.
- **Getters are not invoked** during introspection.
- **TypeScript `private` and `protected`** are compile-time constructs. The library excludes names starting with `_` but cannot perfectly detect visibility at runtime.
- **JavaScript `#private` fields and methods** are not reflectable and never appear in output.
- **Module-level documentation** is not supported.
- **Dynamic package import or CLI-based introspection** is intentionally omitted.

## License

MIT
