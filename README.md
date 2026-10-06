# pyatiletka

Fluxo de issues, marcos, PRs e CI para agentes (opencode), em Gitea e GitHub.

O plugin da ao agente 36 tools e tres hooks que resolvem o trabalho de manter
o quadro de issues em dia: vincular a sessao a uma issue, montar a fila de um
marco a partir das dependencias reais, esperar o CI depois de um `git push` e
recusar texto de prosa enrolada antes de gravar.

Suporta Gitea e GitHub com paridade: issues, marcos, dependencias, PRs, reviews,
CI, runners e protecao de branch.

## Instalacao

No `opencode.json`:

```json
{
  "plugin": ["pyatiletka"]
}
```

Com opcoes:

```json
{
  "plugin": [["pyatiletka", {}]]
}
```

## Configuracao

Tudo vem do ambiente. Nao ha arquivo de config e o plugin nao le `~/.config/tea`.

As quatro primeiras sao os nomes que os dois providers ja usam. O resto leva o
prefixo do pacote, que e o que evita colisao com variavel de outro programa
(`GITHUB_*`, por exemplo, ja vem populado dentro do GitHub Actions).

| Variavel | Para que serve |
|---|---|
| `GITEA_URL` | Base do Gitea, sem barra final. Ex.: `https://gitea.example.com` |
| `GITEA_TOKEN` | Token do Gitea |
| `GITHUB_TOKEN` | Token do GitHub |
| `GITHUB_API_URL` | Base da API. Default `https://api.github.com` |
| `PYATILETKA_PROVIDER` | `gitea` ou `github`. Sem isso o remote do clone decide |
| `PYATILETKA_ORG` | Org usada em `repo` sem owner, na varredura de org e nos runners |
| `PYATILETKA_DEFAULT_REPO` | Repo `owner/nome` para tools chamadas fora de um clone |
| `PYATILETKA_DEFAULT_BRANCH` | Branch usada por `ci_wait` e `ci_dispatch` quando o pedido nao informa |
| `PYATILETKA_LOGIN` | Seu login, para o filtro `mine` de `pr_list` |
| `PYATILETKA_PROMOTE_ORDER` | Ordem de `branch_promote`. Default `staging,production` |
| `PYATILETKA_PROSE` | `off`, `warn` ou `block`. Default `block` |

Provider: `PYATILETKA_PROVIDER` manda. Sem ele, o remote do clone decide, e por
ultimo o ambiente (`GITEA_URL` presente, senao `GITHUB_TOKEN`).

O plugin le o ambiente do processo do opencode, entao a variavel precisa estar
exportada no shell que launched opencode. O `opencode.json` nao tem campo `env`.

Exemplo minimo no shell:

```
export GITEA_URL=https://gitea.example.com
export GITEA_TOKEN=...
export PYATILETKA_ORG=minha-org
```

Para nao repetir isso a cada sessao, um arquivo fora do repo:

```bash
source ~/.config/pyatiletka/env && opencode
```

### Uma tool por provider

| Tool | Gitea | GitHub |
|---|---|---|
| `ci_logs` | exige o binario `tea` no PATH | usa REST, o zip e o `fflate` |
| `pr_merge` com `style: fast-forward-only` | modo nativo | vira `rebase`, que e o mais proximo |
| `ci_runners` | lista da org | lista da org |

## Convencoes

O plugin e opinativo nestas quatro familias de label. A tool le, nao cria: os
nomes precisam existir no repo.

| Prefixo | Valores | Para que serve |
|---|---|---|
| `Status/` | `Todo`, `In Progress`, `Need More Info`, `Blocked` | estado logico da issue |
| `Priority/` | `Critical`, `High`, `Medium`, `Low` | ordem da fila e da proxima sugerida |
| `Kind/` | livre | tipo do trabalho |
| `Area/` | livre | onde o trabalho acontece |

`Status/Blocked` tem precedencia sobre `Status/In Progress`, e
`issue_update` trata a familia `Status/` como exclusiva: adicionar um `Status/`
novo substitui o anterior.

Dependencias vao pela secao de dependencias da API do forge, a mesma da UI, via
`issue_depend`. `milestone_view` le essa secao para montar a fila. Escrever
dependencia como texto no corpo nao cria aresta.

## Template de issue

A UI do forge so injeta o template quando a issue nasce por ela. Como aqui toda
issue nasce por `issue_create`, o plugin le o mesmo arquivo do repo. Os dois
caminhos valem:

- `.gitea/issue_template/<nome>.md`
- `.github/ISSUE_TEMPLATE/<nome>.md`

O frontmatter e o que a UI usa:

```markdown
---
title: "[Task] "
about: Tarefa com criterio de aceite
labels: [Kind/Task, Priority/Medium]
---

## Objetivo

## Criterio de aceite

## Contexto

## Depende de
```

`issue_template_list` mostra o que existe. `issue_create` com `template` monta
o corpo a partir de `objetivo`, `criterios` e `contexto`, aplica o prefixo do
titulo e as labels do frontmatter.

## Checagem de prosa

Todo texto que o agente grava passa por `assertProse` (`src/prose`). No modo
`block`, o texto nao e gravado e a tool explica o que recusou.

Duas camadas:

- **Regras de casa e frases sem uso literal possivel. Bloqueiam.** Travessao em
  prosa, ponto e virgula, ponto medio como separador, e as formulas de
  "vale notar" a "em conclusao", em pt-BR e em ingles.
- **Termo de julgamento. Vira aviso.** A lista canonica da skill unsloppify
  (MIT, ver `THIRD_PARTY_LICENSES/unsloppify-LICENSE`) esta embutida em
  `src/prose/phrases.json`. Sao avisos porque a palavra pode ser o termo exato
  do caso.

Trechos em code span, bloco de codigo, URL e aspas ficam de fora: material
citado e identificador literal nao sao reescritos. Nome existente com
travessao continua citavel dentro de crase.

**Titulos nao passam pelo gate.** A convencao de travessao em titulo de marco e
titulo de issue vale, entao o titulo vai como veio.

Para desligar ou deixar so avisar:

```
export PYATILETKA_PROSE=warn
export PYATILETKA_PROSE=off
```

## Tools

### Issue e marco

| Tool | O que faz |
|---|---|
| `issue_bind` | vincula a sessao a uma issue. O contexto entra em todo turno |
| `issue_unbind` | desvincula |
| `issue_binding` | mostra a issue vinculada |
| `issue_view` | issue, dependencias e todos os comentarios |
| `issue_list` | lista com filtro de marco, estado logico, autor, assignee e datas |
| `issue_template_list` | templates de issue do repo |
| `issue_create` | cria a issue, com template ou corpo literal |
| `issue_depend` | gerencia as dependencias nativas |
| `issue_comment` | comenta, com o gate de prosa |
| `issue_update` | titulo, corpo e labels, com transicao de status |
| `issue_close` | fecha, com comentario opcional |
| `issue_reopen` | reabre |
| `milestone_view` | estado do marco em uma chamada: contagem, BLOQUEIOS e proxima sugerida |
| `milestone_list` | marcos com contagem e progresso |
| `milestone_create` | cria marco, com o gate na descricao |
| `milestone_update` | muda titulo, descricao ou estado |

### Pull request

| Tool | O que faz |
|---|---|
| `pr_list` | PRs com o CI de cada um, em um repo ou na org |
| `pr_view` | detalhe, CI do head, conversa, reviews e comentarios inline |
| `pr_checks` | so o estado de CI do head |
| `pr_files` | arquivos alterados com adicoes e delecoes |
| `pr_diff` | diff cru, com filtro por caminho ou linha |
| `pr_comment` | comenta, com o gate de prosa |
| `pr_create` | abre PR |
| `pr_merge` | mergeia, com porta de CI verde |
| `pr_batch` | a mesma branch em varios repos, com sha e CI de cada um |

`pr_merge` recusa quando ha check em falha ou pendente, a nao ser que
`force: true`. Conflito de merge nao e contornavel por `force`: a porta existe
para o CI, nao para passar por cima de conflito.

### CI

| Tool | O que faz |
|---|---|
| `ci_runs` | execucoes de um repo, de varios ou da org |
| `ci_run` | detalhe de uma execucao, com o CI do commit |
| `ci_wait` | bloqueia ate o run terminar ou ate o timeout, e traz as linhas de erro |
| `ci_logs` | log do run, com `step`, `grep` e `tail` |
| `ci_config` | variaveis, nomes dos secrets e workflows disponiveis |
| `ci_dispatch` | dispara um workflow |
| `ci_runners` | runners da org, com estado e labels |

`ci_wait` sem `run` e sem `branch` e recusado. O plugin nao adivinha qual
execucao esperar: informe `PYATILETKA_DEFAULT_BRANCH` se quiser um padrao.

### Branch

| Tool | O que faz |
|---|---|
| `branch_protections` | branches e as regras do servidor em cada uma |
| `branch_compare` | se uma branch e ancestral da outra, quantos commits, e se ha PR aberto |
| `branch_promote` | promove `from` para as branches depois dele na ordem, sem force |
| `commit_list` | commits do clone local, com filtro de autor e datas |

`branch_promote` e `commit_list` usam o git local e precisam do clone no
workspace. As outras duas falam com o forge e funcionam sem clone.

A ordem de promocao vem de `PYATILETKA_PROMOTE_ORDER` e o padrao e
`staging,production`:

```
export PYATILETKA_PROMOTE_ORDER=develop,staging,production
```

Numa ordem, cada branch so sobe para as que vem depois dela. `branch_promote`
recusa promover para tras: para isso e PR.

## Hooks

**Contexto da issue vinculada.** A cada turno, o plugin injeta o titulo, o
estado, as labels, o corpo e todos os comentarios da issue vinculada, mais as
regras de trabalho enquanto o vinculo estiver ativo. Falha ao ler a issue vira
aviso no contexto, nao quebra o turno.

**Compaction.** O vinculo sobrevive a uma compactacao de sessao.

**Espera do push.** Depois de um `git push` de verdade, o hook espera o run do
CI terminar e devolve o veredito no mesmo turno, com as linhas de erro quando
falha. Push de teste (`--dry-run`) e com force ficam de fora, e repo sem
workflow configurado nao espera nada.

## Como o repo e resolvido

1. o argumento `repo` da tool
2. o repo da issue vinculada a sessao
3. `PYATILETKA_DEFAULT_REPO`
4. o remote do clone

Aceita `repo`, `owner/repo` e `repo` prefixado com `PYATILETKA_ORG`. `repos` com
lista ou glob (`api-*`) varre varios repos em uma chamada.

## Estado em disco

O vinculo de sessao fica em
`<worktree>/.opencode/.state/issue-sessions/<sessionID>.json`, dentro do que o
opencode ja ignora. Nao ha outro estado local.

## Desenvolvimento

```
mise run setup      # instala as dependencias
mise run test       # bun test
mise run lint       # eslint
mise run typecheck  # tsc --noEmit
mise run build      # bun build
mise run format     # prettier
```

O contrato `Forge`, em `src/providers/types.ts`, e a unica fronteira entre as
tools e as APIs. As tools nunca chamam HTTP direto: o que diverge entre Gitea e
GitHub (id contra number de marco, nome contra id de label, paginacao, formato
de log, corpo de dependencia) fica no provider.

`src/testing/fake-forge.ts` implementa `Forge` em memoria, para as tools serem
testadas sem rede. Nao entra no pacote.

## Licenca

MIT. Ver [LICENSE](LICENSE) e `THIRD_PARTY_LICENSES/` para a lista de phrases
da skill unsloppify, tambem MIT.