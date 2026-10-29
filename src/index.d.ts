import type { Context } from '@deepseek-ai/cordis';

/** Plugin config (optional; the host entry performs no static @deepseek-ai imports). */
export interface Config {
  /** Absolute path of the JSON state file. Default: $DSH_HOME/tool-visibility.json. */
  stateFile?: string;
  /**
   * Absolute path of the tool usage statistics file. Defaults to
   * `tool-visibility-stats.json` next to `stateFile` (so resetting the filter
   * configuration never wipes the cross-session counters).
   */
  usageFile?: string;
}

export const name: 'dsh-tool-visibility';
export const inject: ['tools', 'systemPrompt'];
export function apply(ctx: Context, config?: Partial<Config>): Promise<void>;
