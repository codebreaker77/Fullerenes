# fullerenes

The Fullerenes OSS CLI builds a local knowledge graph of your codebase and exposes it through a CLI, generated agent files, and an MCP server.

## Install

```bash
npm install -g fullerenes
```

Or run without installing:

```bash
npx fullerenes init
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
