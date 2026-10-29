---
name: pyatiletka
description: Fluxo de issue, marco, PR e CI em Gitea e GitHub. Use ao comecar ou continuar uma issue, ao montar a fila de um marco, ao abrir ou mergear um PR e ao acompanhar o CI depois de um push. Traz as regras de vinculo, de comentario de progresso e de prosa que o provider nao impoe.
---

# pyatiletka

As tools vem do servidor MCP `pyatiletka`. No Claude Code cada uma aparece como
`mcp__plugin_pyatiletka_pyatiletka__<nome>`, por exemplo
`mcp__plugin_pyatiletka_pyatiletka__issue_bind`. O prefixo muda quando o servidor
vem do seu proprio `.mcp.json`, fora do plugin.

## Vinculo da issue

`issue_bind` liga a sessao a uma issue. Depois disso, todo turno recebe o corpo
e os comentarios da issue, e os comentarios sao o log de trabalho: leia antes de
agir.

- Chame `issue_bind` ao comecar ou ao retomar trabalho.
- O vinculo vale para a **sessao**. Outras sessoes no mesmo projeto tem o
  proprio vinculo. `/clear` nao desfaz.
- `issue_binding` mostra o vinculo atual e `issue_unbind` limpa.
- Ao trocar de issue, chame `issue_bind` de novo: o vinculo anterior e
  substituido.

## Trabalho dentro da issue

1. Marque `Status/In Progress` com `issue_update` ao comecar.
2. Trabalhe dentro do escopo e do criterio de aceite. Nao amplie o escopo.
3. Registre progresso com `issue_comment`, em blocos `## Update YYYY-MM-DD`. Nao
   narre o mesmo trabalho duas vezes.
4. Trave o trabalho com `Status/Blocked`, comente o motivo e pergunte ao usuario.
5. Feche com `issue_close` so quando o criterio de aceite estiver verificado.
6. Pendencias descobertas viram `issue_create` no mesmo marco, nao texto solto.

## Fila do marco

`milestone_view` traz as issues do marco e a fila de dependencias, com o que ja
pode comecar. A ordem sai de `issue_depend`, que grava a dependencia na API.

Dependencia escrita como texto no corpo nao entra na fila. Use `issue_depend`.

## Pull request e CI

- `pr_create` abre o PR. A descricao passa pelo gate de prosa.
- `pr_checks` diz se o head esta verde e funciona como porta antes do merge.
- `pr_merge` recusa CI vermelho, salvo com `force: true`.
- Depois de um `git push`, o hook espera o CI e devolve o veredito no mesmo
  turno. Nao faca `sleep` em loop.
- `ci_wait` bloqueia dentro da chamada quando voce precisa esperar uma execucao
  especifica. `ci_logs` traz as linhas de erro, e `ci_runners` explica um run que
  nao sai de `queued`.

## Prosa

Titulo e corpo de issue, comentario e descricao de PR passam pelo gate de prosa.
Ele recusa travessao, ponto e virgula em prosa e frase de formula, como "nao e
apenas X, e Y". Escreva direto e no fato. `PYATILETKA_PROSE` aceita `off`, `warn`
e `block`, e o default e `block`.

## Credencial

`auth_status` diz de onde veio o token (ambiente, `.env`, `gh` ou `tea`) e o que
falta. `auth_login` diz o comando exato para rodar no terminal. O plugin nao
guarda segredo.
