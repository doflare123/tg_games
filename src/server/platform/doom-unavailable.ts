import { AppError } from '../../shared/errors.ts';
export default function unavailable(): never {
  throw new AppError('UNAVAILABLE', 'Серверный движок Doom ещё не собран');
}
