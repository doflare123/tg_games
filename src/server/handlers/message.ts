import { gameBot } from '../platform/runtime.ts';
export default async function message(payload: unknown, context: unknown): Promise<void> {
  await gameBot.message(payload, context);
}
