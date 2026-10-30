import { gameBot } from '../platform/runtime.ts';
export default async function member(payload: unknown): Promise<void> {
  await gameBot.membership(payload);
}
