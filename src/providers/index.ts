import type { Config } from '../config';
import { GiteaForge } from './gitea';
import { GitHubForge } from './github';
import type { Forge } from './types';

export function createForge(config: Config): Forge {
  return config.provider === 'gitea' ? new GiteaForge(config) : new GitHubForge(config);
}

export type { Forge } from './types';
export * from './types';
