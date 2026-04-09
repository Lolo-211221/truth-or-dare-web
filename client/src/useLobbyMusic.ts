import { useEffect, useRef } from 'react';

const LOBBY_AUDIO_SRC = '/audio/lobby.mp3';

/**
 * Loops lobby background music when enabled. Browsers require a user gesture
 * before audio can play — toggling "Music" on counts as that gesture.
 */
export function useLobbyMusic(enabled: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const a = new Audio(LOBBY_AUDIO_SRC);
    a.loop = true;
    a.volume = 0.35;
    audioRef.current = a;
    return () => {
      a.pause();
      a.src = '';
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (enabled) {
      void a.play().catch(() => {
        /* autoplay blocked until user interacts */
      });
    } else {
      a.pause();
    }
  }, [enabled]);
}
