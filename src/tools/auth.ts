import { tool } from '@opencode-ai/plugin';
import { credentialEnvKeys, defaultRunner, missingCredentialMessage } from '../auth';
import type { Ctx } from '../core/context';
import { toolSpecs, type ToolSpec } from './spec';

/**
 * Tools de credencial. `auth_status` diz de onde veio o token e o que falta.
 * `auth_login` devolve o comando de login para o usuario rodar no terminal: o
 * `gh` abre o navegador, o `tea` cria um login. O plugin nao guarda segredo.
 */

const SOURCE_LABEL: Record<string, string> = {
  env: 'variavel de ambiente',
  dotenv: 'arquivo .env',
  gh: 'login do gh',
  tea: 'login do tea',
  none: 'nenhuma',
};

export function authTools({ ctx }: { ctx: Ctx }): ToolSpec[] {
  const run = ctx.run ?? defaultRunner;

  return toolSpecs({
    auth_status: tool({
      description:
        'Mostra a origem da credencial do provider atual (ambiente, .env, gh, tea) e, se faltar, o que fazer. Use quando uma chamada falhar por falta de acesso.',
      args: {},
      async execute() {
        const c = ctx.config;
        const lines = [
          `provider: ${c.provider ?? 'nao resolvido'}`,
          `host: ${c.host}`,
          `api: ${c.baseUrl || '(sem base)'}`,
          `credencial: ${SOURCE_LABEL[c.authSource ?? 'none'] ?? c.authSource}`,
        ];
        if (c.org) lines.push(`org: ${c.org}`);
        if (c.defaultRepo) lines.push(`repo padrao: ${c.defaultRepo}`);
        if (c.defaultBranch) lines.push(`branch padrao: ${c.defaultBranch}`);
        if (!c.token) {
          lines.push('', missingCredentialMessage(c));
        } else if (c.provider) {
          const keys = credentialEnvKeys(c.provider).join(', ');
          lines.push(`  variaveis aceitas: ${keys}`);
        }
        lines.push('', 'Ordem de resolucao: ambiente e .env, depois gh/tea, depois login manual.');
        return lines.join('\n');
      },
    }),

    auth_login: tool({
      description:
        'Explica como obter a credencial do provider atual: o comando de login no terminal (gh abre o navegador, tea cria um login) ou a variavel de ambiente. Use quando `auth_status` mostrar que falta credencial.',
      args: {},
      async execute() {
        const c = ctx.config;

        if (!c.provider) {
          return [
            'Nao deu para saber o provider: sem remote no clone, sem PYATILETKA_PROVIDER e sem gh/tea logado.',
            '',
            'GitHub: defina GITHUB_TOKEN (ou rode `gh auth login --web`).',
            'Gitea:  defina GITEA_URL e GITEA_TOKEN (ou rode `tea login add`).',
            '',
            'Rodar dentro de um clone com remote tambem resolve.',
          ].join('\n');
        }

        const keys = credentialEnvKeys(c.provider);

        if (c.provider === 'github') {
          const gh = run('gh', ['--version']).status === 0;
          if (gh) {
            return [
              `O gh esta instalado. Rode no seu terminal:`,
              '',
              `  gh auth login --hostname ${c.host} --web`,
              '',
              'O gh abre o navegador para voce autorizar. Depois reinicie o opencode.',
            ].join('\n');
          }
          return [
            'O gh nao esta no PATH. Instale em https://cli.github.com, ou defina um token:',
            '',
            `  ${keys[0]}=<seu token>`,
            '',
            `No ambiente ou num .env. Token em https://github.com/settings/tokens.`,
          ].join('\n');
        }

        const tea = run('tea', ['--version']).status === 0;
        if (tea) {
          return [
            'O tea esta instalado. Rode no seu terminal:',
            '',
            `  tea login add --url ${c.baseUrl}`,
            '',
            'Informe um token de aplicacao do Gitea quando o tea pedir. Depois reinicie o opencode.',
          ].join('\n');
        }
        return [
          'O tea nao esta no PATH. Instale em https://gitea.com/gitea/tea, ou defina um token:',
          '',
          `  ${keys[0]}=<seu token>`,
          '',
          'No ambiente ou num .env. Gere o token em Configuracoes, Aplicacoes no seu Gitea.',
        ].join('\n');
      },
    }),
  });
}
