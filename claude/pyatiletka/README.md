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

`issue_bind` vale para a sessao. Com o plugin instalado, o arquivo fica em
`$CLAUDE_PLUGIN_DATA/state/<projeto>/<sessao>.json`, onde `<projeto>` e o
caminho do projeto com `/` trocado por `-` e `<sessao>` e o id da sessao do
Claude Code. Varias janelas no mesmo projeto, no terminal ou no editor, tem
vinculos separados. `--resume` mantem o id, entao a sessao retomada volta com o
vinculo.

O `/clear` troca de sessao sem reiniciar o servidor MCP, e o `tools/call` nao
diz qual e a sessao nova. Por isso o hook grava `proc-<CLAUDE_PID>.json` com a
sessao atual, e o servidor sobe pelos processos pais ate achar esse arquivo. No
`/clear` o hook copia o vinculo da sessao anterior para a nova, entao o `/clear`
nao desfaz o vinculo.

Sem esse arquivo o servidor usa o `CLAUDE_CODE_SESSION_ID` do proprio ambiente.
Sem a variavel, o vinculo volta a ser do projeto, em `workspace.json`.

Sem o plugin, o arquivo fica em
`<projeto>/.claude/.state/pyatiletka/<sessao>.json`. Ponha `.claude/.state` no
`.gitignore` do projeto, ou aponte `PYATILETKA_STATE_DIR` para um caminho
absoluto fora do clone.

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
