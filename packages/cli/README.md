# fullerenes

<p align="center">
  <img src="https://raw.githubusercontent.com/codebreaker77/Fullerenes/main/assets/readme/logo.png" alt="Fullerenes" width="360" />
</p>

<p align="center">
  Persistent local memory for AI coding agents.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/fullerenes"><img src="https://img.shields.io/npm/v/fullerenes?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/fullerenes"><img src="https://img.shields.io/npm/dm/fullerenes?color=2d7ff9&label=downloads" alt="npm downloads" /></a>
  <a href="https://github.com/codebreaker77/Fullerenes/stargazers"><img src="https://img.shields.io/github/stars/codebreaker77/Fullerenes?style=social" alt="GitHub stars" /></a>
  <a href="https://ko-fi.com/U7U31YJNBN"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support on Ko-fi" /></a>
</p>

Fullerenes builds a local knowledge graph of your codebase and exposes it through a CLI, generated agent files, and an MCP server. It is designed to help coding agents find the right code fast while using far fewer tokens than broad raw-file prompting.

## What's New

This release includes:
- fully local-first generated summaries with no external LLM dependency
- better natural-language retrieval and query expansion
- smaller, tighter graph-grounded query results
- improved generated `AGENTS.md` / `CLAUDE.md` guidance
- cleaned-up CLI and MCP version reporting

## Quick Demo

<p align="center">
  <img src="https://raw.githubusercontent.com/codebreaker77/Fullerenes/main/assets/readme/init.gif" alt="Fullerenes init demo" />
</p>

## Install

```bash
npm install -g fullerenes
```

Or run it without installing:

```bash
npx fullerenes init
```

## Typical Workflow

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
fullerenes mcp .
```

Keep the graph fresh while coding:

```bash
fullerenes watch .
```

## MCP Highlights

- `get_function({ name: "resetCache", includeBody: true })`
- `predict_impact({ functionName: "resetCache" })`
- `query_codebase({ question: "how does indexing work", maxTokens: 1600 })`

## Commands

```bash
fullerenes init
fullerenes index
fullerenes query "how does auth work"
fullerenes stats
fullerenes mcp .
fullerenes watch .
```

## What It Generates

- `CLAUDE.md`
- `AGENTS.md`
- `.cursor/rules/fullerenes.mdc`

## What It Exposes

- local graph database at `.fullerenes/graph.db`
- MCP server for agent integrations
- token-budgeted local graph queries
- caller-aware impact inspection

## Learn More

- GitHub repo: https://github.com/codebreaker77/Fullerenes
- npm package: https://www.npmjs.com/package/fullerenes

## License

MIT
