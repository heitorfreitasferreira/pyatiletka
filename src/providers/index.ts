import { ConfigError, type Config } from '../config';
import { GiteaHost } from './gitea';
import { GitHubHost } from './github';
import type { GitHost } from './types';

export function createGitHost(config: Config): GitHost {
  if (config.provider === 'gitea') return new GiteaHost(config);
  if (config.provider === 'github') return new GitHubHost(config);
  throw new ConfigError('provider nao resolvido: sem credencial ou remote');
}

export type { GitHost } from './types';
export * from './types';
