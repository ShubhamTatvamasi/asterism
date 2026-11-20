/**
 * Tiny synthesised sound design. No audio files, no network requests.
 * The audio context is created lazily on the first gesture.
 */

type Wave = OscillatorType;

export class Chimes {
  enabled = true;

  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (typeof window === 'undefined') return null;
    if (!this.context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      void this.context?.suspend();
    }
  }

  private tone(
    frequency: number,
    duration: number,
    options: { wave?: Wave; gain?: number; delay?: number; slideTo?: number } = {},
  ): void {
    const context = this.ensure();
    if (!context || !this.master) return;
    const when = context.currentTime + (options.delay ?? 0);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = options.wave ?? 'sine';
    oscillator.frequency.setValueAtTime(frequency, when);
    if (options.slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(options.slideTo, when + duration);
    }
    const peak = options.gain ?? 0.06;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.03);
  }

  star(column = 0): void {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const semitone = scale[column % scale.length] ?? 0;
    this.tone(392 * Math.pow(2, semitone / 12), 0.55, { gain: 0.055 });
    this.tone(784 * Math.pow(2, semitone / 12), 0.25, { gain: 0.014, delay: 0.01 });
  }

  mark(): void {
    this.tone(220, 0.1, { wave: 'triangle', gain: 0.025 });
  }

  clear(): void {
    this.tone(180, 0.09, { wave: 'triangle', gain: 0.018, slideTo: 140 });
  }

  hint(): void {
    this.tone(523.25, 0.4, { gain: 0.04 });
    this.tone(659.25, 0.5, { gain: 0.035, delay: 0.07 });
  }

  undo(): void {
    this.tone(330, 0.14, { wave: 'triangle', gain: 0.022, slideTo: 247 });
  }

  error(): void {
    this.tone(196, 0.22, { wave: 'sine', gain: 0.035, slideTo: 155 });
  }

  win(): void {
    const notes = [392, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((frequency, index) => {
      this.tone(frequency, 1.4, { gain: 0.032, delay: index * 0.11 });
      this.tone(frequency / 2, 1.8, { gain: 0.012, delay: index * 0.11 });
    });
  }
}
