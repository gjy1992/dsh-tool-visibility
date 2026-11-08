import type { Context } from '@deepseek-ai/cordis';

/** Plugin config (optional; the host entry performs no static @deepseek-ai imports). */
export interface Config {
  /**
   * Absolute path of the JSON state file. Default: `<profile.dir>/tool-visibility.json`
   * inside a dsh-launched profile (so two profiles never share one file), and
   * `$DSH_HOME/tool-visibility.json` for a host without a `profileContext`.
   * A profile-scoped default adopts the legacy global file once on first start.
   */
  stateFile?: string;
  /**
   * Absolute path of the tool usage statistics file. Defaults to
   * `tool-visibility-stats.json` in the installation home (`$DSH_HOME`), so the
   * cross-session counters survive a profile switch; an explicit `stateFile`
   * puts it next to that file instead (so resetting the filter configuration
   * never wipes the counters).
   */
  usageFile?: string;
}

export const name: 'dsh-tool-visibility';
export const inject: ['tools', 'systemPrompt'];
export function apply(ctx: Context, config?: Partial<Config>): Promise<void>;
