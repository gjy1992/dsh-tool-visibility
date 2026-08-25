import type { Context } from '@deepseek-ai/cordis';

/** Browser half: registers the Settings → 工具注入控制 page. */
export const name: 'dsh-tool-visibility-client';
export const inject: ['slots', 'connection'];
export function apply(ctx: Context): void;
