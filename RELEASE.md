# Processo de release

O projeto usa Release Please e o Trusted Publishing do npm para publicar sem
token de longa duracao.

Dois canais:

- **Pre-release:** PR comum mergeado na `main` cria a versao `x.x.x-next.J`,
  publicada na tag `next` do npm, para teste.
- **Release estavel:** PR de release mergeado na `main` calcula a versao e
  publica na tag `latest`.

Tambem da para disparar release na mao:

- Tag no formato `v{semver}`, por exemplo `v1.2.3`
- Workflow `publish.yml` disparado pela aba Actions, com canal `latest` ou `next`

## Primeiro release

O primeiro release e manual, porque e ele que cria o pacote no npmjs.com e
habilita o Trusted Publishing para os proximos.

### Passos

1. Confira o `package.json`:
   - a versao esta em `0.0.1`?
   - o nome do pacote esta certo? Falta o scope?
   - as keywords estao certas?
   - o campo `repository` esta certo?
   - o campo `author` esta certo?

2. `npm login` para autenticar.

3. `mise run build` para gerar o pacote.

4. `mise run publish` para publicar a primeira versao. O prompt de 2FA aparece
   durante o comando.

5. No npmjs.com, nas configuracoes do pacote, adicione um trusted publisher para
   GitHub Actions:
   - **Organization or user**: seu usuario ou org do GitHub
   - **Repository**: o nome do repositorio
   - **Workflow filename**: `publish.yml`

6. [Restrinja o acesso do token](https://docs.npmjs.com/trusted-publishers#recommended-restrict-token-access-when-using-trusted-publishers).

## Como o release acontece

### Conventional Commits

O projeto segue [Conventional Commits](https://www.conventionalcommits.org/):

- `fix:` patch
- `feat:` minor
- `feat!:` ou `fix!:` breaking change

### Versao abaixo de 1.0

Enquanto a versao for `0.x.x`, breaking change sobe a **minor**.

### Fluxo

1. Push de commits na `main`
2. O Release Please:
   - analisa os commits
   - decide o incremento de versao
   - atualiza `package.json`
   - atualiza `CHANGELOG.md`
   - abre um PR de release
3. Revise e mergeie o PR do Release Please

### Exemplos de commit

- `fix: corrige o rastreamento da issue`
- `feat: adiciona suporte a marco por titulo`
- `feat!: muda o contrato de merge`
- `docs: melhora o README`
- `chore: atualiza dependencias`

## Recursos avancados do release

### Forcar uma versao

O rodape `Release-As` fixa a versao e pula a analise de conventional commit:

```bash
git commit --allow-empty -m "chore: release 2.0.0" -m "Release-As: 2.0.0"
```

O Release Please abre um PR para `2.0.0`, qualquer que seja o tipo dos commits.

### Atualizar outros arquivos no release

Se algum arquivo alem do `package.json` tem numero de versao, configure em
`release-please-config.json`:

```json
{
  "extra-files": ["src/version.ts", { "type": "yaml", "path": ".tool-versions", "jsonpath": "$.node" }]
}
```

Tipos suportados: generic (qualquer), json, yaml, xml e toml.

### Marcadores de versao em comentario

```javascript
// x-release-please-version
const VERSION = '1.0.0';
```

```markdown
<!-- x-release-please-start-version -->
- Current version: 1.0.0
<!-- x-release-please-end -->
```

Marcadores: `x-release-please-version`, `x-release-please-major`,
`x-release-please-minor`, `x-release-please-patch`.

## Nao faca

- Editar o PR do Release Please na mao
- Criar release do GitHub na mao
- Mexer no numero de versao direto

## Publicacao

### Trusted Publishing do npm

A autenticacao usa OIDC: cada publish recebe um token de vida curta, assinado
criptograficamente e preso ao workflow. Nao ha token de longa duracao para
gerenciar nem rotacionar, e as attestations de procedencia comprovam onde e
como o pacote foi construido.

Quando o PR de release e mergeado, o workflow:

1. compila o pacote
2. publica no npm com autenticacao OIDC
3. gera e anexa as attestations de procedencia
4. cria o release no GitHub

### Release na mao

```bash
git tag v1.2.3
git push origin v1.2.3
```

Use para hotfix fora do ciclo e quando quiser controlar a versao na mao.

Mais em [Trusted Publishing do npm](https://docs.npmjs.com/trusted-publishers).