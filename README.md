# Fullerenes

Persistent memory for AI coding agents.

Fullerenes turns a source tree into a local knowledge graph that agents can query instead of repeatedly rebuilding context from raw files. It is built for developers who want better agent context, lower token usage, and a cleaner handoff between sessions.

## What ships in this OSS repo

- `fullerenes`
  Local-first CLI, MCP server, and agent-context file generation
- `@fullerenes/core`
  Parser engine, SQLite graph storage, incremental indexer, and query layer
- `fullerenes-daemon`
  File watcher and auto-reindex daemon

## What this OSS repo is for

This repository is the local-first open-source product:
- index a repo into `.fullerenes/graph.db`
- query the graph with a token budget
- generate `CLAUDE.md`, `AGENTS.md`, and Cursor rules
- expose the graph through MCP for agent tooling
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

## Quick start

```bash
npm install
npm run build
node packages/cli/dist/cli.js init .
```

After publishing, the normal user flow becomes:

```bash
npx fullerenes init
npx fullerenes query "how does authentication work"
npx fullerenes stats
npx fullerenes mcp
npx fullerenes watch
```

## Core CLI commands

- `fullerenes init [path]`
- `fullerenes index [path]`
- `fullerenes query "<question>" [--budget <tokens>] [--json]`
- `fullerenes stats [path]`
- `fullerenes mcp [path]`
- `fullerenes watch [path]`

## MCP tools

- `query_codebase`
- `get_function`
- `find_entry_points`
- `get_file_context`
- `search_code`
- `get_callers`
- `get_stats`
- `get_subgraph`

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

1. `@fullerenes/core`
2. `fullerenes-daemon`
3. `fullerenes`

Publishing order matters because the CLI depends on the other two packages. Full release steps are documented in [PUBLISHING.md](./PUBLISHING.md).

## Contributing

Contribution notes are in [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
