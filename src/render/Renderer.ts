import { palette, fonts, rgba } from '../theme.ts';
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
    // Internal pixel buffer at design resolution; CSS may scale it visually.
    canvas.width = layout.canvas.width;
    canvas.height = layout.canvas.height;
    this.starfield = generateStarfield(layout.canvas.width, layout.canvas.height);
    this.particlesLayer = new Particles();
  }

  burst(x: number, y: number, count: number, color: string): void {
    this.particlesLayer.burst(x, y, count, color);
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

    // Trails first (under stars + barycenter)
    drawTrail(ctx, input.trails.p1, palette.player1, 0.85, 0, 2.2);
    drawTrail(ctx, input.trails.p2, palette.player2, 0.85, 0, 2.2);

    // Barycenter — the shared center of mass both stars orbit around.
    // Drawn dimly behind the stars so it doesn't compete for attention,
    // but visibly enough to make the metaphor literal: the wobble is
    // *around this point*.
    if (input.sim) this.drawBarycenter(input.sim, input.time);

    if (input.sim) {
      drawStar(ctx, input.sim.a.pos.x, input.sim.a.pos.y, bodyRadius(input.sim.a.mass), STYLE_P1, input.time);
      drawStar(ctx, input.sim.b.pos.x, input.sim.b.pos.y, bodyRadius(input.sim.b.mass), STYLE_P2, input.time + 1.7);
    }

    if (input.sim && input.classifier) {
      const o = input.sim.orbit();
      const boundText = o.bound ? 'BOUND' : 'UNBOUND';
      const boundColor = o.bound ? palette.cream : palette.wine;
      const eccText = Number.isFinite(o.eccentricity) ? o.eccentricity.toFixed(2) : '∞';
      drawHud(ctx, w, h, [
        { label: 'separation', value: `${o.separation.toFixed(0)} px`, color: palette.rose },
        { label: 'rel. speed', value: `${o.vRel.toFixed(0)} m/s`, color: palette.rose },
        { label: 'energy', value: boundText, color: boundColor },
        { label: 'ecc.', value: eccText, color: palette.cream },
        { label: 'orbits', value: String(input.classifier.orbits), color: palette.cream },
        { label: 'time', value: `${input.sim.time.toFixed(1)} s`, color: palette.rose },
      ]);
    }

    drawPhaseLabel(ctx, 'in motion', w, palette.rose);
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

  private renderResolved(input: RenderInput): void {
    // Always draw the underlying scene first so the card sits on top
    this.renderSimulate(input);

    if (!input.outcome) return;
    const card = drawOutcomeCard(this.ctx, input.outcome, this.layout.canvas.width, this.layout.canvas.height);

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
