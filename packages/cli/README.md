# fullerenes

The Fullerenes OSS CLI builds a local knowledge graph of your codebase and exposes it through a CLI, generated agent files, and an MCP server.

It is best thought of as a navigation and impact-analysis layer for AI coding agents: find the right function, see who calls it, fetch the implementation body, and estimate what might break before you edit it.

## Install

```bash
npm install -g fullerenes
```

Or run it without installing:

```bash
npx fullerenes init
```

## Typical workflow

Index a repository:

```bash
fullerenes init
```

Ask questions against the local graph:

```bash
fullerenes query "how does auth work"
fullerenes stats
```

Start the MCP server:

```bash
fullerenes mcp
```

Keep the graph up to date while coding:

```bash
fullerenes watch
```

## MCP highlights

- `get_function({ name: "resetCache", includeBody: true })`
- `predict_impact({ functionName: "resetCache" })`
- `query_codebase({ question: "how does indexing work", maxTokens: 1600 })`

## Commands

```bash
fullerenes init
fullerenes index
fullerenes query "how does auth work"
fullerenes stats
fullerenes mcp
fullerenes watch
```

## What it generates

- `CLAUDE.md`
- `AGENTS.md`
- `.cursor/rules/fullerenes.mdc`

## What it exposes

- local graph database at `.fullerenes/graph.db`
- MCP server for agent integrations
- token-budgeted local graph queries
- caller-aware impact inspection

## License

MIT
