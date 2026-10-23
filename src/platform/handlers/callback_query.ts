import { handleCallbackQuery } from '../../handlers/callback';
import { env, run } from '../runtime';

export default async function (query: any) {
  return run(async (ctx) => { await handleCallbackQuery(query, env, ctx); });
}
