// Synthesized sound effects — the game's only audio. No files, no libraries:
// pure Web Audio oscillators, which keeps the runtime dependency count at zero
// and the strict CSP untouched (synthesis loads nothing; media-src stays
// unneeded). Fail-open like net/meter.ts: anywhere an AudioContext is missing,
// blocked, or broken, every call is a silent no-op and the game plays on.
//
// Autoplay policy: browsers only let a context produce sound after a user
// gesture, so the Game calls unlock() from its pointer/key handlers — the
// first tap arms audio invisibly (iOS Safari included, via the webkit prefix).
//
// Sound design mirrors the ping layer's teaching job: the sonar pulse's volume
// IS the system's instantaneous emission (pings.ts pingStrength), so running
// dark is as audible as it is visible; the strike is the beam made physical —
// a descending lance into a low boom.

const SFX = {
  master: 0.5, // master bus gain
  ping: {
    peak: 0.06, // gain at strength 1
    freqFrom: 520,
    freqTo: 260,
    seconds: 0.42,
    fifth: 0.35, // level of the faint fifth partial, relative to the root
  },
  strike: {
    lancePeak: 0.12,
    lanceFrom: 900,
    lanceTo: 60,
    lanceSeconds: 0.55, // matches the beam's fade in Renderer.drawStrikeBeam
    boomPeak: 0.18,
    boomFreq: 55,
    boomSeconds: 1.2,
    noisePeak: 0.1,
    noiseBand: 220, // bandpass centre for the debris hiss
  },
} as const;

// The context is created lazily on the first user gesture and shared forever.
// null = not yet unlocked OR unavailable; construction happens at most once.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let tried = false;

type AudioContextCtor = new () => AudioContext;

function contextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

// Arm audio from a user gesture. Safe to call on every tap: constructs once,
// resumes a suspended context otherwise, and no-ops where audio can't exist.
export function unlock(): void {
  try {
    if (!ctx) {
      if (tried) return; // construction already failed once — stay silent
      const Ctor = contextCtor();
      tried = true;
      if (!Ctor) return;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = SFX.master;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
    master = null;
  }
}

// A sonar pulse for a newborn broadcast wavefront. `strength` is
// pings.pingStrength(emission, flare) — the same number that sets the ring's
// brightness — so what you hear is exactly what you emit. Near-silence stays
// silent (a strength under 0.02 draws no ring and plays no sound).
export function playPing(strength: number): void {
  if (!ctx || !master || ctx.state !== 'running') return;
  const s = Math.min(1, Math.max(0, strength));
  if (!(s > 0.02)) return;
  try {
    const t0 = ctx.currentTime;
    const t1 = t0 + SFX.ping.seconds;
    const env = ctx.createGain();
    env.gain.setValueAtTime(SFX.ping.peak * s, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    env.connect(master);

    const root = ctx.createOscillator();
    root.type = 'sine';
    root.frequency.setValueAtTime(SFX.ping.freqFrom, t0);
    root.frequency.exponentialRampToValueAtTime(SFX.ping.freqTo, t1);
    root.connect(env);
    root.start(t0);
    root.stop(t1);

    // A faint fifth above the root gives the pulse its sonar color.
    const fifth = ctx.createOscillator();
    const fifthEnv = ctx.createGain();
    fifthEnv.gain.value = SFX.ping.fifth;
    fifth.type = 'sine';
    fifth.frequency.setValueAtTime(SFX.ping.freqFrom * 1.5, t0);
    fifth.frequency.exponentialRampToValueAtTime(SFX.ping.freqTo * 1.5, t1);
    fifth.connect(fifthEnv);
    fifthEnv.connect(env);
    fifth.start(t0);
    fifth.stop(t1);
  } catch {
    // A single failed play must never break the frame loop.
  }
}

// A grazing shot — the lance at reduced weight with a short crack, no boom.
// Plays when a lock breaks late enough that the strike was already loosed.
export function playGraze(): void {
  if (!ctx || !master || ctx.state !== 'running') return;
  try {
    const t0 = ctx.currentTime;
    const end = t0 + SFX.strike.lanceSeconds * 0.8;
    const env = ctx.createGain();
    env.gain.setValueAtTime(SFX.strike.lancePeak * 0.6, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(master);
    const lance = ctx.createOscillator();
    lance.type = 'sawtooth';
    lance.frequency.setValueAtTime(SFX.strike.lanceFrom, t0);
    lance.frequency.exponentialRampToValueAtTime(SFX.strike.lanceTo * 2, end);
    lance.connect(env);
    lance.start(t0);
    lance.stop(end);
    // The crack: a hard, brief square blip as the shot clips the system.
    const crackEnd = t0 + 0.12;
    const crackEnv = ctx.createGain();
    crackEnv.gain.setValueAtTime(SFX.strike.lancePeak * 0.5, t0 + 0.05);
    crackEnv.gain.exponentialRampToValueAtTime(0.0001, crackEnd + 0.05);
    crackEnv.connect(master);
    const crack = ctx.createOscillator();
    crack.type = 'square';
    crack.frequency.setValueAtTime(180, t0 + 0.05);
    crack.connect(crackEnv);
    crack.start(t0 + 0.05);
    crack.stop(crackEnd + 0.05);
  } catch {
    // Silence over breakage, always.
  }
}

// The hunter's strike: the beam as a descending lance, then the detonation as
// a low boom under a band-passed noise burst. Timed so the lance spans the
// beam's 0.55s fade and the boom lands as the supernova blooms.
export function playStrike(): void {
  if (!ctx || !master || ctx.state !== 'running') return;
  try {
    const t0 = ctx.currentTime;

    // Lance — the beam crossing the years.
    const lanceEnd = t0 + SFX.strike.lanceSeconds;
    const lanceEnv = ctx.createGain();
    lanceEnv.gain.setValueAtTime(SFX.strike.lancePeak, t0);
    lanceEnv.gain.exponentialRampToValueAtTime(0.0001, lanceEnd);
    lanceEnv.connect(master);
    const lance = ctx.createOscillator();
    lance.type = 'sawtooth';
    lance.frequency.setValueAtTime(SFX.strike.lanceFrom, t0);
    lance.frequency.exponentialRampToValueAtTime(SFX.strike.lanceTo, lanceEnd);
    lance.connect(lanceEnv);
    lance.start(t0);
    lance.stop(lanceEnd);

    // Boom — the star, annihilated.
    const boomStart = t0 + SFX.strike.lanceSeconds * 0.8;
    const boomEnd = boomStart + SFX.strike.boomSeconds;
    const boomEnv = ctx.createGain();
    boomEnv.gain.setValueAtTime(0.0001, boomStart);
    boomEnv.gain.exponentialRampToValueAtTime(SFX.strike.boomPeak, boomStart + 0.03);
    boomEnv.gain.exponentialRampToValueAtTime(0.0001, boomEnd);
    boomEnv.connect(master);
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(SFX.strike.boomFreq, boomStart);
    boom.frequency.exponentialRampToValueAtTime(SFX.strike.boomFreq * 0.6, boomEnd);
    boom.connect(boomEnv);
    boom.start(boomStart);
    boom.stop(boomEnd);

    // Debris hiss — one second of white noise through a bandpass, decaying
    // with the boom. Buffer built once per strike (strikes are rare).
    const noiseLen = Math.ceil(ctx.sampleRate * 1);
    const buffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = SFX.strike.noiseBand;
    band.Q.value = 0.9;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.0001, boomStart);
    noiseEnv.gain.exponentialRampToValueAtTime(SFX.strike.noisePeak, boomStart + 0.04);
    noiseEnv.gain.exponentialRampToValueAtTime(0.0001, boomEnd);
    noise.connect(band);
    band.connect(noiseEnv);
    noiseEnv.connect(master);
    noise.start(boomStart);
    noise.stop(boomEnd);
  } catch {
    // Silence over breakage, always.
  }
}
