# fullerenes

The Fullerenes OSS CLI builds a local knowledge graph of your codebase and exposes it through a CLI, generated agent files, and an MCP server.

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

## License

MIT
