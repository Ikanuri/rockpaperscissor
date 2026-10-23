import { handleMessage } from '../../handlers/message';
import { adminCommand } from '../admin';
import { env, run } from '../runtime';

export default async function (message: any) {
  return run(async (ctx) => {
    const admin = await adminCommand(message, env);
    if (admin !== undefined) return admin;
    await handleMessage(message, env, ctx);
    return undefined;
  });
}
