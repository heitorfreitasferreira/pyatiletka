# Changelog

## Unreleased

### Features

* suporte a opencode v1 e v2 no mesmo pacote, com o v2 registrando as tools por namespace
* opcoes do plugin no v2 via `plugins` do `opencode.json`, sobrepondo o ambiente
* vinculo de sessao no storage do v2, mantendo o arquivo no v1

### Code Refactoring

* tools em uma spec neutra, consumida por um adaptador v1 e um adaptador v2

### Build System

* `@opencode/plugin` entra como dependencia e fica external no bundle

## [2.0.1](https://github.com/heitorfreitasferreira/pyatiletka/compare/v2.0.0...v2.0.1) (2026-10-08)


### Bug Fixes

* expor entrypoint server no package.json ([6c59442](https://github.com/heitorfreitasferreira/pyatiletka/commit/6c5944235c5e84b11d6fac96a3cb680d14c7598e))

## [2.0.0](https://github.com/heitorfreitasferreira/pyatiletka/compare/v1.0.0...v2.0.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* `Config.provider` passa a ser opcional e `GitHost` ganha os metodos `getViewer` e `getRepo`.

### Features

* captura automatica de credencial e configuracao ([25bd55e](https://github.com/heitorfreitasferreira/pyatiletka/commit/25bd55e72de9fd3c21a58de9e596ff7254fd9fe7))
* suporte a opencode v1 e v2 no mesmo pacote ([73ca22f](https://github.com/heitorfreitasferreira/pyatiletka/commit/73ca22ff95f066fde025ec0bf37aff76d6a04843))


### Bug Fixes

* erro de proxy deixa de despejar HTML no output da tool ([453617f](https://github.com/heitorfreitasferreira/pyatiletka/commit/453617fc66a89fc5e5132ed860dd8be1b3a5c162))

## 1.0.0 (2026-10-07)


### ⚠ BREAKING CHANGES

* troca `Forge` por nomes sem marca
* prefixo das variaveis de ambiente passa a PYATILETKA_

### Features

* arquivos e diff de PR no contrato, e delete_branch no merge ([d981fbc](https://github.com/heitorfreitasferreira/pyatiletka/commit/d981fbc5537c484626ff8342b1218367642e9678))
* cliente HTTP, tipos normalizados e provider Gitea ([4f8817c](https://github.com/heitorfreitasferreira/pyatiletka/commit/4f8817c2c29747f765348e72c9306bb086c03d27))
* core de formatacao, template, marco, vinculo e contexto ([fb4d3c5](https://github.com/heitorfreitasferreira/pyatiletka/commit/fb4d3c59a4108c494e73af8442f2db7068b4d2e2))
* gate de prosa, config por env e resolucao de repo ([e80f392](https://github.com/heitorfreitasferreira/pyatiletka/commit/e80f392cab5df516a790fd71aa05dd7ce7217d16))
* ponto de entrada do plugin, com tools e os tres hooks ([8941292](https://github.com/heitorfreitasferreira/pyatiletka/commit/8941292b650dacca4c3632166f8caaa74247e046))
* provider GitHub por REST, com log de run via zip ([6eaf643](https://github.com/heitorfreitasferreira/pyatiletka/commit/6eaf643285795d705951bab5e23f52a4ec9b08ff))
* tools de branch, com a ordem de promocao configuravel ([e390c2b](https://github.com/heitorfreitasferreira/pyatiletka/commit/e390c2b71e6b45f6888eeefaf6271185d3ed0c3d))
* tools de issue e marco, e um Forge em memoria para testar ([83eb262](https://github.com/heitorfreitasferreira/pyatiletka/commit/83eb262bfa51aa9e914ee57310188f2eab83065b))
* tools de pipeline e a espera automatica depois do push ([e2c6b46](https://github.com/heitorfreitasferreira/pyatiletka/commit/e2c6b46738786e4e97544783130da42ed4736e3d))
* tools de pull request, com a porta de CI verde ([8058fed](https://github.com/heitorfreitasferreira/pyatiletka/commit/8058fed372bc73b0b0ad81930f34bc08a6fdce53))


### Bug Fixes

* artefato publicavel com declaracoes e versao ([58bbc90](https://github.com/heitorfreitasferreira/pyatiletka/commit/58bbc9061fd95d4c4e13154c1a9f3f05be8e3b0e))
* branch_promote cria a branch de destino, e compare nomeia a que falta ([355cbbe](https://github.com/heitorfreitasferreira/pyatiletka/commit/355cbbefbd23c90f87e1edfb3b83328ff437f98a))
* compare do Gitea 1.27 e ci_runners de conta de usuario ([251d7f6](https://github.com/heitorfreitasferreira/pyatiletka/commit/251d7f6d9ded20a4df86000b29e4d949536eb2b9))


### Code Refactoring

* prefixo das variaveis de ambiente passa a PYATILETKA_ ([a92ad81](https://github.com/heitorfreitasferreira/pyatiletka/commit/a92ad8110a7017fbe45f7886ee37d84dc93783be))
* troca `Forge` por nomes sem marca ([05dd9f7](https://github.com/heitorfreitasferreira/pyatiletka/commit/05dd9f786830684ff53b26833c501f883804653a))

## Changelog

All notable changes to this project will be documented here by Release Please.
