import type { ReplayEvent } from '../../../games/tetris/types.ts';
import type { ReplayInput, RunView } from '../../../shared/contracts.ts';
// A timed-out response may already have committed on the server. Keep the
// identical request until acknowledged instead of changing its end tick on retry.
export class ReplayUploader {
  private pending: ReplayInput | null = null;
  constructor(private readonly transport: (input: ReplayInput) => Promise<RunView>) {}
  reset(): void {
    this.pending = null;
  }
  async upload(run: RunView, untilTick: number, events: ReplayEvent[]): Promise<RunView> {
    this.pending ??= { runId: run.id, revision: run.revision, untilTick, events };
    const sent = this.pending;
    const result = await this.transport(sent);
    if (this.pending === sent) this.pending = null;
    return result;
  }
}
