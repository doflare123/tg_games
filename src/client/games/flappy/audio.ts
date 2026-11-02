import { integer, object } from '../../../shared/errors.ts';

const AUDIO_KEY = 'arcade:flappy:audio:v1';
export function flappyAudio() {
  let volume = 100;
  let muted = false;
  let lastVolume = 100;
  try {
    const saved = localStorage.getItem(AUDIO_KEY);
    if (saved) {
      const data = object(JSON.parse(saved));
      const savedVolume = integer(data.volume, 0, 100);
      const savedLastVolume = integer(data.lastVolume, 1, 100);
      if (typeof data.muted !== 'boolean') throw new Error('Invalid audio settings');
      volume = savedVolume;
      lastVolume = savedLastVolume;
      muted = data.muted;
    }
  } catch {
    /* Missing or invalid preferences use the defaults. */
  }
  const sounds = new Map(
    ['wing', 'point', 'hit', 'die'].map((name) => [name, new Audio(`/assets/flappy/${name}.ogg`)]),
  );
  function apply() {
    for (const audio of sounds.values()) {
      audio.volume = volume / 100;
      // Muting an already playing effect must take effect immediately.
      audio.muted = muted || volume === 0;
    }
  }
  function save() {
    apply();
    try {
      localStorage.setItem(AUDIO_KEY, JSON.stringify({ volume, muted, lastVolume }));
    } catch {
      /* Controls still work when device storage is unavailable. */
    }
  }
  apply();
  return {
    get volume() {
      return volume;
    },
    get muted() {
      return muted || volume === 0;
    },
    setVolume(value: number) {
      volume = integer(value, 0, 100);
      if (volume > 0) lastVolume = volume;
      muted = false;
      save();
    },
    toggleMuted() {
      if (muted || volume === 0) {
        muted = false;
        if (volume === 0) volume = lastVolume;
      } else muted = true;
      save();
    },
    play(name: string) {
      if (muted || volume === 0) return;
      const audio = sounds.get(name);
      if (audio) {
        audio.currentTime = 0;
        void audio.play().catch(() => {
          /* The browser may block audio. */
        });
      }
    },
    dispose() {
      for (const audio of sounds.values()) audio.pause();
    },
  };
}
