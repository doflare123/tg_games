import { AppError, integer, object, oneOf, text } from '../../shared/errors.ts';

export interface SupportMedia {
  kind: 'photo' | 'video';
  fileId: string;
  caption: string;
  albumId?: string;
}
export function decodeSupportMedia(value: unknown): SupportMedia {
  const media = object(value);
  const fileId = text(media.fileId, 1, 2048);
  // Accept Telegram file identifiers, never URLs or local/attachment paths.
  if (/[\s\\/:]/.test(fileId)) throw new AppError('BAD_INPUT', 'Некорректный Telegram-файл');
  const caption = text(media.caption ?? '', 0, 4096);
  if ([...caption].length > 1024)
    throw new AppError('BAD_INPUT', 'Подпись к вложению слишком длинная');
  return {
    kind: oneOf(media.kind, ['photo', 'video']),
    fileId,
    caption,
    ...(media.albumId === undefined ? {} : { albumId: text(media.albumId, 1, 128) }),
  };
}
export function supportMedia(message: Record<string, unknown>): SupportMedia | undefined {
  if (message.photo === undefined && message.video === undefined) return undefined;
  let file: Record<string, unknown>, kind: SupportMedia['kind'];
  if (message.photo !== undefined) {
    if (!Array.isArray(message.photo) || message.photo.length === 0 || message.photo.length > 20)
      throw new AppError('BAD_INPUT', 'Некорректное фото');
    const photos = message.photo.map((value) => {
      const photo = object(value);
      return { photo, area: integer(photo.width, 1, 100000) * integer(photo.height, 1, 100000) };
    });
    const largest = photos.reduce((a, b) => (a.area >= b.area ? a : b));
    file = largest.photo;
    kind = 'photo';
  } else {
    file = object(message.video);
    kind = 'video';
  }
  return decodeSupportMedia({
    kind,
    fileId: file.file_id,
    caption: message.caption ?? '',
    ...(message.media_group_id === undefined ? {} : { albumId: message.media_group_id }),
  });
}
export function supportBody(media: SupportMedia): string {
  return `${media.kind === 'photo' ? '📷 Фото' : '🎥 Видео'}${media.caption.trim() ? `\n${media.caption.trim()}` : ''}`;
}
