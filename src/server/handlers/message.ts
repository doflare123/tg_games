import { AppError } from '../../shared/errors.ts';
import { communications, gameBot } from '../platform/runtime.ts';
export default async function message(payload: unknown, context: unknown): Promise<void> {
  try {
    if (await communications.message(payload)) {
      await communications.sweep();
      return;
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    // An expected validation/rate-limit error must not cause webhook redelivery.
    console.warn('communication_message_rejected', error.message);
    return;
  }
  await gameBot.message(payload, context);
  try {
    await communications.sweep();
  } catch (error) {
    console.warn(
      'communication_sweep_deferred',
      error instanceof Error ? error.message : 'unknown',
    );
  }
}
