export interface TelegramMember {
  active: boolean;
  admin: boolean;
}
// A user-specific lookup failure, distinct from an outage or missing bot permissions.
export class MembershipUnavailableError extends Error {
  constructor() {
    super('Участие игрока недоступно для проверки');
    this.name = 'MembershipUnavailableError';
  }
}
export interface TelegramCommand {
  command: string;
  description: string;
  is_ephemeral?: boolean;
}
export type LaunchButton = { text: string } & (
  | { url: string }
  | { web_app: { url: string } }
  | { callback_data: string }
);
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
export interface EditMessage {
  chat_id: number;
  message_id: number;
  text: string;
  reply_markup: { inline_keyboard: LaunchButton[][] };
}
export interface SendMedia {
  chat_id: number;
  kind: 'photo' | 'video';
  fileId: string;
  caption: string;
  reply_markup?: { inline_keyboard: LaunchButton[][] };
}
export interface TelegramGateway {
  me(): Promise<{ id: number; username: string; hasMainMiniApp: boolean }>;
  member(chatId: number, userId: number): Promise<TelegramMember>;
  send(input: SendMessage): Promise<MessageReference>;
  sendMedia(input: SendMedia): Promise<MessageReference>;
  edit(input: EditMessage): Promise<void>;
  commands(commands: TelegramCommand[], chatId?: number): Promise<void>;
  answerCallback?(id: string, message?: string): Promise<void>;
  privateCommands?(commands: TelegramCommand[]): Promise<void>;
}
