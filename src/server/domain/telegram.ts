export interface TelegramMember {
  active: boolean;
  admin: boolean;
}
export interface TelegramCommand {
  command: string;
  description: string;
  is_ephemeral?: boolean;
}
export type LaunchButton = { text: string } & ({ url: string } | { web_app: { url: string } });
export interface SendMessage {
  chat_id: number;
  text: string;
  message_thread_id?: number;
  ephemeral_message_parameters?: { receiver_user_id: number };
  reply_parameters?: { ephemeral_message_id: number };
  reply_markup?: { inline_keyboard: LaunchButton[][] };
}
export interface MessageReference {
  messageId: number | null;
  ephemeralId: number | null;
  date: number;
}
export interface TelegramGateway {
  me(): Promise<{ id: number; username: string; hasMainMiniApp: boolean }>;
  member(chatId: number, userId: number): Promise<TelegramMember>;
  send(input: SendMessage): Promise<MessageReference>;
  commands(commands: TelegramCommand[], chatId?: number): Promise<void>;
}
