# Fullerenes

<img width="676" height="369" alt="df746978-b1d8-4a09-927b-ebf8c58a0f89-removebg-preview" src="https://github.com/user-attachments/assets/ff0f995a-4b76-41fa-83e0-ae24c8599607" />


Persistent memory for AI coding agents.

Fullerenes turns a source tree into a local knowledge graph that agents can query instead of repeatedly rebuilding context from raw files. It is a navigation and impact-analysis layer for AI coding agents: show the right code, the right callers, the right entry points, and the likely blast radius before editing.

## What ships in this OSS repo

- `fullerenes`
  Local-first CLI, MCP server, and agent-context file generation
- `fullerenes-core`
  Parser engine, SQLite graph storage, incremental indexer, and query layer
- `fullerenes-daemon`
  File watcher and auto-reindex daemon

## What this OSS repo is for

This repository is the local-first open-source product:
- index a repo into `.fullerenes/graph.db`
- query the graph with a token budget
- generate `CLAUDE.md`, `AGENTS.md`, and Cursor rules
- expose the graph through MCP for agent tooling
- estimate impact before changing a function
- keep the graph fresh with watch mode

## What is not included here

This repo intentionally excludes the hosted product layer:
- cloud sync
- web dashboard
- billing
- hosted team and org management
- SaaS auth flows

## Supported languages

- TypeScript / JavaScript
- Python
- Rust
- Go
- Java

## Why use it

Agents are good at editing code once they know where to look. They are bad at rebuilding a large repo map from raw files every session.

Fullerenes helps by answering questions like:
- what are the entry points for this codebase
- where is the main implementation of a function
- who calls this function
- what else will likely break if I change this signature
- what are the smallest relevant files to read next

## Benchmark

Local benchmark on this repository using Fullerenes output vs concatenating the full source files touched by the returned subgraph:

| Scenario | Estimated tokens |
| --- | ---: |
| Raw file context | 2452 |
| Fullerenes query result | 137 |
| Reduction | 94.4% fewer tokens |

Methodology note:
- token estimate uses the project heuristic `1 token ~= 4 characters`
- benchmark questions were run against this repo's local graph

## Positioning

Fullerenes is not a full code-reading agent by itself. It is the layer that gets an agent to the right code fast, with enough surrounding context to make the next tool call smaller and smarter.

That makes it especially useful when you want:
- better agent navigation
- lower token usage
- cleaner handoff between sessions
- quick caller and impact inspection before making changes

## Install

```bash
npm install -g fullerenes
```

Or run it without a global install:

```bash
npx fullerenes init
```

If you are working from source in this repo:

```bash
npm install
npm run build
node packages/cli/dist/cli.js init .
```

## Using Fullerenes

### 1. Index a repository

Run Fullerenes at the root of a project:

```bash
npx fullerenes init
```

This creates:
- `.fullerenes/graph.db`
- `CLAUDE.md`
- `AGENTS.md`
- `.cursor/rules/fullerenes.mdc`

`CLAUDE.md` and `AGENTS.md` preserve user-written instructions outside the managed Fullerenes block.

### 2. Ask questions about the codebase

```bash
npx fullerenes query "how does authentication work"
npx fullerenes query "where is the main entry point" --budget 1200
npx fullerenes stats
```

The query command returns a structured answer with entry points, core nodes, callers, signatures, and related files.

### 3. Connect an agent over MCP

Start the local MCP server:

```bash
npx fullerenes mcp
```

For Claude Code, add it like this:

```bash
claude mcp add fullerenes -- npx fullerenes mcp
```

Once connected, the agent can use tools like:
- `query_codebase`
- `get_function`
- `find_entry_points`
- `get_file_context`
- `search_code`
- `get_callers`
- `predict_impact`
- `get_stats`
- `get_subgraph`

`get_function` also supports `includeBody: true`, so an agent can fetch the implementation body in the same tool call when it needs it.

### 4. Keep the graph fresh during development

```bash
npx fullerenes watch
```

Watch mode listens for file changes, runs incremental reindexing, and refreshes generated agent files when the graph changes enough to matter.

## Example MCP workflows

```text
get_function({ name: "resetCache", includeBody: true })
predict_impact({ functionName: "resetCache" })
query_codebase({ question: "how does indexing flow work", maxTokens: 1600 })
```

## Comparison

| Capability | Fullerenes OSS | Raw file prompting | Generic graph tooling |
| --- | --- | --- | --- |
| Works offline | Yes | Yes | Varies |
| Zero hosted infra required | Yes | Yes | Varies |
| Token-budgeted query output | Yes | No | Rare |
| MCP server for agents | Yes | No | Varies |
| Caller and impact inspection | Yes | No | Varies |
| Local SQLite graph | Yes | No | Varies |

## Core CLI commands

- `fullerenes init [path]`
- `fullerenes index [path]`
- `fullerenes query "<question>" [--budget <tokens>] [--json]`
- `fullerenes stats [path]`
- `fullerenes mcp [path]`
- `fullerenes watch [path]`

## Repository layout

```text
Fullerenes/
|- packages/
|  |- cli/
|  |- core/
|  `- daemon/
|- package.json
|- turbo.json
`- tsconfig.base.json
```

## Development

```bash
npm install
npm run build
npm run test
npm run lint
```

## Publish readiness

This repo is prepared to publish:

1. `fullerenes-core`
2. `fullerenes-daemon`
3. `fullerenes`

Publishing order matters because the CLI depends on the other two packages. Full release steps are documented in [PUBLISHING.md](./PUBLISHING.md).

## Contributing

Contribution notes are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
