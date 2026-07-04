# agent-readable-ts

[![CI](https://github.com/zydo/agent-readable-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/zydo/agent-readable-ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agent-readable-ts.svg)](https://www.npmjs.com/package/agent-readable-ts)

`agent-readable-ts` helps coding agents inspect the live public surface of a
TypeScript or JavaScript API before they write code against it.

Library authors can add agent-oriented usage rules next to a class, object, or
function. Consumers call `agentHelp(target)` or the `agent-readable-ts` CLI to get
compact Markdown with the real callable surface plus any author-supplied
behavioral notes.

To let your coding agent automatically call `agentHelp()` before using an
unfamiliar API, install the companion skill:

```sh
npx skills add zydo/skills --skill agent-readable
```

```ts
import { agentHelp } from "agent-readable-ts";

class Sensor {
  calibrate(offset: number): void {}
  read(): number {
    return 0;
  }

  agentNotes(): string {
    return "- Call `calibrate()` once during setup, before `read()`.";
  }
}

console.log(agentHelp(new Sensor()));
```

## Install

```sh
npm install agent-readable-ts
```

For one-off CLI use:

```sh
npx agent-readable-ts commander
npm exec -- agent-readable-ts commander:Command
pnpm dlx agent-readable-ts ./src/widget.ts:Widget
```

See [Getting Started](docs/getting-started.md) for full install and CLI usage.

## Documentation

- [Getting Started](docs/getting-started.md)
- [Why agent-readable-ts?](docs/why.md)
- [Examples](docs/examples.md)
- [Authoring Notes](docs/authoring.md)
- [FAQ](docs/faq.md)

## Other Languages

- **Python:** [agent-readable](https://github.com/zydo/agent-readable) provides
  the same idea for Python packages and classes.

## License

MIT
