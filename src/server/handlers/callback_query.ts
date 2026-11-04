import { communications } from '../platform/runtime.ts';
export default async function callback(payload: unknown): Promise<void> {
  await communications.callback(payload);
  await communications.sweep();
}
