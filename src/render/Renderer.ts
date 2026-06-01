import { palette, fonts, rgba, blendHex } from '../theme.ts';
import type { CourtLayout, BodySpec, GameStateKind } from '../game/states.ts';
import { DEFAULT_LAYOUT, LIMITS } from '../game/states.ts';
import { generateStarfield, drawStarfield, type StarSpec } from './starfield.ts';
import { drawCourt } from './court.ts';
import { drawStar, dimmed, STYLE_P1, STYLE_P2, type StarStyle } from './star.ts';
import { Trail, drawTrail } from './trail.ts';
import { Particles } from './particles.ts';
import { drawVelocityArrow } from './arrow.ts';
import {
  drawWordmark,
  drawPhaseLabel,
  drawHud,
  drawButton,
  drawTooltip,
  drawOutcomeCard,
  type CanvasButton,
} from './overlay.ts';
import { bodyRadius } from '../physics/Body.ts';
import type { Body } from '../physics/Body.ts';
import type { Simulation } from '../physics/Simulation.ts';
import type { OutcomeClassifier, Outcome } from '../game/outcomes.ts';

export interface RenderInput {
  state: GameStateKind;
  time: number;
  dt: number;
  hover: { x: number; y: number } | null;
  specs: { p1: BodySpec; p2: BodySpec };
  sim: Simulation | null;
  classifier: OutcomeClassifier | null;
  outcome: Outcome | null;
  countdownRemaining: number;
  trails: { p1: Trail; p2: Trail };
  posGrabbing: boolean;
  arrowGrabbing: boolean;
  // Set when the two bodies have merged; carries the merger location,
  // wall-time elapsed since the collision, and the combined mass. The
  // Renderer uses this to animate flash → shockwave → persistent remnant
  // in place of drawing the two original bodies.
  supernova: { x: number; y: number; elapsed: number; mergedMass: number } | null;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly layout: CourtLayout;
  private starfield: StarSpec[];
  private particlesLayer: Particles;
  readonly buttons: Map<string, CanvasButton> = new Map();

  constructor(canvas: HTMLCanvasElement, layout: CourtLayout = DEFAULT_LAYOUT) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2D context');
    this.ctx = ctx;
    this.layout = layout;

    // Scale the internal pixel buffer by devicePixelRatio so the canvas
    // renders sharp on retina / high-DPI displays. CSS keeps the LOGICAL
    // size (1280×800), and we ctx.scale() once so all subsequent drawing
    // calls work in logical pixels — render code is unaware of the DPR.
    // (Caught by /qa Layer 3 — was soft on retina.)
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(layout.canvas.width * dpr);
    canvas.height = Math.round(layout.canvas.height * dpr);
    canvas.style.width = `${layout.canvas.width}px`;
    canvas.style.height = `${layout.canvas.height}px`;
    ctx.scale(dpr, dpr);

    this.starfield = generateStarfield(layout.canvas.width, layout.canvas.height);
    this.particlesLayer = new Particles();
  }

  burst(x: number, y: number, count: number, color: string, speed?: number): void {
    this.particlesLayer.burst(x, y, count, color, speed);
  }

  // Returns the button (in canvas-space) hovered by the pointer, if any.
  hoveredButton(p: { x: number; y: number } | null): string | null {
    if (!p) return null;
    for (const [name, b] of this.buttons) {
      if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) {
        return name;
      }
    }
    return null;
  }

  render(input: RenderInput): void {
    const { ctx } = this;
    const { width: w, height: h } = this.layout.canvas;

    // Wipe + always-on backdrop
    ctx.fillStyle = palette.voidDeep;
    ctx.fillRect(0, 0, w, h);
    this.particlesLayer.ambient(w, h, input.dt);
    drawStarfield(ctx, this.starfield, input.time);

    this.buttons.clear();

    switch (input.state) {
      case 'title':
        this.renderTitle(input);
        break;
      case 'setup_p1':
      case 'setup_p2':
        this.renderSetup(input);
        break;
      case 'countdown':
        this.renderCountdown(input);
        break;
      case 'simulate':
        this.renderSimulate(input);
        break;
      case 'resolved':
        this.renderResolved(input);
        break;
    }

    this.particlesLayer.draw(ctx);
  }

  // ─────────────────────────────────────────────────────────────── states

  private renderTitle(input: RenderInput): void {
    const { ctx } = this;
    const { width: w, height: h } = this.layout.canvas;

    drawWordmark(ctx, w, h);

    const beginBtn: CanvasButton = {
      label: 'Begin',
      x: w / 2 - 90,
      y: h * 0.62,
      width: 180,
      height: 44,
    };
    const hovered = this.hoveredButton(input.hover) === 'begin';
    drawButton(ctx, beginBtn, { primary: palette.cream, hovered });
    this.buttons.set('begin', beginBtn);
  }

  private renderSetup(input: RenderInput): void {
    const { ctx } = this;
    const { width: w } = this.layout.canvas;
    const activePlayer = input.state === 'setup_p1' ? 1 : 2;

    drawCourt(ctx, this.layout, {
      activePlayer,
      showInBoundsBoxes: true,
      showCenterLine: true,
    });

    // Phase label
    const phaseColor = activePlayer === 1 ? palette.player1 : palette.player2;
    drawPhaseLabel(
      ctx,
      activePlayer === 1 ? 'Player 1 — set your star' : 'Player 2 — set your star',
      w,
      phaseColor,
    );

    // The OTHER player's star: dimmed (if already set in P2 phase) or absent
    // (if it's their first time and P2 hasn't entered setup yet).
    if (activePlayer === 2) {
      this.drawSpecStar(input.specs.p1, dimmed(STYLE_P1), input.time);
      // Show P1's locked velocity vector so P2 can plan a complementary
      // trajectory — without this, P2 is guessing at half the system.
      // No tooltip (the magnitude is implicit in the arrow length).
      drawVelocityArrow(
        ctx,
        input.specs.p1.pos,
        input.specs.p1.vel,
        palette.player1,
        false,
        0.55, // dim — locked, not the focus
      );
    } else {
      // We are P1 setting up; P2's spec is the default and shouldn't render
      // yet — keep their side empty so the only attention is on the active
      // side. This is a deliberate restraint of the visual frame.
    }

    // Active player's star + velocity arrow
    const activeSpec = activePlayer === 1 ? input.specs.p1 : input.specs.p2;
    const activeStyle: StarStyle = activePlayer === 1 ? STYLE_P1 : STYLE_P2;
    this.drawSpecStar(activeSpec, activeStyle, input.time);

    drawVelocityArrow(
      ctx,
      activeSpec.pos,
      activeSpec.vel,
      activeStyle.primary,
      input.arrowGrabbing || Math.hypot(activeSpec.vel.x, activeSpec.vel.y) >= 1,
    );

    // Mass tooltip near the star (subtle, always-on)
    // Place the mass tooltip below the body when the star is in the upper
    // part of the canvas — otherwise it collides with the help-text block
    // in the active player's corner (caught by /qa round 2). 240 covers the
    // four-line help block plus a margin.
    const starRadius = bodyRadius(activeSpec.mass);
    const flipBelow = activeSpec.pos.y - starRadius < 240;
    const tooltipAnchorY = flipBelow
      ? activeSpec.pos.y + starRadius + 4
      : activeSpec.pos.y - starRadius - 4;
    drawTooltip(
      ctx,
      `mass ${activeSpec.mass.toFixed(1)} · scroll to adjust`,
      activeSpec.pos.x,
      tooltipAnchorY,
      rgba(activeStyle.primary, 1),
      flipBelow ? 'below' : 'above',
    );

    // Help text — short, in the player's accent
    this.drawSetupHelp(activePlayer);

    // Lock In button
    const region = activePlayer === 1 ? this.layout.p1InBounds : this.layout.p2InBounds;
    const btn: CanvasButton = {
      label: 'Lock In',
      x: region.x + region.width / 2 - 80,
      y: region.y + region.height + 36,
      width: 160,
      height: 40,
    };
    const lockHovered = this.hoveredButton(input.hover) === 'lock_in';
    const okToLock = Math.hypot(activeSpec.vel.x, activeSpec.vel.y) >= 1;
    drawButton(ctx, btn, {
      primary: okToLock ? activeStyle.primary : palette.terracotta,
      hovered: okToLock && lockHovered,
    });
    this.buttons.set('lock_in', btn);

    if (!okToLock) {
      // Communicate why the button isn't lively — needs a velocity to launch.
      ctx.save();
      ctx.fillStyle = rgba(palette.terracotta, 0.85);
      ctx.font = `italic 500 12px ${fonts.sans}`;
      ctx.textAlign = 'center';
      ctx.fillText(
        'drag from the star to give it a direction',
        btn.x + btn.width / 2,
        btn.y + btn.height + 18,
      );
      ctx.restore();
    }
  }

  private drawSetupHelp(activePlayer: 1 | 2): void {
    const { ctx } = this;
    const x = activePlayer === 1 ? 80 : this.layout.canvas.width - 80;
    const align: CanvasTextAlign = activePlayer === 1 ? 'left' : 'right';
    ctx.save();
    ctx.font = `400 12px ${fonts.sans}`;
    ctx.fillStyle = rgba(palette.cream, 0.45);
    ctx.textAlign = align;
    const lines = [
      'DRAG OUTWARD from the star to throw it.',
      'TAP your court to reposition the star.',
      'SCROLL on the star to set mass.',
      `Max velocity ${LIMITS.maxVelocityPerBody} m/s.`,
    ];
    let y = 120;
    for (const line of lines) {
      ctx.fillText(line, x, y);
      y += 18;
    }
    ctx.restore();
  }

  private renderCountdown(input: RenderInput): void {
    const { ctx } = this;
    const { width: w, height: h } = this.layout.canvas;

    drawCourt(ctx, this.layout, {
      activePlayer: undefined,
      showInBoundsBoxes: false,
      showCenterLine: true,
    });

    // Both stars at locked positions, dimmed
    this.drawSpecStar(input.specs.p1, dimmed(STYLE_P1), input.time);
    this.drawSpecStar(input.specs.p2, dimmed(STYLE_P2), input.time);

    // Faint locked-in arrows so players can still see their setup
    drawVelocityArrow(ctx, input.specs.p1.pos, input.specs.p1.vel, palette.player1, false);
    drawVelocityArrow(ctx, input.specs.p2.pos, input.specs.p2.vel, palette.player2, false);

    // Countdown numeral
    const n = Math.max(1, Math.ceil(input.countdownRemaining));
    ctx.save();
    ctx.fillStyle = palette.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `400 160px ${fonts.serif}`;
    const pulse = 1 - (input.countdownRemaining - Math.floor(input.countdownRemaining));
    ctx.globalAlpha = 0.6 + 0.4 * (1 - pulse);
    ctx.fillText(String(n), w / 2, h / 2);
    ctx.restore();
  }

  private renderSimulate(input: RenderInput): void {
    const { ctx } = this;
    const { width: w, height: h } = this.layout.canvas;

    drawCourt(ctx, this.layout, {
      activePlayer: undefined,
      showInBoundsBoxes: false,
      showCenterLine: true,
    });

    // Analytical orbit overlay — each body's predicted ellipse around the
    // barycenter, computed from current state. Drawn under the trails so
    // a tightly-conserved orbit reads as "trail painting exactly along the
    // prediction." PEFRL keeps them coincident; if they ever diverge,
    // that's the integrator drifting.
    if (input.sim) this.drawPredictedOrbits(input.sim);

    // Trails on top of prediction so the active history takes precedence
    drawTrail(ctx, input.trails.p1, palette.player1, 0.85, 0, 2.2);
    drawTrail(ctx, input.trails.p2, palette.player2, 0.85, 0, 2.2);

    // Barycenter — the shared center of mass both stars orbit around.
    // Hide once the system has collapsed into a single remnant.
    if (input.sim && !input.supernova) this.drawBarycenter(input.sim, input.time);

    if (input.supernova) {
      // The two stars are gone — the merger event replaces them.
      this.drawSupernova(input.supernova, input.time);
    } else if (input.sim) {
      const styleA = this.dopplerTinted(STYLE_P1, input.sim.a);
      const styleB = this.dopplerTinted(STYLE_P2, input.sim.b);
      drawStar(ctx, input.sim.a.pos.x, input.sim.a.pos.y, bodyRadius(input.sim.a.mass), styleA, input.time);
      drawStar(ctx, input.sim.b.pos.x, input.sim.b.pos.y, bodyRadius(input.sim.b.mass), styleB, input.time + 1.7);
    }

    if (input.sim && input.classifier) {
      const o = input.sim.orbit();
      const boundText = o.bound ? 'BOUND' : 'UNBOUND';
      const boundColor = o.bound ? palette.cream : palette.wine;
      const eccText = Number.isFinite(o.eccentricity) ? o.eccentricity.toFixed(2) : '∞';
      const periodText = Number.isFinite(o.period) ? `${o.period.toFixed(1)} s` : '∞';
      drawHud(ctx, w, h, [
        { label: 'separation', value: `${o.separation.toFixed(0)} px`, color: palette.rose },
        { label: 'rel. speed', value: `${o.vRel.toFixed(0)} m/s`, color: palette.rose },
        { label: 'energy', value: boundText, color: boundColor },
        { label: 'ecc.', value: eccText, color: palette.cream },
        { label: 'period', value: periodText, color: palette.rose },
        { label: 'orbits', value: String(input.classifier.orbits), color: palette.cream },
        { label: 'time', value: `${input.sim.time.toFixed(1)} s`, color: palette.rose },
      ]);
    }

    drawPhaseLabel(ctx, 'in motion', w, palette.rose);
  }

  // Doppler tint — the actual mechanism by which binary stars' wobble is
  // detected from Earth. We pick a fixed observer below the canvas; each
  // body's radial velocity toward that observer warms its color toward
  // cream (approaching, "blue-shifted" in our warm palette) or wine
  // (receding, red-shifted). The orbit's geometry guarantees this tint
  // pulses sinusoidally with the orbital phase.
  private dopplerTinted(style: StarStyle, body: Body): StarStyle {
    const OBS_X = 640;
    const OBS_Y = 1500; // far below the canvas
    const REFERENCE_V = 250; // ~typical orbital speed; full tint at this radial v
    const MAX_BLEND = 0.35; // never replace the body color, just shift it

    const dx = OBS_X - body.pos.x;
    const dy = OBS_Y - body.pos.y;
    const inv = 1 / Math.hypot(dx, dy);
    const radial = (body.vel.x * dx + body.vel.y * dy) * inv;
    const shift = Math.max(-1, Math.min(1, radial / REFERENCE_V));
    const target = shift > 0 ? palette.cream : palette.wine;
    const amount = Math.abs(shift) * MAX_BLEND;
    return { ...style, primary: blendHex(style.primary, target, amount) };
  }

  // Each body traces its own ellipse around the barycenter focus. With the
  // signed angular momentum + eccentricity vector in hand, drawing the
  // prediction is just trig.
  //
  // Body 1's individual orbit: a_1 = a_rel · m_2 / M; periapsis along ω + π.
  // Body 2's individual orbit: a_2 = a_rel · m_1 / M; periapsis along ω.
  // Both share e and the barycenter focus.
  private drawPredictedOrbits(sim: Simulation): void {
    const o = sim.orbit();
    if (!o.bound || !Number.isFinite(o.semiMajorAxis)) return;
    if (o.eccentricity >= 0.999) return; // near-parabolic — ellipse degenerates

    const M = sim.a.mass + sim.b.mass;
    const bx = (sim.a.mass * sim.a.pos.x + sim.b.mass * sim.b.pos.x) / M;
    const by = (sim.a.mass * sim.a.pos.y + sim.b.mass * sim.b.pos.y) / M;

    const aRel = o.semiMajorAxis;
    const e = o.eccentricity;
    const sqrtOneMinusESq = Math.sqrt(1 - e * e);
    const omega = o.argumentOfPeriapsis;

    const a1 = aRel * (sim.b.mass / M);
    const a2 = aRel * (sim.a.mass / M);
    const b1 = a1 * sqrtOneMinusESq;
    const b2 = a2 * sqrtOneMinusESq;
    const c1 = a1 * e;
    const c2 = a2 * e;

    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);

    // Body 1 — periapsis opposite body 2 (mirror across barycenter)
    ctx.strokeStyle = rgba(palette.player1, 0.22);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(omega + Math.PI);
    ctx.beginPath();
    ctx.ellipse(-c1, 0, a1, b1, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Body 2 — periapsis along the eccentricity vector
    ctx.strokeStyle = rgba(palette.player2, 0.22);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(omega);
    ctx.beginPath();
    ctx.ellipse(-c2, 0, a2, b2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  // A small, dim glow at the shared center of mass. Pulses gently so it
  // reads as alive rather than as a UI fixture. Drawn additively so it
  // brightens cleanly when the bodies pass through it.
  private drawBarycenter(sim: Simulation, time: number): void {
    const M = sim.a.mass + sim.b.mass;
    const bx = (sim.a.mass * sim.a.pos.x + sim.b.mass * sim.b.pos.x) / M;
    const by = (sim.a.mass * sim.a.pos.y + sim.b.mass * sim.b.pos.y) / M;
    const pulse = 0.5 + 0.5 * Math.sin(time * 1.3);

    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const haloR = 18;
    const halo = ctx.createRadialGradient(bx, by, 0, bx, by, haloR);
    halo.addColorStop(0, rgba(palette.cream, 0.18 + 0.12 * pulse));
    halo.addColorStop(1, rgba(palette.cream, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(bx, by, haloR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(palette.cream, 0.55 + 0.25 * pulse);
    ctx.beginPath();
    ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Stellar merger animation. Three phases, all additive so they overlap
  // cleanly with whatever's underneath:
  //   t ∈ [0, 0.18]    flash    — bright cream radial gradient, eases out
  //   t ∈ [0.05, 2.5]  shockwave — expanding ring, fades as it grows
  //   t ∈ [0.25, ∞]    remnant   — single bright body at the merger point,
  //                                a soft pulsing glow, masses combined.
  // The flash + shock ring carry the "supernova" moment; the remnant gives
  // the card something to sit on top of when the eye returns to it.
  private drawSupernova(
    s: { x: number; y: number; elapsed: number; mergedMass: number },
    time: number,
  ): void {
    const { ctx } = this;
    const t = Math.max(0, s.elapsed);

    // Phase 1 — flash
    if (t < 0.5) {
      const k = Math.min(1, t / 0.18);
      const fade = (1 - k) ** 2;
      const r = 240 + k * 520;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, rgba(palette.cream, fade));
      g.addColorStop(0.25, rgba(palette.cream, fade * 0.55));
      g.addColorStop(1, rgba(palette.cream, 0));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Phase 2 — shockwave (two staggered rings for extra texture)
    for (const lag of [0.05, 0.32]) {
      const tt = t - lag;
      if (tt > 0 && tt < 2.5) {
        const u = tt / 2.5;
        const rr = u * 760;
        const a = (1 - u) ** 2 * 0.65;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(palette.cream, a);
        ctx.lineWidth = 3 - u * 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Phase 3 — persistent merged remnant. Combined mass → larger body;
    // primary color is a blend of P1 + P2 so the visual records what was
    // lost. Gently pulses to read as alive rather than a sticker.
    if (t > 0.25) {
      const settle = Math.min(1, (t - 0.25) / 0.6);
      const radius = bodyRadius(s.mergedMass) * (0.7 + 0.5 * settle);
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
      const blendedPrimary = blendHex(palette.player1, palette.player2, 0.5);
      const remnantStyle: StarStyle = {
        primary: blendedPrimary,
        core: palette.cream,
        haloAlpha: 0.7 + 0.25 * pulse,
        haloRadiusFactor: 3.2,
      };
      drawStar(ctx, s.x, s.y, radius, remnantStyle, time + 0.7);
    }
  }

  private renderResolved(input: RenderInput): void {
    // Always draw the underlying scene first so the card sits on top
    this.renderSimulate(input);

    if (!input.outcome) return;
    const card = drawOutcomeCard(this.ctx, input.outcome, this.layout.canvas.width, this.layout.canvas.height);

    // The merger event is the whole moment for a collision outcome — let it
    // sit ABOVE the card so the remnant stays visible behind the message.
    // (The card body is mostly opaque otherwise; redrawing the supernova
    // here punches the bright glow back through.)
    if (input.supernova) {
      this.drawSupernova(input.supernova, input.time);
    }

    const btn: CanvasButton = {
      label: 'Again',
      x: this.layout.canvas.width / 2 - 90,
      y: card.buttonY,
      width: 180,
      height: 44,
    };
    const hovered = this.hoveredButton(input.hover) === 'again';
    drawButton(this.ctx, btn, { primary: card.titleColor, hovered });
    this.buttons.set('again', btn);

    // The Carse footer — same on every outcome, drawn INSIDE the card at
    // the position drawOutcomeCard computed. The finite-game / infinite-game
    // distinction is the whole point of the game; this reminds the players
    // what they're really doing every time the AGAIN button appears.
    this.drawCarseFooter(card.carseY);
  }

  private drawCarseFooter(topY: number): void {
    const { ctx } = this;
    const w = this.layout.canvas.width;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = rgba(palette.rose, 0.55);
    ctx.font = `italic 400 12px ${fonts.serif}`;
    const lineHeight = 16;
    const lines = [
      'Remember, this is just a finite game.',
      'The real infinite game is played for its own sake',
      'and is only won by playing again and again.',
    ];
    let y = topY;
    for (const line of lines) {
      ctx.fillText(line, w / 2, y);
      y += lineHeight;
    }
    ctx.restore();
  }

  private drawSpecStar(spec: BodySpec, style: StarStyle, time: number): void {
    drawStar(
      this.ctx,
      spec.pos.x,
      spec.pos.y,
      bodyRadius(spec.mass),
      style,
      time + (spec.player === 1 ? 0 : 1.7),
    );
  }
}
