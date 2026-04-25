# Fullerenes

Persistent memory for AI coding agents.

Fullerenes turns a source tree into a local knowledge graph that agents can query instead of repeatedly rebuilding context from raw files. It is built for developers who want better agent context, lower token usage, and a cleaner handoff between sessions.

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

## Install

After the npm packages are published:

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

The query command reads from the local graph instead of shoving raw files into context.

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
- `get_stats`
- `get_subgraph`

### 4. Keep the graph fresh during development

```bash
npx fullerenes watch
```

Watch mode listens for file changes, runs incremental reindexing, and refreshes generated agent files when the graph changes enough to matter.

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
