# pyatiletka no Claude Code

Plugin que liga o Claude Code ao fluxo de issues, marcos, PRs e CI do
[pyatiletka](https://github.com/heitorfreitasferreira/pyatiletka), em Gitea e
GitHub.

## O que entra

- **Servidor MCP** com as 38 tools do pacote: `issue_bind`, `milestone_view`,
  `pr_merge`, `ci_wait` e o resto.
- **Tres hooks**: contexto do vinculo no inicio da sessao e a cada prompt, mais a
  espera do CI depois de um `git push`.
- **Skill** com as regras de fluxo que o provider nao impoe.

## Instalacao

```
/plugin install pyatiletka --marketplace heitorfreitasferreira/pyatiletka
```

Para usar um clone local, sem marketplace:

```
claude --plugin-dir ./claude/pyatiletka
```

O plugin chama `npx -y pyatiletka mcp` e `npx -y pyatiletka hook <evento>`, entao
precisa de `node` e `npm` no PATH.

## Vinculo

`issue_bind` vale para o projeto. O arquivo fica em
`<projeto>/.claude/.state/pyatiletka/workspace.json`.

Ponha `.claude/.state` no `.gitignore` do projeto, ou aponte
`PYATILETKA_STATE_DIR` para um caminho absoluto fora do clone.

## Nomes das tools

Um servidor MCP que vem de dentro de um plugin aparece como
`mcp__plugin_<plugin>_<servidor>__<tool>`. Aqui isso da
`mcp__plugin_pyatiletka_pyatiletka__issue_bind`.

Se voce declarar o servidor no seu proprio `.mcp.json`, o nome fica
`mcp__pyatiletka__issue_bind`. Nesse caso defina
`PYATILETKA_TOOL_PREFIX=mcp__pyatiletka__`, senao o texto que o agente le aponta
um nome que nao existe.

## Credencial

A mesma resolucao do pacote: ambiente e `.env`, depois um `gh` ou `tea` ja
logado, depois login manual. `auth_status` mostra a origem, `auth_login` mostra o
comando.

A documentacao completa, as variaveis de ambiente e as 38 tools estao no
[README do pacote](https://github.com/heitorfreitasferreira/pyatiletka#readme).
