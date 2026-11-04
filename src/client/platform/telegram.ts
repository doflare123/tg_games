interface CloudError {
  message: string;
  type?: string;
  parameters?: Record<string, unknown>;
}
export interface TelegramOrientation {
  isStarted: boolean;
  beta: number | null;
  gamma: number | null;
  start(
    params: { refresh_rate: number; need_absolute: boolean },
    callback: (started: boolean) => void,
  ): void;
  stop(): void;
}
export interface TelegramApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  Serverless?: {
    call(
      name: string,
      input: unknown,
      callback: (error: CloudError | null, result: unknown) => void,
    ): void;
  };
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  DeviceOrientation?: TelegramOrientation;
  onEvent?(event: string, handler: () => void): void;
  offEvent?(event: string, handler: () => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramApp };
  }
}
export const telegram = window.Telegram?.WebApp;
export const inTelegram = Boolean(telegram?.initData);
export function initializeTelegram(): void {
  if (!inTelegram) return;
  telegram?.ready();
  telegram?.expand();
  telegram?.disableVerticalSwipes?.();
}
