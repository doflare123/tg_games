import { expect, it } from 'vitest';
import { isUnavailableMembership } from '../src/server/platform/telegram-membership-error.ts';

it.each(['PARTICIPANT_ID_INVALID', 'USER_ID_INVALID', 'user not found'])(
  'recognizes a user-specific 400: %s',
  (description) => {
    const message = `api.getChatMember failed [400]: Bad Request: ${description}`;
    expect(isUnavailableMembership(Object.assign(new Error(message), { code: 400 }))).toBe(true);
    expect(isUnavailableMembership({ code: 400, description: `Bad Request: ${description}` })).toBe(
      true,
    );
    expect(isUnavailableMembership({ error_code: 400, description })).toBe(true);
  },
);

it.each([
  null,
  'PARTICIPANT_ID_INVALID',
  new Error('PARTICIPANT_ID_INVALID'),
  { code: '400', description: 'PARTICIPANT_ID_INVALID' },
  { code: 403, description: 'PARTICIPANT_ID_INVALID' },
  { code: 429, description: 'PARTICIPANT_ID_INVALID', parameters: { retry_after: 30 } },
  { code: 500, description: 'PARTICIPANT_ID_INVALID' },
  { code: 400, description: 'Bad Request: chat not found' },
  { code: 400, description: 'Bad Request: not enough rights to get chat member' },
  { code: 400, description: 'Bad Request: unrelated error PARTICIPANT_ID_INVALID' },
  { code: 400, description: 'Bad Request: PARTICIPANT_ID_INVALID (retry)' },
  { code: 400, description: 42 },
])('leaves unrelated or ambiguous errors retryable: %j', (error) => {
  expect(isUnavailableMembership(error)).toBe(false);
});
