interface CloudError {
  message: string;
  type?: string;
  parameters?: Record<string, unknown>;
}
interface TelegramApp {
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
