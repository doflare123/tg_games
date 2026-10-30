export interface GameAdapter {
  pause(): void;
  resume(): void;
  dispose(): void;
}
export interface GameHost {
  container: HTMLElement;
  onClose(): void;
}
