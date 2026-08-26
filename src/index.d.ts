import type { Context } from '@deepseek-ai/cordis';
import type { Schema } from '@deepseek-ai/schemastery';

/** Plugin config: `stateFile` overrides the default $DSH_HOME/tool-visibility.json. */
export interface Config {
  stateFile?: string;
}

export const name: 'dsh-tool-visibility';
export const inject: ['tools'];
export const Config: Schema<Config>;
export function apply(ctx: Context, config: Config): Promise<void>;
