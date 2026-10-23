import { handlePreCheckout } from '../../handlers/payment';
import { hasFeature } from '../../feature';
import { env, run } from '../runtime';

export default async function (query: any) {
  return run(async () => {
    if (hasFeature(env, 'donator')) await handlePreCheckout(query, env);
  });
}
