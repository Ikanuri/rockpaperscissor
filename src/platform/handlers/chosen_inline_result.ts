import { handleChosenInlineResult } from '../../handlers/inline';
import { env, run } from '../runtime';

export default async function (result: any) {
  return run(async (ctx) => { await handleChosenInlineResult(result, env, ctx); });
}
