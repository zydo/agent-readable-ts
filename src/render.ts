/**
 * Markdown renderer for the {@link HelpDoc} model.
 *
 * This is the only place that knows about Markdown syntax. Adding another
 * output format (plain text, HTML, JSON for MCP servers) means adding a sibling
 * renderer that consumes the same `model.ts` types — the introspection layer
 * stays untouched.
 */

import type { HelpDoc, HelpMember, HelpNote } from "./model.js";

/**
 * Render a {@link HelpDoc} as the structured Markdown `agentHelp()` returns.
 *
 * Sections are emitted in a fixed order and only when their data is present, so
 * a class (members), a plain object (members), and a function (signature) all
 * flow through the same path. A `null` `members` omits the Public API section;
 * an empty array renders it with `(none)`.
 */
export function renderMarkdown(doc: HelpDoc): string {
  const sections: string[] = [`# ${doc.title}`];

  if (doc.signature !== null) {
    sections.push(`## Signature\n\n\`\`\`ts\n${doc.signature}\n\`\`\``);
  }

  if (doc.members !== null) {
    sections.push(`## Public API\n\n${renderMembers(doc.members)}`);
  }

  sections.push(`## Agent usage rules\n\n${doc.usageRules.join("\n")}`);

  for (const note of doc.notes) {
    sections.push(renderNote(note));
  }

  return sections.join("\n\n") + "\n";
}

function renderMembers(members: HelpMember[]): string {
  if (members.length === 0) return "- (none)";
  return members
    .map((m) => `- \`${m.name}${m.signature ?? ""}\` ${m.kind}`)
    .join("\n");
}

function renderNote(note: HelpNote): string {
  let header = `## Notes from ${note.className}`;
  if (note.inherited.length > 0) {
    header += ` (extends ${note.inherited.join(", ")}; if notes conflict, these take precedence)`;
  }
  return `${header}\n\n${note.body}`;
}
