import type { Context } from '@deepseek-ai/cordis';

/** Plugin config (optional; the host entry performs no static @deepseek-ai imports). */
export interface Config {
  /** Absolute path of the JSON state file. Default: $DSH_HOME/tool-visibility.json. */
  stateFile?: string;
}

export const name: 'dsh-tool-visibility';
export const inject: ['tools'];
export function apply(ctx: Context, config?: Partial<Config>): Promise<void>;
