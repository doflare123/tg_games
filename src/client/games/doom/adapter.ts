import {
  DOOM_CHUNK_TICKS,
  DOOM_MAX_TICKS,
  DOOM_RULESET,
  DOOM_SKILLS,
  type DoomCommandSpan,
  type DoomProgress,
  type DoomRun,
  type DoomUpload,
  decodeDoomRun,
  doomCommands,
  doomSamePrefix,
  doomTicks,
  doomTime,
} from '../../../shared/doom.ts';
import { canAccessDoom, DOOM_PRIVATE_MESSAGE } from '../../../shared/doom-policy.ts';
import { integer, object, oneOf } from '../../../shared/errors.ts';
import { type MobilePad, mountDoomPad } from '../../controls/mobile-pad.ts';
import { api, hasApi } from '../../platform/api.ts';
import { loadLocal, saveLocal } from '../../platform/storage.ts';
import { button, element, errorMessage } from '../../ui/dom.ts';
import type { GameAdapter, GameHost } from '../adapter.ts';
import type { DoomCommand } from './protocol.ts';

const SAVE_KEY = 'arcade:freedoom:e1:v1';
export async function mountDoom(host: GameHost): Promise<GameAdapter> {
  if (!canAccessDoom(hasApi && (await api.profile()).isAdmin)) {
    host.container.replaceChildren(element('p', 'empty-state', DOOM_PRIVATE_MESSAGE));
    return { pause() {}, resume() {}, dispose() {} };
  }
  const abort = new AbortController();
  let frame: HTMLIFrameElement | null = null,
    run: DoomRun | null = null,
    progress: DoomProgress | null = null,
    pad: MobilePad | null = null;
  let recording: DoomCommandSpan[] = [];
  let pendingUpload: DoomUpload | null = null;
  let interruptions: number[] = [];
  let pauseTick: number | null = null;
  let recordedTicks = 0,
    disposed = false,
    ranked = false,
    paused = false,
    finished = false,
    sending = false,
    verifying = false,
    needsInterrupt = false,
    running = false;
  const wrap = element('div', 'emulator-layout'),
    screen = element('div', 'doom-screen'),
    panel = element('aside', 'game-panel');
  const status = element(
    'p',
    'game-status',
    'Freedoom загружается с сервера. Свои файлы не нужны.',
  );
  status.setAttribute('role', 'status');
  const delivery = element('p', 'control-hint');
  delivery.setAttribute('aria-live', 'polite');
  const hud = element('p', 'game-status'),
    skill = element('select', 'select');
  skill.setAttribute('aria-label', 'Сложность Freedoom');
  for (const [value, label] of [
    ['1', '1 · Очень легко'],
    ['2', '2 · Легко'],
    ['3', '3 · Средне'],
    ['4', '4 · Сложно'],
  ] as const) {
    const option = element('option', '', label);
    option.value = value;
    skill.append(option);
  }
  skill.value = '3';
  const send = (message: DoomCommand) =>
    frame?.contentWindow?.postMessage(message, location.origin);
  const persist = () => {
    if (run && ranked)
      void saveLocal(SAVE_KEY, {
        run,
        commands: recording,
        pending: pendingUpload,
        interruptions,
      }).catch(() => {
        if (!disposed)
          delivery.textContent =
            'Нет локальной копии; серверный прогресс сохранён до последней отправки.';
      });
  };
  const tail = (from: number, count: number): DoomCommandSpan[] => {
    const result: DoomCommandSpan[] = [];
    let cursor = 0;
    for (const span of recording) {
      const start = Math.max(from, cursor),
        end = Math.min(from + count, cursor + span.ticks);
      if (end > start) result.push({ mask: span.mask, ticks: end - start });
      cursor += span.ticks;
      if (cursor >= from + count) break;
    }
    return result;
  };
  async function upload() {
    if (!ranked || !run || sending) return;
    sending = true;
    const targetTick = recordedTicks;
    try {
      while (run && (pendingUpload || run.acceptedTicks < targetTick)) {
        const untilTick = Math.min(targetTick, run.acceptedTicks + DOOM_CHUNK_TICKS);
        const acceptedTicks = run.acceptedTicks;
        pendingUpload ??= {
          runId: run.id,
          revision: run.revision,
          commands: tail(run.acceptedTicks, untilTick - run.acceptedTicks),
          interruptions: interruptions.filter((tick) => tick >= acceptedTicks && tick <= untilTick),
        };
        persist();
        run = await api.appendDoom(pendingUpload);
        pendingUpload = null;
        persist();
      }
      if (needsInterrupt && run && pauseTick !== null && pauseTick <= run.acceptedTicks) {
        run = await api.interruptDoom(run.id, pauseTick);
        needsInterrupt = false;
        persist();
      }
      if (run)
        delivery.textContent = `Автосохранение: ${doomTime(run.acceptedTicks)} · проверено: ${doomTime(run.verifiedTicks)}${run.continuous ? '' : ' · рейтинг эпизода выключен'}`;
    } catch (error) {
      if (!disposed) delivery.textContent = `Запись ждёт отправки. ${errorMessage(error)}`;
      persist();
    } finally {
      sending = false;
    }
  }
  async function verify() {
    if (!ranked || !run || verifying || needsInterrupt || run.verifiedTicks >= run.acceptedTicks)
      return;
    verifying = true;
    const current = run;
    try {
      const verified = await api.verifyDoom(current.id);
      if (run?.id === current.id) {
        run = {
          ...run,
          verifiedTicks: Math.max(run.verifiedTicks, verified.verifiedTicks),
          status: verified.status,
        };
        persist();
      }
      if (finished && !disposed && verified.verifiedTicks >= run.acceptedTicks)
        delivery.textContent =
          verified.status === 'complete' && run.continuous
            ? 'Эпизод проверен сервером. Результаты опубликованы.'
            : 'Пройденные уровни проверены сервером.';
    } catch (error) {
      if (!disposed)
        delivery.textContent = `Автосохранение работает; проверка ожидает повтора. ${errorMessage(error)}`;
    } finally {
      verifying = false;
    }
  }
  function pause() {
    if (!frame || !running || paused || finished) return;
    paused = true;
    pad?.release();
    send({ type: 'doom:pause' });
    if (ranked) {
      needsInterrupt = true;
      if (run) run = { ...run, continuous: false };
      persist();
      void upload();
    }
    status.textContent =
      'Пауза. После продолжения засчитываются новые целиком пройденные уровни; весь эпизод — только без перерывов.';
    resume.disabled = false;
  }
  function continueGame() {
    if (!frame || !paused || finished) return;
    paused = false;
    send({ type: 'doom:resume' });
    status.textContent = 'Игра продолжается. Прогресс сохраняется автоматически.';
    resume.disabled = true;
  }
  const resume = button('Продолжить', continueGame, 'button secondary');
  resume.disabled = true;
  const start = button('Новый забег', () => {
    void launch(false);
  });
  const restore = button(
    'Продолжить сохранённую игру',
    () => {
      void launch(true);
    },
    'button secondary',
  );
  restore.disabled = true;
  async function launch(restoreSaved: boolean) {
    if (frame) return;
    start.disabled = restore.disabled = true;
    paused = finished = running = needsInterrupt = false;
    resume.disabled = true;
    try {
      ranked = hasApi;
      if (restoreSaved && progress) {
        run = progress.run;
        recording = progress.commands;
        recordedTicks = doomTicks(recording);
        skill.value = run.skill;
        if (ranked) {
          pauseTick = recordedTicks;
          if (!interruptions.includes(pauseTick)) interruptions.push(pauseTick);
          needsInterrupt = true;
          await upload();
        }
      } else {
        recording = [];
        pendingUpload = null;
        interruptions = [];
        pauseTick = null;
        recordedTicks = 0;
        run = ranked
          ? await api.createDoom(crypto.randomUUID(), oneOf(skill.value, DOOM_SKILLS))
          : {
              id: 'practice',
              ruleset: DOOM_RULESET,
              skill: oneOf(skill.value, DOOM_SKILLS),
              revision: 0,
              acceptedTicks: 0,
              verifiedTicks: 0,
              continuous: false,
              status: 'active',
              createdAt: Date.now(),
              expiresAt: Date.now() + 86400000,
            };
      }
      if (disposed) return;
      persist();
      frame = element('iframe', 'doom-frame');
      frame.title = 'Freedoom';
      frame.allow = 'autoplay; fullscreen';
      frame.src = '/doom-runtime.html';
      screen.replaceChildren(frame);
      skill.disabled = true;
      status.textContent = restoreSaved
        ? 'Восстанавливаем игру из автосохранения…'
        : 'Запускаем первый эпизод Freedoom…';
    } catch (error) {
      status.textContent = errorMessage(error);
      start.disabled = false;
      restore.disabled = !progress;
    }
  }
  window.addEventListener(
    'message',
    (event) => {
      if (disposed || event.origin !== location.origin || event.source !== frame?.contentWindow)
        return;
      try {
        const data = object(event.data);
        if (data.type === 'doom:ready' && run)
          send({ type: 'doom:start', skill: run.skill, commands: recording });
        if (data.type === 'doom:running') {
          running = true;
          integer(data.tick, 0, DOOM_MAX_TICKS);
          status.textContent = ranked
            ? 'Игра идёт. Прогресс сохраняется автоматически; сервер проверяет запись в фоне.'
            : 'Свободная игра. Для серверного автосохранения и рейтингов открой игру в Telegram.';
        }
        if (data.type === 'doom:pause-request') pause();
        if (data.type === 'doom:paused') {
          pauseTick = integer(data.tick, 0, recordedTicks);
          if (!interruptions.includes(pauseTick)) interruptions.push(pauseTick);
          needsInterrupt = true;
          persist();
          void upload();
        }
        if (data.type === 'doom:error') {
          status.textContent = typeof data.message === 'string' ? data.message : 'Ошибка движка';
          running = false;
          frame?.remove();
          frame = null;
          start.disabled = skill.disabled = false;
          if (run && ranked) progress = { run, commands: recording };
          restore.disabled = !progress;
        }
        if (data.type === 'doom:commands') {
          const fromTick = integer(data.fromTick, 0, DOOM_MAX_TICKS),
            commands = doomCommands(data.commands);
          if (
            fromTick !== recordedTicks ||
            recordedTicks + doomTicks(commands) > DOOM_MAX_TICKS ||
            typeof data.finished !== 'boolean'
          )
            return;
          recording.push(...commands);
          recordedTicks += doomTicks(commands);
          finished = data.finished;
          hud.textContent = `E1M${integer(data.map, 1, 9)} · ${doomTime(integer(data.activeTicks, 0, DOOM_MAX_TICKS))}`;
          persist();
          if (finished) {
            status.textContent = 'Забег завершён. Запись отправляется на проверку…';
            pad?.release();
            void upload().then(verify);
          }
        }
      } catch {
        /* Ignore malformed or stale iframe messages. */
      }
    },
    { signal: abort.signal },
  );
  panel.append(
    element('span', 'eyebrow', 'FREEDOOM / EPISODE 1'),
    element('h2', '', 'До самого ада.'),
    skill,
    start,
    restore,
    button('Пауза', pause, 'button secondary'),
    resume,
    hud,
    status,
    delivery,
    element(
      'p',
      'control-hint',
      'Стрелки — движение и поворот, Ctrl — огонь, Space — действие, Shift — бег, запятая/точка — стрейф, 1–7 — оружие. Enter или огонь — дальше между уровнями. Рейтинги: скорость и 100% монстров/секретов, отдельно по сложности.',
    ),
  );
  const display = element('div', 'doom-display');
  display.append(screen);
  wrap.append(display, panel);
  host.container.append(wrap);
  pad = mountDoomPad(display, (keyCode, pressed) => send({ type: 'doom:key', keyCode, pressed }));
  window.addEventListener(
    'blur',
    () => {
      if (!document.hasFocus() && document.activeElement !== frame) pause();
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) pause();
    },
    { signal: abort.signal },
  );
  const retryTimer = setInterval(() => {
      void upload();
    }, 5000),
    verifyTimer = setInterval(() => {
      void verify();
    }, 20000);
  if (hasApi) {
    try {
      const remote = await api.doomProgress(),
        localValue = await loadLocal(SAVE_KEY).catch(() => null);
      let local: DoomProgress | null = null;
      try {
        if (localValue) {
          const value = object(localValue);
          local = {
            run: decodeDoomRun(value.run),
            commands: doomCommands(value.commands, DOOM_MAX_TICKS),
          };
          if (remote && local.run.id === remote.run.id) {
            const localTicks = doomTicks(local.commands);
            if (Array.isArray(value.interruptions) && value.interruptions.length <= DOOM_MAX_TICKS)
              interruptions = value.interruptions.map((tick) => integer(tick, 0, localTicks));
            if (value.pending) {
              const pending = object(value.pending);
              const revision = integer(pending.revision, 0, DOOM_MAX_TICKS);
              if (pending.runId === remote.run.id && revision === remote.run.revision)
                pendingUpload = {
                  runId: remote.run.id,
                  revision,
                  commands: doomCommands(pending.commands),
                  interruptions: Array.isArray(pending.interruptions)
                    ? pending.interruptions.map((tick) => integer(tick, 0, DOOM_MAX_TICKS))
                    : [],
                };
            }
          }
        }
      } catch {
        /* Use server progress if local cache is damaged. */
      }
      if (remote) {
        progress = remote;
        if (
          local?.run.id === remote.run.id &&
          doomTicks(local.commands) >= remote.run.acceptedTicks &&
          doomSamePrefix(local.commands, remote.commands, remote.run.acceptedTicks)
        )
          progress = { run: remote.run, commands: local.commands };
        else {
          pendingUpload = null;
          interruptions = [];
        }
      }
      restore.disabled = !progress;
    } catch (error) {
      if (!disposed)
        delivery.textContent = `Не удалось получить автосохранение. ${errorMessage(error)}`;
    }
  }
  return {
    pause,
    resume: continueGame,
    dispose() {
      pause();
      disposed = true;
      abort.abort();
      clearInterval(retryTimer);
      clearInterval(verifyTimer);
      pad?.destroy();
      frame?.remove();
    },
  };
}
