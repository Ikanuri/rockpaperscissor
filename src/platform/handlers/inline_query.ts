import { handleInlineQuery } from '../../handlers/inline';
import { env, run } from '../runtime';

export default async function (query: any) {
  return run(async () => { await handleInlineQuery(query, env); });
}
