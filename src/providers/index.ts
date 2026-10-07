import type { Config } from '../config';
import { GiteaHost } from './gitea';
import { GitHubHost } from './github';
import type { GitHost } from './types';

export function createGitHost(config: Config): GitHost {
  return config.provider === 'gitea' ? new GiteaHost(config) : new GitHubHost(config);
}

export type { GitHost } from './types';
export * from './types';
