# Publishing Fullerenes OSS

This repo is prepared for publishing three npm packages:

1. `@fullerenes/core`
2. `fullerenes-daemon`
3. `fullerenes`

## Before first publish

1. Create the dedicated GitHub repo for this OSS package set.
2. If the final repository URL is not `https://github.com/codebreaker77/Fullerenes.git`, update the `repository` field in:
   - `packages/core/package.json`
   - `packages/daemon/package.json`
   - `packages/cli/package.json`
3. Install dependencies:

```bash
npm install
```

4. Build everything:

```bash
npm run build
```

5. Optional but recommended: create local tarballs to inspect what will be published:

```bash
npm run pack:all
```

## Authenticate with npm

```bash
npm login
```

If you use org-scoped access controls, make sure your npm account has permission to publish `@fullerenes/core`.

## First publish order

Publish in this order so workspace dependencies resolve correctly on npm:

```bash
npm publish --workspace @fullerenes/core --access public
npm publish --workspace fullerenes-daemon --access public
npm publish --workspace fullerenes --access public
```

## Versioning future releases

For a patch release:

```bash
npm version patch --workspace @fullerenes/core
npm version patch --workspace fullerenes-daemon
npm version patch --workspace fullerenes
```

Then rebuild and publish in the same order:

```bash
npm run build
npm publish --workspace @fullerenes/core --access public
npm publish --workspace fullerenes-daemon --access public
npm publish --workspace fullerenes --access public
```

## Suggested release checklist

- `npm install`
- `npm run build`
- `npm run pack:all`
- verify generated tarballs
- `npm login`
- publish `@fullerenes/core`
- publish `fullerenes-daemon`
- publish `fullerenes`
- test:
  - `npx fullerenes init`
  - `npx fullerenes query "..."`
  - `npx fullerenes mcp`
