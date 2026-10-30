export class TetrisAudio {
  private context: AudioContext | undefined;
  enabled = true;
  unlock(): void {
    this.context ??= new AudioContext();
    void this.context.resume().catch(() => {});
  }
  play(kind: 'drop' | 'clear' | 'end'): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const context = this.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(
      kind === 'clear' ? 660 : kind === 'end' ? 110 : 180,
      context.currentTime,
    );
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.1);
  }
  dispose(): void {
    void this.context?.close().catch(() => {});
  }
}
