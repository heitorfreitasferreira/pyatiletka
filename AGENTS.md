# AGENTS.md

## Regras deste repo

- Texto em pt-BR no codigo, nas mensagens de tool e na documentacao.
- **Nunca** citar empresa, host interno, org interna, repo interno ou pessoas
  reais. Este repo e publico.
- Nunca commitar token, URL com credencial ou arquivo de estado local.
- Commit sempre com a identidade local do repo (o noreply configurado). Nunca
  mexer na config global do git da maquina.
- Antes de commitar: `mise run test && mise run lint && mise run typecheck`.
- Qualquer texto que uma tool for gravar passa pelo gate `src/prose`
  (`assertProse`). Travessao, ponto e virgula em prosa e frases de formula
  bloqueiam; termo tecnico do dominio vira aviso.
- Sem `package.json` com `scripts`: as tarefas ficam em `.mise/tasks`.

## Build & Test Commands

- **Build**: `mise run build` or `bun build ./src/index.ts --outdir dist --target bun`
- **Test**: `mise run test` or `bun test`
- **Single Test**: `bun test BackgroundTask.test.ts` (use file glob pattern)
- **Watch Mode**: `bun test --watch`
- **Lint**: `mise run lint` (eslint)
- **Fix Lint**: `mise run lint:fix` (eslint --fix)
- **Format**: `mise run format` (prettier)

## Code Style Guidelines

### Imports & Module System

- Use ES6 `import`/`export` syntax (module: "ESNext", type: "module")
- Group imports: external libraries first, then internal modules
- Imports internos sem extensao (`./config`), resolvidos pelo bundler

### Formatting (Prettier)

- **Single quotes** (`singleQuote: true`)
- **Line width**: 100 characters
- **Tab width**: 2 spaces
- **Trailing commas**: ES5 (no trailing commas in function parameters)
- **Semicolons**: enabled

### TypeScript & Naming

- **NeverNesters**: avoid deeply nested structures. Always exit early.
- **Strict mode**: enforced (`"strict": true`)
- **Classes**: PascalCase (e.g., `BackgroundTask`, `BackgroundTaskManager`)
- **Methods/properties**: camelCase
- **Status strings**: use union types (e.g., `'pending' | 'running' | 'completed' | 'failed' | 'cancelled'`)
- **Explicit types**: prefer explicit type annotations over inference
- **Return types**: optional (not required but recommended for public methods)

### Error Handling

- Check error type before accessing error properties: `error instanceof Error ? error.toString() : String(error)`
- Log errors with `[ERROR]` prefix for consistency
- Always provide error context when recording output

### Linting Rules

- `@typescript-eslint/no-explicit-any`: warn (avoid `any` type)
- `no-console`: error (minimize console logs)
- `prettier/prettier`: error (formatting violations are errors)

## Testing

- Framework: **bun test** (`bun:test`), rodado por `mise run test`
- Style: `describe` e `it` aninhados, com expectativas claras
- Assertion library: `expect()` do `bun:test`

## Memory

- Store temporary data in `.memory/` directory (gitignored)

## Project Context

- **Type**: plugin para opencode (ES Module para Bun)
- **Target**: Bun runtime, ES2021+
- **Purpose**: fluxo de issues, marcos, PRs e CI para agentes, em Gitea e GitHub

## Onde mexer

- `src/providers/types.ts`: o contrato `Forge`. Toda tool fala so com esta
  interface. O que diverge entre Gitea e GitHub fica em `src/providers/`.
- `src/core/`: funcoes puras. `format`, `template`, `milestone`, `binding` e
  `context` nao tocam rede nem disco, exceto `binding`.
- `src/tools/`: as tools e o hook de push. Recebem um `Ctx` pronto.
- `src/testing/`: `FakeForge` e fixtures. Nao entra no `dist`, porque
  `src/index.ts` nao importa.

Tool nova entra em um dos grupos existentes de `src/tools/` e vira item de
`TOOL_NAMES` em `src/index.ts`. O teste `TOOL_NAMES > batem com o que
createTools monta` falha se a lista e a montagem divergirem.
