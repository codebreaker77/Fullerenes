# Contributing

Thanks for contributing to Fullerenes.

## Setup

```bash
npm install
npm run build
```

## Useful commands

```bash
npm run build
npm run test
npm run lint
```

## Package structure

- `packages/core`
  parsing, graph storage, indexer, and query logic
- `packages/daemon`
  file watching and incremental reindexing
- `packages/cli`
  end-user CLI, MCP server, and agent file generation

## Guidelines

- keep the OSS repo focused on the local-first product
- avoid introducing hosted/cloud-specific code here
- preserve backward compatibility for CLI commands where possible
- prefer small, reviewable commits

## Before opening a PR

- run `npm run build`
- run `npm run test`
- run `npm run lint`
