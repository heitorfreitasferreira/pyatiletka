# Contribuindo

Obrigado pelo interesse em contribuir.

## Relatando problemas

- Procure problemas ja abertos antes de abrir um novo
- Inclua passos para reproduzir, o que era esperado e o que aconteceu
- Em bug, inclua o ambiente: versao do Bun, sistema operacional

> **Nota:** problemas sem atividade ha 60 dias podem ser marcados como
> obsoletos e fechados depois de 7 dias. Reabra se ainda fizer sentido.

## Enviando mudancas

1. Faça fork do repositorio
2. Crie uma branch de feature (`git checkout -b feat/minha-feature`)
3. Faça as mudancas
4. Rode os testes e o lint:
   ```bash
   mise run test
   mise run lint
   mise run typecheck
   ```
5. Commite no formato [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: adiciona funcionalidade`
   - `fix: corrige bug`
   - `docs: atualiza o readme`
   - `chore: atualiza dependencias`
6. Push e abra um pull request

## Pull requests

- O titulo do PR segue Conventional Commits, o que o CI exige
- Um PR resolve uma coisa so
- Funcionalidade nova vem com teste
- Todos os checks passam antes do review

## Estilo de codigo

ESLint e Prettier. `bun x eslint . --ext .ts --fix` corrige o que da.

As regras do repo estao em [AGENTS.md](./AGENTS.md).

Antes de commitar:

```
mise run test && mise run lint && mise run typecheck
```

O contrato das tools esta em `src/providers/types.ts`. Tool nova fala so com a
interface `GitHost` e nunca com a API direto. O que diverge entre Gitea e GitHub
fica no provider.