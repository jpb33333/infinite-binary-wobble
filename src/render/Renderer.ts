import { palette, fonts, rgba, blendHex } from '../theme.ts';
import type { CourtLayout, BodySpec, GameStateKind } from '../game/states.ts';
import { DEFAULT_LAYOUT, LIMITS } from '../game/states.ts';
import {
  generateStarfield,
  drawStarfield,
  starCountForViewport,
  type StarSpec,
} from './starfield.ts';
import { computeFit, type Fit } from './fit.ts';
import { drawCourt } from './court.ts';
import { drawStar, dimmed, STYLE_P1, STYLE_P2, type StarStyle } from './star.ts';
import { Trail, drawTrail } from './trail.ts';
import { Particles } from './particles.ts';
import { drawVelocityArrow } from './arrow.ts';
import {
  drawWordmark,
  drawSessionStats,
  drawPhaseLabel,
  drawHud,
  drawButton,
  drawTooltip,
  drawOutcomeCard,
  drawCloseButton,
  drawPaywallCard,
  drawTitleExplainerLink,
  drawExplainerCard,
  type CanvasButton,
} from './overlay.ts';
import { bodyRadius } from '../physics/Body.ts';
import type { Body } from '../physics/Body.ts';
import type { Simulation } from '../physics/Simulation.ts';
import type { OutcomeClassifier, Outcome } from '../game/outcomes.ts';
import type { MeterView } from '../net/meter.ts';

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
  // True once the player has dismissed the WIN card (tapped its ✕). The card
  // and its AGAIN button are then suppressed so the orbit fills the screen;
  // AGAIN reappears in the top-right control cluster instead.
  winCardDismissed: boolean;
  // Set when the two bodies have merged; carries the merger location,
  // wall-time elapsed since the collision, and the combined mass. The
  // Renderer uses this to animate flash → shockwave → persistent remnant
  // in place of drawing the two original bodies.
  supernova: { x: number; y: number; elapsed: number; mergedMass: number } | null;
  // World → canvas translation applied to the simulated content (trails,
  // stars, predicted orbits, barycenter, supernova). Tracks the barycenter
  // so a drifting binary stays centred on screen — the orbit becomes
  // watch-forever instead of getting clipped off the edge. null in non-sim
  // states (no offset needed).
  cameraOffset: { x: number; y: number } | null;
  // Per-session scoreboard rendered on the title screen and (briefly) above
  // the AGAIN button on each resolve. The Game owns the cookie; the Renderer
  // just paints the summary.
  stats: import('../game/stats.ts').StatsSummary;
  // Web metering view (paywall + free-plays meter). enabled=false → inert.
  meter: MeterView;
  // True while the optional "what is a binary star?" explainer card is open
  // over the title screen. Modal: BEGIN is suppressed underneath so the card
  // owns the input. Only ever true in the 'title' state.
  explainerOpen: boolean;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly layout: CourtLayout;
  private starfield: StarSpec[];
  // Atmosphere (full-bleed, screen space) vs world events (design space). The
  // ambient drift fills the whole viewport like the starfield; collision
  // bursts are positioned at design-space world coordinates, so they ride the
  // fit transform with the rest of the scene. Two layers keep the coordinate
  // systems from colliding.
  private ambientLayer: Particles;
  private burstLayer: Particles;
  readonly buttons: Map<string, CanvasButton> = new Map();

  // The game draws in a fixed design space (layout.canvas, 1280×800) so the
  // pixel-tuned physics never shift with screen size. `fit` maps that design
  // space into the live viewport: a uniform scale plus centering offsets,
  // recomputed on every resize. `dpr` keeps the device buffer sharp. `viewW`
  // / `viewH` are the live CSS viewport size, used for the full-bleed backdrop.
  private dpr = 1;
  private fit: Fit = { scale: 1, offsetX: 0, offsetY: 0 };
  private viewW = 1;
  private viewH = 1;

  constructor(canvas: HTMLCanvasElement, layout: CourtLayout = DEFAULT_LAYOUT) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2D context');
    this.ctx = ctx;
    this.layout = layout;

    this.starfield = [];
    this.ambientLayer = new Particles();
    this.burstLayer = new Particles();

    // Size the device buffer to the current viewport (this also seeds the
    // starfield for the viewport). render() applies transforms every frame, so
    // no persistent ctx.scale() is needed here.
    this.resize(window.innerWidth, window.innerHeight);
  }

  // Resize the device buffer to fill the given CSS viewport, recompute the
  // contain-fit transform, and re-seed the full-bleed starfield to the new
  // size. devicePixelRatio is re-read each call so dragging the window between
  // a retina laptop and an external monitor stays sharp.
  resize(cssW: number, cssH: number): void {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.viewW = cssW;
    this.viewH = cssH;
    const { width: dw, height: dh } = this.layout.canvas;
    this.fit = computeFit(cssW, cssH, dw, dh);
    // Re-seed the starfield at the density the new viewport calls for. The
    // generator is deterministic and order-stable, so existing stars keep
    // their normalized positions — the field reflows, it doesn't reshuffle.
    this.starfield = generateStarfield(starCountForViewport(cssW, cssH));
    // Setting width/height resets all context state; render() re-establishes
    // the transform each frame, so that's fine.
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  // Map a browser pointer event to design-space (logical) coordinates,
  // inverting the uniform contain-fit (and its centering offsets). Used by
  // every hit test so controls line up with what's drawn at any window size.
  screenToLogical(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const xCss = event.clientX - rect.left;
    const yCss = event.clientY - rect.top;
    return {
      x: (xCss - this.fit.offsetX) / this.fit.scale,
      y: (yCss - this.fit.offsetY) / this.fit.scale,
    };
  }

  burst(x: number, y: number, count: number, color: string, speed?: number): void {
    // Bursts are world events at design-space coordinates — they render with
    // the scene under the fit transform, not as full-bleed atmosphere.
    this.burstLayer.burst(x, y, count, color, speed);
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

    // ── Full-bleed backdrop (screen space) ──
    // Void fills the entire raw buffer — court area and letterbox margins
    // alike, with no seam at the fit-rect edge.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.voidDeep;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Starfield + ambient drift cover the whole viewport (CSS-pixel space,
    // scaled by DPR only — no fit transform), so the atmosphere bleeds to
    // every edge regardless of the letterbox.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawStarfield(ctx, this.starfield, input.time, this.viewW, this.viewH);
    this.ambientLayer.ambient(this.viewW, this.viewH, input.dt);

    // ── Scene (design space via the contain-fit transform) ──
    // Pre-multiplied by DPR so all drawing below stays sharp. Every render
    // helper works in design-space (1280×800) pixels and is unaware of this.
    const m = this.dpr * this.fit.scale;
    ctx.setTransform(m, 0, 0, m, this.dpr * this.fit.offsetX, this.dpr * this.fit.offsetY);

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
      case 'paywall':
        this.renderPaywall(input);
        break;
    }

    // Persistent corner controls (touch-friendly ESC + post-dismiss AGAIN).
    // Drawn after the per-state scene so they always sit on top, but still in
    // design space (before we drop back to screen space for the motes).
    if (input.state !== 'title') this.drawCornerControls(input);

    // Collision debris is positioned in design space — render it with the scene.
    this.burstLayer.draw(ctx);

    // Ambient motes paint last, on top, full-bleed (back to screen space) so
    // they keep the original "drifting in front" feel across the whole window.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ambientLayer.draw(ctx);
  }

  // ─────────────────────────────────────────────────────────────── states

  private renderTitle(input: RenderInput): void {
    const { ctx } = this;
    const { width: w, height: h } = this.layout.canvas;

    drawWordmark(ctx, w, h);
    drawSessionStats(ctx, input.stats, w, h);

    // BEGIN is suppressed while the explainer is open: not drawn and, crucially,
    // not registered as a button — so the modal card truly owns all input.
    if (!input.explainerOpen) {
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

      // Free-plays meter — only when metering is on and the player hasn't paid.
      if (input.meter.enabled && !input.meter.unlocked && input.meter.remaining !== null) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = rgba(palette.cream, 0.4);
        ctx.font = `500 12px ${fonts.sans}`;
        ctx.fillText(`${Math.max(0, input.meter.remaining)} free plays left`, w / 2, h * 0.62 + 72);
        ctx.restore();
      }

      // The quiet, optional explainer affordance. Hidden while the card is open
      // (the card is the explainer); a finger-sized hit rect is registered so
      // taps and the hover cursor line up with the text.
      const linkHovered = this.hoveredButton(input.hover) === 'explainer';
      const linkBtn = drawTitleExplainerLink(ctx, w, linkHovered);
      this.buttons.set('explainer', linkBtn);
    }

    // Modal explainer card, painted last so it sits above the title. Registers
    // only the ✕ dismiss hit rect (finger-sized), matching the WIN card.
    if (input.explainerOpen) {
      const closeHovered = this.hoveredButton(input.hover) === 'dismiss_explainer';
      const close = drawExplainerCard(ctx, w, h, closeHovered);
      const hit = 22;
      this.buttons.set('dismiss_explainer', {
        label: '',
        x: close.closeX - hit,
        y: close.closeY - hit,
        width: hit * 2,
        height: hit * 2,
      });
    }
  }

  private renderPaywall(input: RenderInput): void {
    const { ctx } = this;
    const { width: w, height: h } = this.layout.canvas;
    const card = drawPaywallCard(ctx, w, h, input.meter);
    const btn: CanvasButton = {
      label: 'Support & Continue',
      x: w / 2 - 130,
      y: card.buttonY,
      width: 260,
      height: 46,
    };
    const hovered = this.hoveredButton(input.hover) === 'support';
    drawButton(ctx, btn, { primary: palette.cream, hovered });
    this.buttons.set('support', btn);
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
      `mass ${activeSpec.mass.toFixed(1)}`,
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
    const hoveredName = this.hoveredButton(input.hover);
    const okToLock = Math.hypot(activeSpec.vel.x, activeSpec.vel.y) >= 1;
    drawButton(ctx, btn, {
      primary: okToLock ? activeStyle.primary : palette.terracotta,
      hovered: okToLock && hoveredName === 'lock_in',
    });
    this.buttons.set('lock_in', btn);

    // Touch-friendly mass control. Pill buttons on either side of the LOCK
    // IN button — large enough to tap with a finger, in the active player's
    // accent. Desktop users still have the scroll wheel; phone users get
    // these. Buttons fit in the lock-in row so they don't compete with the
    // star or the predicted-orbit area.
    const massBtnSize = 40;
    const massBtnGap = 18;
    const massMinus: CanvasButton = {
      label: '−',
      x: btn.x - massBtnSize - massBtnGap,
      y: btn.y + (btn.height - massBtnSize) / 2,
      width: massBtnSize,
      height: massBtnSize,
    };
    const massPlus: CanvasButton = {
      label: '+',
      x: btn.x + btn.width + massBtnGap,
      y: btn.y + (btn.height - massBtnSize) / 2,
      width: massBtnSize,
      height: massBtnSize,
    };
    drawButton(ctx, massMinus, {
      primary: activeStyle.primary,
      hovered: hoveredName === 'mass_minus',
    });
    drawButton(ctx, massPlus, {
      primary: activeStyle.primary,
      hovered: hoveredName === 'mass_plus',
    });
    this.buttons.set('mass_minus', massMinus);
    this.buttons.set('mass_plus', massPlus);

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
      'TAP − or + to set mass.',
      `Max velocity ${LIMITS.maxVelocityPerBody} m/s.`,
    ];
    // Stack the help block so everything (including the ESC affordance below)
    // sits above the court's top edge at y=200.
    let y = 100;
    for (const line of lines) {
      ctx.fillText(line, x, y);
      y += 18;
    }
    // ESC affordance, set apart by a blank line and dimmer alpha so the
    // primary controls don't compete with it. Only surfaced during setup —
    // by the time the player reaches countdown / sim they already know.
    y += 8;
    ctx.fillStyle = rgba(palette.cream, 0.3);
    ctx.font = `italic 400 11px ${fonts.sans}`;
    ctx.fillText('Press ESC to return to title.', x, y);
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

    // World → canvas translation. Everything that "belongs to the system"
    // — trails, predicted orbits, barycenter dot, the two stars or the
    // merger remnant — is drawn inside this transform so the barycenter
    // appears at the canvas centre no matter where the system has drifted.
    // The court, starfield and HUD stay canvas-fixed.
    ctx.save();
    if (input.cameraOffset) {
      ctx.translate(input.cameraOffset.x, input.cameraOffset.y);
    }

    if (input.sim) this.drawPredictedOrbits(input.sim);
    drawTrail(ctx, input.trails.p1, palette.player1, 0.85, 0, 2.2);
    drawTrail(ctx, input.trails.p2, palette.player2, 0.85, 0, 2.2);
    if (input.sim && !input.supernova) this.drawBarycenter(input.sim, input.time);

    if (input.supernova) {
      this.drawSupernova(input.supernova, input.time);
    } else if (input.sim) {
      const styleA = this.dopplerTinted(STYLE_P1, input.sim.a);
      const styleB = this.dopplerTinted(STYLE_P2, input.sim.b);
      drawStar(ctx, input.sim.a.pos.x, input.sim.a.pos.y, bodyRadius(input.sim.a.mass), styleA, input.time);
      drawStar(ctx, input.sim.b.pos.x, input.sim.b.pos.y, bodyRadius(input.sim.b.mass), styleB, input.time + 1.7);
    }

    ctx.restore();

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

    // Phase label echoes the actual state of the system. WIN keeps the orbit
    // alive so 'in motion' stays honest; LOSE outcomes freeze the bodies, so
    // 'in motion' would lie. Match each frozen outcome to a one-word reading.
    let phaseText = 'in motion';
    if (input.state === 'resolved' && input.outcome) {
      switch (input.outcome.kind) {
        case 'lose_escape':
        case 'lose_slingshot':
          phaseText = 'drifting';
          break;
        case 'lose_collision':
          phaseText = 'stilled';
          break;
      }
    }
    drawPhaseLabel(ctx, phaseText, w, palette.rose);
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

  // Per-play stats rendered on the resolved card. Reads live sim metrics so
  // WIN reads continue to tick (orbit count grows as long as the wobble does);
  // LOSE outcomes are frozen so the live values equal the resolution snapshot.
  private formatPlayStats(input: RenderInput): string | null {
    if (!input.sim || !input.outcome) return null;
    const o = input.sim.orbit();
    const t = input.sim.time;
    const orbits = input.classifier?.orbits ?? 0;
    const eccTxt = Number.isFinite(o.eccentricity) ? o.eccentricity.toFixed(2) : '∞';
    const sep = '  ·  ';
    switch (input.outcome.kind) {
      case 'win': {
        const orbitsTxt = `${orbits} ${orbits === 1 ? 'orbit' : 'orbits'}`;
        return `${t.toFixed(0)}s${sep}${orbitsTxt}${sep}ecc ${eccTxt}`;
      }
      case 'lose_escape':
      case 'lose_slingshot':
        return `${t.toFixed(1)}s${sep}ecc ${eccTxt}`;
      case 'lose_collision':
        return `${t.toFixed(1)}s${sep}${o.vRel.toFixed(0)} m/s at impact`;
      default:
        return null;
    }
  }

  // Top-right control cluster, shown in every non-title state. The EXIT pill
  // is the on-screen counterpart of the ESC key (the only way back to title
  // for touch players). Once a WIN card has been dismissed, AGAIN joins it
  // here so restarting stays one tap away without re-cluttering the orbit.
  private drawCornerControls(input: RenderInput): void {
    const { ctx } = this;
    const w = this.layout.canvas.width;
    const pillH = 44;
    const top = 14;
    const rightMargin = 16;
    const hoveredName = this.hoveredButton(input.hover);

    const exitW = 96;
    const exitBtn: CanvasButton = {
      label: 'Exit',
      x: w - rightMargin - exitW,
      y: top,
      width: exitW,
      height: pillH,
    };
    drawButton(ctx, exitBtn, {
      primary: palette.terracotta,
      hovered: hoveredName === 'to_title',
    });
    this.buttons.set('to_title', exitBtn);

    if (
      input.state === 'resolved' &&
      input.outcome?.kind === 'win' &&
      input.winCardDismissed
    ) {
      const againW = 110;
      const againBtn: CanvasButton = {
        label: 'Again',
        x: exitBtn.x - 12 - againW,
        y: top,
        width: againW,
        height: pillH,
      };
      drawButton(ctx, againBtn, {
        primary: palette.cream,
        hovered: hoveredName === 'again',
      });
      this.buttons.set('again', againBtn);
    }
  }

  private renderResolved(input: RenderInput): void {
    // Always draw the underlying scene first so the card sits on top
    this.renderSimulate(input);

    if (!input.outcome) return;
    // Player tapped the ✕ on a WIN card: leave the wobble unobstructed. The
    // orbit keeps advancing in update(); AGAIN/EXIT live in the corner cluster.
    if (input.outcome.kind === 'win' && input.winCardDismissed) return;
    const statsLine = this.formatPlayStats(input);
    const card = drawOutcomeCard(
      this.ctx,
      input.outcome,
      this.layout.canvas.width,
      this.layout.canvas.height,
      statsLine,
    );

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

    // WIN cards get a ✕ in their top-right corner: tap to dismiss the card and
    // watch the infinite wobble unobstructed. The visible disc is small, but
    // the hit rectangle is finger-sized (40px) for touch.
    if (input.outcome.kind === 'win') {
      const closeR = 13;
      const ccx = card.x + card.width - 26;
      const ccy = card.y + 26;
      const closeHovered = this.hoveredButton(input.hover) === 'dismiss_win';
      drawCloseButton(this.ctx, ccx, ccy, closeR, card.titleColor, closeHovered);
      const hit = 20;
      this.buttons.set('dismiss_win', {
        label: '',
        x: ccx - hit,
        y: ccy - hit,
        width: hit * 2,
        height: hit * 2,
      });
    }

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
