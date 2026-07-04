# Examples

## Installed Package

List all exports from an installed package:

```sh
npm install commander
npx agent-readable-ts commander
```

Example output:

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

Document a specific export:

```sh
npx agent-readable-ts commander:Command
```

## Local File

```sh
npx agent-readable-ts ./src/widget.ts:Widget
npx agent-readable-ts ./src/util.ts:connect
npx agent-readable-ts ./dist/api.js:fetch
```

For `.js`, `.mjs`, and `.cjs` files, the CLI can read adjacent `.d.ts`,
`.d.mts`, and `.d.cts` declaration files when they exist.

## Wrapping a Class You Do Not Own

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

## Inheritance With Accumulated Notes

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

Notes are emitted in parent-to-child order. If rules conflict, the child class
guidance should be treated as more specific.

## Full Control With `agentHelp()`

```ts
import { agentHelp } from "agent-readable-ts";

class RateLimiter {
  agentHelp(): string {
    return `# RateLimiter

## Usage

- Create with \`new RateLimiter(maxRequests)\`.
- Call \`acquire()\` before making a request.
- Call \`release()\` after the request completes.
`;
  }
}

console.log(agentHelp(new RateLimiter()));
```

When `agentHelp()` exists, its returned Markdown is used verbatim.

## Functions and Bound Methods

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

Bound methods may lose original parameter names at runtime and fall back to
`arg0`, `arg1`, and so on.
