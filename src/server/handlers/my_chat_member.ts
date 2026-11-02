import { admin, gameBot } from '../platform/runtime.ts';
export default async function member(payload: unknown): Promise<void> {
  await admin.observeGroup(payload);
  await gameBot.botMembership(payload);
}
