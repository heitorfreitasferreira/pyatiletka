import { ConfigError, type AuthSource, type Config, type ProviderName } from '../config';
import { defaultRunner, detectProviderFromCli, ghToken, teaToken, type Runner } from './cli';

/**
 * Resolve a credencial por provider na ordem pedida: ambiente e `.env` primeiro,
 * depois o login de uma CLI ja autenticada (`gh`, `tea`). O login por navegador
 * e trabalho futuro para o GitHub e, no Gitea, passa pelo proprio `tea`.
 *
 * O ambiente real vence o `.env`, e os dois vencem a CLI: quem exportou um token
 * quer aquele token, nao um login antigo do `gh`.
 */

export type AuthMode = 'auto' | 'env' | 'cli';

export type AuthResult = { token: string; source: AuthSource };

/** Escotilha deterministica. `auto` e o padrao. */
export function readAuthMode(env: NodeJS.ProcessEnv): AuthMode {
  const raw = (env.PYATILETKA_AUTH ?? 'auto').trim().toLowerCase();
  if (raw === 'auto' || raw === 'env' || raw === 'cli') return raw;
  throw new ConfigError(
    `PYATILETKA_AUTH invalido: "${env.PYATILETKA_AUTH}". Use auto, env ou cli.`
  );
}

/** Nomes de variavel aceitos por provider, na ordem de precedencia. */
export function credentialEnvKeys(provider: ProviderName): string[] {
  return provider === 'github' ? ['GITHUB_TOKEN', 'GH_TOKEN'] : ['GITEA_TOKEN'];
}

export type ResolveAuthInput = {
  provider: ProviderName;
  host: string;
  /** Ambiente real do processo. Vence o arquivo. */
  env: NodeJS.ProcessEnv;
  /** O que veio do `.env`. */
  fileEnv: Record<string, string>;
  run?: Runner;
  mode?: AuthMode;
};

export function resolveAuth(input: ResolveAuthInput): AuthResult {
  const { provider, host, env, fileEnv, run = defaultRunner } = input;
  const mode = input.mode ?? readAuthMode(env);

  if (mode !== 'cli') {
    const keys = credentialEnvKeys(provider);
    // Todos os nomes do ambiente antes de qualquer nome do arquivo, senao um
    // `GITHUB_TOKEN` no `.env` venceria um `GH_TOKEN` exportado.
    for (const key of keys) {
      const fromEnv = env[key]?.trim();
      if (fromEnv) return { token: fromEnv, source: 'env' };
    }
    for (const key of keys) {
      const fromFile = fileEnv[key]?.trim();
      if (fromFile) return { token: fromFile, source: 'dotenv' };
    }
  }

  if (mode !== 'env') {
    const token = provider === 'github' ? ghToken(host, run) : teaToken(host, run, env);
    if (token) return { token, source: provider === 'github' ? 'gh' : 'tea' };
  }

  return { token: '', source: 'none' };
}

/** Provider a partir das CLIs logadas. `undefined` quando nenhuma ou ambas. */
export { defaultRunner, detectProviderFromCli };
export type { Runner };

export { loadDotenv } from './dotenv';
export type { DotenvLayers } from './dotenv';

/** Mensagem acionavel para quando nenhuma origem de credencial respondeu. */
export function missingCredentialMessage(config: Pick<Config, 'provider' | 'host'>): string {
  if (!config.provider) {
    return [
      'Nenhum provider configurado e nenhuma credencial encontrada.',
      'Rode dentro de um clone com remote, defina PYATILETKA_PROVIDER, ou faca login no gh (GitHub) ou no tea (Gitea).',
    ].join(' ');
  }
  const key = config.provider === 'github' ? 'GITHUB_TOKEN' : 'GITEA_TOKEN';
  const command =
    config.provider === 'github'
      ? `gh auth login --hostname ${config.host} --web`
      : `tea login add --url https://${config.host}`;
  return [
    `Sem credencial para ${config.provider} em ${config.host}.`,
    `Defina ${key} no ambiente ou num .env, rode "${command}" no terminal, ou chame a tool auth_login.`,
  ].join(' ');
}
