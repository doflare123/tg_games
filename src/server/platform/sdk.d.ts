// Narrow ambient declarations for the documented platform surface used here.
// These are not the Node SDK: runtime modules are supplied by Telegram.
// Keep this boundary small and exercise SQL against real SQLite in tests.
declare module 'sdk' {
  export const db: import('./sql-repository.ts').SqlDatabase;
  export class EndpointError extends Error {
    constructor(message: string, parameters?: Record<string, unknown>);
  }
  export const api: {
    sendPhoto(input: {
      chat_id: number;
      photo: string;
      caption: string;
      reply_markup?: { inline_keyboard: import('../domain/telegram.ts').LaunchButton[][] };
    }): Promise<unknown>;
    sendVideo(input: {
      chat_id: number;
      video: string;
      caption: string;
      reply_markup?: { inline_keyboard: import('../domain/telegram.ts').LaunchButton[][] };
    }): Promise<unknown>;
    editMessageText(input: import('../domain/telegram.ts').EditMessage): Promise<unknown>;
    answerCallbackQuery(input: { callback_query_id: string; text?: string }): Promise<unknown>;
    getChatMember(input: { chat_id: number; user_id: number }): Promise<unknown>;
    setMyCommands(input: {
      commands: import('../domain/telegram.ts').TelegramCommand[];
      scope:
        | { type: 'all_group_chats' }
        | { type: 'all_private_chats' }
        | { type: 'chat'; chat_id: number };
    }): Promise<unknown>;
    getMe(): Promise<unknown>;
    getMyCommands(input: { scope: { type: 'all_group_chats' } }): Promise<unknown>;
    sendMessage(input: {
      ephemeral_message_parameters?: { receiver_user_id: number };
      reply_parameters?: { ephemeral_message_id: number };
      message_thread_id?: number;
      chat_id: number;
      text: string;
      reply_markup?: {
        inline_keyboard: import('../domain/telegram.ts').LaunchButton[][];
      };
    }): Promise<unknown>;
  };
}
declare module 'sdk/db' {
  interface Column {
    primaryKey(options?: { autoIncrement: boolean }): Column;
    notNull(): Column;
    default(value: string | number): Column;
  }
  interface Index {
    on(...columns: Column[]): Index;
  }
  export function integer(name: string): Column;
  export function text(name: string): Column;
  export function index(name: string): Index;
  export function table<T extends Record<string, Column>>(
    name: string,
    columns: T,
    extras?: (columns: T) => Record<string, Index>,
  ): T;
}
