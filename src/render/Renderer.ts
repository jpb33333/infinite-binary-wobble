import { palette, fonts, rgba, blendHex, setViewScale, cpx, lineHeightFor } from '../theme.ts';
import type { CourtLayout, BodySpec, GameStateKind } from '../game/states.ts';
import { layoutForViewport, LIMITS } from '../game/states.ts';
import {
  generateStarfield,
  drawStarfield,
  starCountForViewport,
  type StarSpec,
} from './starfield.ts';
import { drawComet } from './comet.ts';
import { computeFit, type Fit } from './fit.ts';
import { drawCourt } from './court.ts';
import {
  drawStar,
  dimmed,
  STYLE_P1,
  STYLE_P2,
  STYLE_STAR,
  STYLE_WORLD,
  type StarStyle,
} from './star.ts';
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
  drawSandboxOver,
  drawStarTooltip,
  drawWorldTooltip,
  drawWorldStatus,
  drawCloseButton,
  drawPaywallCard,
  drawTitleExplainerLink,
  drawExplainerCard,
  drawChapterCard,
  drawVisibilityMeter,
  CHAPTERS,
  type CanvasButton,
  type SandboxOutcome,
} from './overlay.ts';
import { bodyRadius } from '../physics/Body.ts';
import { showsCornerAgain } from './cornerControls.ts';
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
  // Design-space drag offset for the WIN card (0,0 = home). Lets the player
  // move the card aside to watch the wobble while keeping the live stats line.
  winCardOffset: { x: number; y: number };
  // Set when the two bodies have merged; carries the merger location,
  // wall-time elapsed since the collision, and the combined mass. The
  // Renderer uses this to animate flash → shockwave → persistent remnant
  // in place of drawing the two original bodies.
  // `transient` (three-body merges) play flash + shockwave only — the merged
  // star keeps moving, so no persistent remnant is painted at the merge point.
  supernova: { x: number; y: number; elapsed: number; mergedMass: number; transient: boolean } | null;
  // World → canvas translation applied to the simulated content (trails,
  // stars, predicted orbits, barycenter, supernova). Tracks the barycenter
  // so a drifting binary stays centred on screen — the orbit becomes
  // watch-forever instead of getting clipped off the edge. null in non-sim
  // states (no offset needed).
  cameraOffset: { x: number; y: number } | null;
  // Camera zoom about the barycenter (1 = the two-body game's fixed view; the
  // unravel eases out below 1 to keep the whole spreading system in frame).
  cameraZoom: number;
  // How the sandbox failed, or null while it runs. Drives the game-over card.
  sandboxOutcome: SandboxOutcome | null;
  placing: {
    kind: 'star' | 'planet';
    pos: { x: number; y: number } | null;
    mass: number;
    vel: { x: number; y: number } | null;
  } | null;
  starCount: number;
  planetCount: number;
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
  // Post-win three-body unravel: the live per-body tracks (each a body + its
  // trail + a render kind). The body count changes as stars merge, so the
  // renderer draws from this list rather than fixed slots. null outside the
  // unravel (the two-body sim/trails path is used then).
  unravel: { body: Body; trail: Trail; kind: string; mergedCount: number }[] | null;
  // Worlds dropped into the system, each with its live climate + life readout.
  // Empty until "Add Planet"; worlds[0] drives the
  // persistent surface panel, all are drawn + hoverable.
  worlds: {
    body: Body;
    trail: Trail;
    population: number;
    dawns: number;
    era: string;
    chaos: number;
    stable: boolean;
    driftWarn: number;
  }[];
  // Act III — the hidden hunters in the dark + the player's broadcast meter.
  // null until a thriving world wakes the forest. `systems` are at fixed
  // design-space positions around the frame; `stir` (0..1) brightens them and
  // the locked hunter pulses danger.
  darkForest: {
    visibility: number;
    threshold: number;
    locked: boolean;
    systems: { x: number; y: number; stir: number; hunter: boolean }[];
  } | null;
  // A chapter title card open (modal) over the current screen. null when none.
  chapterCard: { act: 1 | 2 | 3 } | null;
}

// A world's drawn radius (fixed — it's a planet, far lighter than any star, so
// its mass-radius would be a 2px speck).
const WORLD_DRAW_R = 5;
// Floor on a body's on-screen radius in the unravel, so nothing shrinks to a
// sub-pixel dot when the camera is zoomed all the way out (4×) to follow a
// slingshot. Applied in screen px, converted to world units by the live zoom.
const MIN_UNRAVEL_SCREEN_R = 3;
// Sandbox population cap for the HUD readout — mirrors MAX_STARS / MAX_PLANETS
// in Game.ts (kept here only for the "X/10" display).
const SANDBOX_CAP = 10;

// Pseudo-3D depth: the viewer sits VIEW_DIST in front of the z = 0 plane. A body
// nearer the viewer (z > 0) draws bigger + brighter; farther (z < 0) smaller +
// dimmer. Clamped so a body that swings deep doesn't balloon or vanish.
const VIEW_DIST = 1500;
function depthScale(z: number): number {
  return Math.min(1.8, Math.max(0.45, VIEW_DIST / (VIEW_DIST - z)));
}

// Minimum touch-target side in CSS pixels (Apple HIG 44pt). Buttons are
// drawn in design space, so at small contain-fit scales their on-screen size
// shrinks below a fingertip; hit-testing inflates each rect (centered) up to
// this floor. Visuals stay petite; taps stay reliable.
const TOUCH_TARGET_MIN_CSS = 44;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  // Swapped between DEFAULT_LAYOUT and PORTRAIT_LAYOUT on resize to match the
  // viewport's aspect. The Game compares this reference across resize() calls
  // to detect orientation changes and remap in-flight setup specs.
  private currentLayout: CourtLayout;
  private starfield: StarSpec[];
  // Atmosphere (full-bleed, screen space) vs world events (design space). The
  // ambient drift fills the whole viewport like the starfield; collision
  // bursts are positioned at design-space world coordinates, so they ride the
  // fit transform with the rest of the scene. Two layers keep the coordinate
  // systems from colliding.
  private ambientLayer: Particles;
  private burstLayer: Particles;
  // Double-buffered button registry. hoveredButton (hover styling, cursor,
  // click routing) reads the FRONT map — the last fully drawn frame — while
  // the draw pass registers this frame's rects into the BACK map, swapped in
  // at the end of render(). Hover-styling queries run mid-draw, BEFORE the
  // button being drawn has re-registered; against a single just-cleared map
  // they could never match, so the hovered state never rendered (2026-06-10
  // review). One frame of staleness is what cursor + click routing already
  // had, and button rects only move on state changes.
  private buttons: Map<string, CanvasButton> = new Map();
  private nextButtons: Map<string, CanvasButton> = new Map();
  // The WIN-card drag-handle rect, captured during renderResolved and
  // registered at the very end of the frame (after the corner controls) so it
  // loses first-match hit-testing to every real button. null when no WIN card.
  private winCardHitRect: CanvasButton | null = null;

  // The game draws in a fixed design space (layout.canvas, 1280×800) so the
  // pixel-tuned physics never shift with screen size. `fit` maps that design
  // space into the live viewport: a uniform scale plus centering offsets,
  // recomputed on every resize. `dpr` keeps the device buffer sharp. `viewW`
  // / `viewH` are the live CSS viewport size, used for the full-bleed backdrop.
  private dpr = 1;
  private fit: Fit = { scale: 1, offsetX: 0, offsetY: 0 };
  private viewW = 1;
  private viewH = 1;
  // OS-level reduced-motion preference. When set, the decorative atmosphere
  // (starfield twinkle, ambient stardust drift) goes still; gameplay motion
  // — the orbit, the arrow, the countdown — IS the content and keeps moving.
  private reducedMotion = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2D context');
    this.ctx = ctx;
    this.currentLayout = layoutForViewport(window.innerWidth, window.innerHeight);

    if (typeof window.matchMedia === 'function') {
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = mql.matches;
      mql.addEventListener('change', e => {
        this.reducedMotion = e.matches;
      });
    }

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
    // Re-pick the design space for the new aspect (landscape ↔ portrait).
    this.currentLayout = layoutForViewport(cssW, cssH);
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

  get layout(): CourtLayout {
    return this.currentLayout;
  }

  // Returns the button (in canvas-space) hovered by the pointer, if any.
  // Each rect is inflated (centered) so its on-screen size is at least
  // TOUCH_TARGET_MIN_CSS per side; ties between inflated neighbours resolve
  // by insertion order, which registers primary buttons first.
  hoveredButton(p: { x: number; y: number } | null): string | null {
    if (!p) return null;
    const minSide = TOUCH_TARGET_MIN_CSS / this.fit.scale;
    for (const [name, b] of this.buttons) {
      const padX = Math.max(0, (minSide - b.width) / 2);
      const padY = Math.max(0, (minSide - b.height) / 2);
      if (
        p.x >= b.x - padX &&
        p.x <= b.x + b.width + padX &&
        p.y >= b.y - padY &&
        p.y <= b.y + b.height + padY
      ) {
        return name;
      }
    }
    return null;
  }

  // Register a button drawn THIS frame into the back buffer; it becomes
  // hit-testable when render() publishes the swap at the end of the frame.
  private register(name: string, btn: CanvasButton): void {
    this.nextButtons.set(name, btn);
  }

  render(input: RenderInput): void {
    const { ctx } = this;

    // Feed the live contain-fit scale to the type system so sub-floor text can
    // hold the on-screen legibility floor (theme.ts cpx). Must precede any
    // drawing or text measurement this frame.
    setViewScale(this.fit.scale);

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
    // Frozen twinkle phase + no comet + no drifting motes under reduced motion.
    drawStarfield(ctx, this.starfield, this.reducedMotion ? 0 : input.time, this.viewW, this.viewH);
    if (!this.reducedMotion) drawComet(ctx, input.time, this.viewW, this.viewH);
    if (!this.reducedMotion) this.ambientLayer.ambient(this.viewW, this.viewH, input.dt);

    // ── Scene (design space via the contain-fit transform) ──
    // Pre-multiplied by DPR so all drawing below stays sharp. Every render
    // helper works in design-space (1280×800) pixels and is unaware of this.
    const m = this.dpr * this.fit.scale;
    ctx.setTransform(m, 0, 0, m, this.dpr * this.fit.offsetX, this.dpr * this.fit.offsetY);

    this.nextButtons.clear();

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

    // Register the WIN-card drag handle LAST of all buttons, so first-match
    // hit-testing lets EVERY real button win over it — including the EXIT/AGAIN
    // corner controls, which a dragged card can otherwise sit on top of and
    // shadow (a dragged card parked top-right would swallow EXIT taps). The
    // card body is only a drag target where no button is.
    if (this.winCardHitRect) {
      this.register('win_card', this.winCardHitRect);
      this.winCardHitRect = null;
    }

    // Collision debris is positioned in design space — render it with the scene.
    this.burstLayer.draw(ctx);

    // Modal chapter card sits above the whole scene (it pauses play while open).
    // Registers only its ✕ hit rect; the Game also dismisses on a tap anywhere.
    if (input.chapterCard) {
      const { width: cw, height: ch } = this.layout.canvas;
      const closeHovered = this.hoveredButton(input.hover) === 'chapter_close';
      const close = drawChapterCard(ctx, cw, ch, CHAPTERS[input.chapterCard.act], closeHovered);
      const hit = close.closeR + 9;
      this.register('chapter_close', {
        label: '',
        x: close.closeX - hit,
        y: close.closeY - hit,
        width: hit * 2,
        height: hit * 2,
      });
    }

    // Ambient motes paint last, on top, full-bleed (back to screen space) so
    // they keep the original "drifting in front" feel across the whole window.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.reducedMotion) this.ambientLayer.draw(ctx);

    // Publish this frame's button rects (back → front). Callers outside
    // render() — cursor update, pointer events — see the freshly drawn frame,
    // exactly as they did before the double buffer.
    const front = this.buttons;
    this.buttons = this.nextButtons;
    this.nextButtons = front;
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
      this.register('begin', beginBtn);

      // Free-plays meter — only when metering is on and the player hasn't paid.
      if (input.meter.enabled && !input.meter.unlocked && input.meter.remaining !== null) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = rgba(palette.cream, 0.4);
        ctx.font = `500 ${cpx(12)}px ${fonts.sans}`;
        ctx.fillText(`${Math.max(0, input.meter.remaining)} free plays left`, w / 2, h * 0.62 + 72);
        ctx.restore();
      }

      // The quiet, optional explainer affordance, centred just above BEGIN.
      // Hidden while the card is open (the card is the explainer); a
      // finger-sized hit rect is registered so taps and the hover cursor line
      // up with the text.
      const linkHovered = this.hoveredButton(input.hover) === 'explainer';
      const linkBtn = drawTitleExplainerLink(ctx, w, h, linkHovered);
      this.register('explainer', linkBtn);
    }

    // Modal explainer card, painted last so it sits above the title. Registers
    // only the ✕ dismiss hit rect (finger-sized), matching the WIN card.
    if (input.explainerOpen) {
      const closeHovered = this.hoveredButton(input.hover) === 'dismiss_explainer';
      const close = drawExplainerCard(ctx, w, h, closeHovered);
      // Hit rect tracks the (legibility-floored) disc radius + finger padding,
      // mirroring the WIN ✕ — a fixed 22 left the bigger disc poking outside it.
      const hit = close.closeR + 9;
      this.register('dismiss_explainer', {
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
    this.register('support', btn);
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
    this.register('lock_in', btn);

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
    this.register('mass_minus', massMinus);
    this.register('mass_plus', massPlus);

    if (!okToLock) {
      // Communicate why the button isn't lively — needs a velocity to launch.
      ctx.save();
      ctx.fillStyle = rgba(palette.terracotta, 0.85);
      ctx.font = `italic 500 ${cpx(12)}px ${fonts.sans}`;
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
    const portrait = this.layout.orientation === 'portrait';
    // Three lines, not four: legibility-compensated text is ~1.7× taller, and
    // the old four-line block overflowed the gap between the phase label and
    // the court's top edge in portrait (mirrors the iOS /ios-qa fix). The exit
    // affordance moves to the canvas bottom, clear of both courts.
    const lines = [
      'DRAG OUTWARD from the star to throw it.',
      'TAP your court to reposition.  − / + sets mass.',
      `Max velocity ${LIMITS.maxVelocityPerBody} px/s.`,
    ];
    ctx.save();
    ctx.font = `400 ${cpx(12)}px ${fonts.sans}`;
    ctx.fillStyle = rgba(palette.cream, 0.45);
    const lh = lineHeightFor(12); // compensated text needs a wider advance
    let x: number;
    let y: number;
    if (portrait) {
      // Centered block in the breathing room above the active player's court:
      // under the phase label for P1 (ends y=64, court at 170), just below the
      // center line for P2 (line at 640, court at 770).
      ctx.textAlign = 'center';
      x = this.layout.canvas.width / 2;
      y = activePlayer === 1 ? 94 : this.layout.centerLine.at + 32;
    } else {
      // Landscape: stacked in the active player's top corner, above the
      // court's top edge at y=200.
      ctx.textAlign = activePlayer === 1 ? 'left' : 'right';
      x = activePlayer === 1 ? 80 : this.layout.canvas.width - 80;
      y = 100;
    }
    for (const line of lines) {
      ctx.fillText(line, x, y);
      y += lh;
    }
    // Exit affordance at the canvas bottom, set apart and dimmer so the primary
    // controls don't compete with it. Names both routes — ESC for keyboards,
    // the EXIT pill for touch.
    ctx.textAlign = 'center';
    ctx.fillStyle = rgba(palette.cream, 0.3);
    ctx.font = `italic 400 ${cpx(11)}px ${fonts.sans}`;
    ctx.fillText('ESC or the EXIT pill returns to title.', this.layout.canvas.width / 2, this.layout.canvas.height - 30);
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
      // Barycenter follow + zoom about the canvas centre: world point P draws at
      // centre + (P − COM)·zoom. With zoom = 1 this is exactly the old translate.
      const cz = input.cameraZoom;
      ctx.translate(w / 2, h / 2);
      ctx.scale(cz, cz);
      ctx.translate(input.cameraOffset.x - w / 2, input.cameraOffset.y - h / 2);
    }

    if (input.unravel) {
      // Three-body unravel, rendered top-down with pseudo-3D depth: trails are
      // the flat projection of each path; the bodies are z-sorted (far first)
      // and scaled in size + brightness by depth, so they visibly pass in front
      // of and behind one another. Two-body overlays (predicted ellipses,
      // barycenter, Doppler tint) don't apply here.
      for (const t of input.unravel) {
        drawTrail(ctx, t.trail, this.trailColorForKind(t.kind), 0.85, 0, 2.2);
      }
      for (const e of input.worlds) {
        drawTrail(ctx, e.trail, palette.world, 0.7, 0, 1.6);
      }
      if (input.supernova) this.drawSupernova(input.supernova, input.time);

      const drawables = [
        ...input.unravel.map(t => ({
          z: t.body.z,
          x: t.body.pos.x,
          y: t.body.pos.y,
          r: bodyRadius(t.body.mass),
          style: this.styleForKind(t.kind),
        })),
        ...input.worlds.map(e => ({
          z: e.body.z,
          x: e.body.pos.x,
          y: e.body.pos.y,
          r: WORLD_DRAW_R,
          style: this.worldStyle(e.era),
        })),
      ];
      drawables.sort((a, b) => a.z - b.z); // far (low z) first → near drawn on top
      // Keep every body at least MIN_UNRAVEL_SCREEN_R px on screen even when the
      // camera pulls all the way back, so a slingshot world stays visible (not a
      // sub-pixel dot) right out to the ejection boundary. The draw is inside the
      // cz-scaled transform, so divide the screen floor by cz to get world units.
      const cz = input.cameraZoom;
      for (const d of drawables) {
        const ds = depthScale(d.z);
        const style = { ...d.style, haloAlpha: d.style.haloAlpha * Math.min(1.3, Math.max(0.5, ds)) };
        const r = Math.max(d.r * ds, MIN_UNRAVEL_SCREEN_R / cz);
        drawStar(ctx, d.x, d.y, r, style, input.time);
      }

      // Ejection warning: a planet drifting toward the edge gets a pulsing red
      // ring so "Lost to the dark" is telegraphed, never abrupt. Intensity rises
      // as it nears the boundary; sized ~screen-constant (÷cz) so it reads even
      // when the camera is pulled all the way out.
      const WARN_SHOW = 0.72;
      for (const e of input.worlds) {
        if (e.driftWarn <= WARN_SHOW) continue;
        const urgency = (e.driftWarn - WARN_SHOW) / (1 - WARN_SHOW);
        const pulse = 0.5 + 0.5 * Math.sin(input.time * 6);
        ctx.save();
        ctx.globalAlpha = 0.3 + 0.6 * urgency * (0.55 + 0.45 * pulse);
        ctx.strokeStyle = palette.danger;
        ctx.lineWidth = (2 + 1.5 * urgency) / cz;
        ctx.beginPath();
        ctx.arc(e.body.pos.x, e.body.pos.y, (15 + 8 * pulse) / cz, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Ghost preview of a body being Set-placed (world space, inside the camera
      // transform); min-size floored like the live bodies so it reads zoomed out.
      if (input.placing?.pos) {
        const gp = input.placing.pos;
        const baseR = input.placing.kind === 'star' ? bodyRadius(input.placing.mass) : WORLD_DRAW_R;
        const gr = Math.max(baseR, MIN_UNRAVEL_SCREEN_R / cz);
        const col = input.placing.kind === 'star' ? palette.danger : palette.world;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(gp.x, gp.y, gr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.5 / cz;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(gp.x, gp.y, gr + 7 / cz, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        // The player-settable launch velocity, drawn like the setup slingshot
        // (arrow length in world px = px/s) in the same camera transform.
        if (input.placing.kind === 'star' && input.placing.vel) {
          drawVelocityArrow(ctx, gp, input.placing.vel, palette.danger, false);
        }
      }
    } else {
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
    }

    ctx.restore();

    // Act III — the hidden systems watching from the dark, and the broadcast
    // meter. Drawn fixed (not camera-wrapped): the hunters ring the frame edge,
    // dim until your visibility stirs them; the locked one pulses danger.
    if (input.darkForest) {
      for (const s of input.darkForest.systems) this.drawHiddenSystem(s, input.time);
      drawVisibilityMeter(
        ctx,
        w,
        {
          visibility: input.darkForest.visibility,
          threshold: input.darkForest.threshold,
          locked: input.darkForest.locked,
        },
        input.time,
      );
    }

    if (input.sim && input.classifier && !input.unravel) {
      const o = input.sim.orbit();
      const boundText = o.bound ? 'BOUND' : 'UNBOUND';
      const boundColor = o.bound ? palette.cream : palette.wine;
      const eccText = Number.isFinite(o.eccentricity) ? o.eccentricity.toFixed(2) : '∞';
      const periodText = Number.isFinite(o.period) ? `${o.period.toFixed(1)} s` : '∞';
      drawHud(ctx, w, h, [
        { label: 'separation', value: `${o.separation.toFixed(0)} px`, color: palette.rose },
        { label: 'rel. speed', value: `${o.vRel.toFixed(0)} px/s`, color: palette.rose },
        { label: 'energy', value: boundText, color: boundColor },
        { label: 'ecc.', value: eccText, color: palette.cream },
        // ORBITS before PERIOD: compensated columns are wider, so the portrait
        // HUD truncates after the first few fields — and orbits is the counter
        // the win condition is ABOUT. Period + time are the sacrificial tail.
        { label: 'orbits', value: String(input.classifier.orbits), color: palette.cream },
        { label: 'period', value: periodText, color: palette.rose },
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
    // The unravel overrides everything: three bodies, no stable solution.
    if (input.unravel) phaseText = 'the three-body problem';
    const phaseColor = input.unravel ? palette.danger : palette.rose;
    drawPhaseLabel(ctx, phaseText, w, phaseColor);

    // Inspection tooltip — hover/tap a star to read its class, mass, lineage.
    this.drawHoveredStarTooltip(input);
    // Persistent surface readout for the first planet — always on, so the world's
    // fate is never hidden behind a hover on a tiny moving dot.
    if (input.worlds.length > 0) drawWorldStatus(ctx, input.worlds[0], w, h);
  }

  // If the pointer is over a star (accounting for the camera offset), draw an
  // inspection tooltip: classification, current mass, and merge lineage. Works
  // for the two-body system and the three-body unravel; buttons take priority.
  private drawHoveredStarTooltip(input: RenderInput): void {
    if (!input.hover || this.hoveredButton(input.hover)) return;
    const cam = input.cameraOffset ?? { x: 0, y: 0 };
    const z = input.cameraZoom;
    const cx = this.layout.canvas.width / 2;
    const cy = this.layout.canvas.height / 2;
    // Project a world point to screen exactly as the camera transform does
    // (barycenter follow + zoom), so the hit-test matches what's drawn.
    const projX = (wx: number): number => cx + (wx + cam.x - cx) * z;
    const projY = (wy: number): number => cy + (wy + cam.y - cy) * z;
    const HOVER_PAD = 12;

    // Planets first — their tooltip is the world readout, not a star class.
    for (const e of input.worlds) {
      const ex = projX(e.body.pos.x);
      const ey = projY(e.body.pos.y);
      const r = WORLD_DRAW_R * depthScale(e.body.z) * z;
      if (Math.hypot(input.hover.x - ex, input.hover.y - ey) <= r + HOVER_PAD) {
        const placement = ey - r < 120 ? 'below' : 'above';
        drawWorldTooltip(this.ctx, e, ex, placement === 'above' ? ey - r : ey + r, placement);
        return;
      }
    }

    let candidates: { mass: number; mergedCount: number; x: number; y: number; r: number }[] = [];
    if (input.unravel) {
      candidates = input.unravel.map(t => ({
        mass: t.body.mass,
        mergedCount: t.mergedCount,
        x: projX(t.body.pos.x),
        y: projY(t.body.pos.y),
        r: bodyRadius(t.body.mass) * depthScale(t.body.z) * z,
      }));
    } else if (input.sim && !input.supernova) {
      candidates = [input.sim.a, input.sim.b].map(b => ({
        mass: b.mass,
        mergedCount: 1,
        x: projX(b.pos.x),
        y: projY(b.pos.y),
        r: bodyRadius(b.mass) * depthScale(b.z) * z,
      }));
    }
    for (const c of candidates) {
      if (Math.hypot(input.hover.x - c.x, input.hover.y - c.y) <= c.r + HOVER_PAD) {
        const placement = c.y - c.r < 120 ? 'below' : 'above';
        drawStarTooltip(this.ctx, c.mass, c.mergedCount, c.x, placement === 'above' ? c.y - c.r : c.y + c.r, placement);
        return;
      }
    }
  }

  // Doppler tint — the actual mechanism by which binary stars' wobble is
  // detected from our vantage. We pick a fixed observer below the canvas; each
  // body's radial velocity toward that observer warms its color toward
  // cream (approaching, "blue-shifted" in our warm palette) or wine
  // (receding, red-shifted). The orbit's geometry guarantees this tint
  // pulses sinusoidally with the orbital phase.
  private dopplerTinted(style: StarStyle, body: Body): StarStyle {
    // Observer sits far below the canvas, centred — derived from the layout
    // so the tint geometry is sane in both landscape and portrait spaces.
    const OBS_X = this.layout.canvas.width / 2;
    const OBS_Y = this.layout.canvas.height + 700;
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

  // Render style for an unravel track by kind. The merged remnant is a
  // cream-cored fusion of the two player colors (it records what was lost),
  // pulsing a touch larger so it reads as the heavier body.
  private styleForKind(kind: string): StarStyle {
    switch (kind) {
      case 'p1':
        return STYLE_P1;
      case 'p2':
        return STYLE_P2;
      case 'star':
        return STYLE_STAR;
      default:
        return {
          primary: blendHex(palette.player1, palette.player2, 0.5),
          core: palette.cream,
          haloAlpha: 0.9,
          haloRadiusFactor: 3.0,
        };
    }
  }

  // The world, tinted by its climate so its state reads at a glance: red-hot when
  // scorching, dim/cold when frozen, pale blue when temperate.
  // A civilization hidden in the dark (Act III): a small cold point, dim until
  // the player's broadcast stirs it (stir → brighter), the locked hunter pulsing
  // danger-red. Drawn additively so it glows against the void like a far star.
  private drawHiddenSystem(
    s: { x: number; y: number; stir: number; hunter: boolean },
    time: number,
  ): void {
    const ctx = this.ctx;
    const pulse = 0.6 + 0.4 * Math.sin(time * 8);
    const alpha = s.hunter ? pulse : 0.16 + 0.5 * s.stir;
    const color = s.hunter ? palette.danger : blendHex(palette.hunter, palette.danger, s.stir * 0.5);
    const r = 3 + 3 * s.stir + (s.hunter ? 2 : 0);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(s.x - r * 3, s.y - r * 3, r * 6, r * 6);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fillStyle = rgba(color, Math.min(1, alpha + 0.2));
    ctx.fill();
    ctx.restore();
  }

  private worldStyle(era: string): StarStyle {
    if (era === 'scorching') {
      return { ...STYLE_WORLD, primary: blendHex(palette.world, palette.danger, 0.6) };
    }
    if (era === 'frozen') {
      return { ...STYLE_WORLD, primary: blendHex(palette.world, palette.voidDeep, 0.4), haloAlpha: 0.5 };
    }
    return STYLE_WORLD;
  }

  private trailColorForKind(kind: string): string {
    switch (kind) {
      case 'p1':
        return palette.player1;
      case 'p2':
        return palette.player2;
      default:
        return palette.cream;
    }
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
    s: { x: number; y: number; elapsed: number; mergedMass: number; transient: boolean },
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

    // Phase 3 — persistent merged remnant. Skipped for a transient (three-body
    // merge) flash: there the merged star is a live body that keeps moving, so
    // a fixed remnant here would ghost a second star at the merge point.
    // Combined mass → larger body;
    // primary color is a blend of P1 + P2 so the visual records what was
    // lost. Gently pulses to read as alive rather than a sticker.
    if (t > 0.25 && !s.transient) {
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
        return `${t.toFixed(1)}s${sep}${o.vRel.toFixed(0)} px/s at impact`;
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
    this.register('to_title', exitBtn);

    if (
      showsCornerAgain({
        state: input.state,
        sandboxOutcome: input.sandboxOutcome,
        unravel: !!input.unravel,
        outcomeKind: input.outcome?.kind ?? null,
        winCardDismissed: input.winCardDismissed,
      })
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
      this.register('again', againBtn);
    }

    // Top-left sandbox controls — repeatable: keep feeding the problem until it
    // collapses. A star is a disruptor (danger red); a planet is a victim
    // (world blue) whose life rides the chaos.
    if (
      input.state === 'resolved' &&
      (input.outcome?.kind === 'win' || input.unravel) &&
      !input.sandboxOutcome
    ) {
      if (input.placing) {
        this.drawPlacementControls(input);
      } else {
        const bw = 150;
        const x2 = 16 + bw + 8;
        const row2 = top + pillH + 10;
        const starSet: CanvasButton = { label: 'Set Star', x: 16, y: top, width: bw, height: pillH };
        const starRnd: CanvasButton = { label: 'Random Star', x: x2, y: top, width: bw, height: pillH };
        drawButton(ctx, starSet, { primary: palette.danger, hovered: hoveredName === 'set_star' });
        drawButton(ctx, starRnd, { primary: palette.danger, hovered: hoveredName === 'random_star' });
        this.register('set_star', starSet);
        this.register('random_star', starRnd);
        const planetSet: CanvasButton = { label: 'Set Planet', x: 16, y: row2, width: bw, height: pillH };
        const planetRnd: CanvasButton = { label: 'Random Planet', x: x2, y: row2, width: bw, height: pillH };
        drawButton(ctx, planetSet, {
          primary: palette.world,
          text: palette.voidDeep,
          hovered: hoveredName === 'set_planet',
        });
        drawButton(ctx, planetRnd, {
          primary: palette.world,
          text: palette.voidDeep,
          hovered: hoveredName === 'random_planet',
        });
        this.register('set_planet', planetSet);
        this.register('random_planet', planetRnd);
        ctx.save();
        ctx.textAlign = 'left';
        ctx.fillStyle = rgba(palette.cream, 0.5);
        ctx.font = `italic 400 ${cpx(11)}px ${fonts.serif}`;
        ctx.fillText(
          `Set drops it where you tap.  Stars ${input.starCount}/${SANDBOX_CAP} · Planets ${input.planetCount}/${SANDBOX_CAP}.`,
          16,
          row2 + pillH + 16,
        );
        ctx.restore();
      }
    }
  }

  // The "Set" placement HUD (top-left), shown while a body is being dropped: a
  // hint, +/- mass for a star, and Launch (once a spot is tapped) / Cancel. The
  // ghost preview itself is drawn in renderSimulate (world space).
  private drawPlacementControls(input: RenderInput): void {
    const pl = input.placing;
    if (!pl) return;
    const { ctx } = this;
    const top = 14;
    const hoveredName = this.hoveredButton(input.hover);
    const kind = pl.kind;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.fillStyle = rgba(palette.cream, 0.7);
    ctx.font = `500 ${cpx(12)}px ${fonts.sans}`;
    ctx.fillText(
      pl.pos
        ? kind === 'star'
          ? `Tap to move · drag the star to aim · LAUNCH`
          : `Tap to move it · LAUNCH to drop the ${kind}`
        : `Tap the field to place the ${kind}`,
      16,
      top + 8,
    );
    ctx.restore();

    let y = top + 26;
    if (kind === 'star') {
      const pill = 40;
      const minus: CanvasButton = { label: '−', x: 16, y, width: pill, height: pill };
      const plus: CanvasButton = { label: '+', x: 16 + pill + 84, y, width: pill, height: pill };
      drawButton(ctx, minus, { primary: palette.danger, hovered: hoveredName === 'place_mass_minus' });
      drawButton(ctx, plus, { primary: palette.danger, hovered: hoveredName === 'place_mass_plus' });
      this.register('place_mass_minus', minus);
      this.register('place_mass_plus', plus);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = palette.cream;
      ctx.font = `400 ${cpx(15)}px ${fonts.serif}`;
      ctx.fillText(`mass ${pl.mass.toFixed(1)}`, 16 + pill + 42, y + pill / 2);
      ctx.restore();
      y += pill + 12;
    }

    // Live velocity readout for a Set star, so its aim reads like the setup HUD.
    if (kind === 'star' && pl.pos && pl.vel) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.fillStyle = rgba(palette.cream, 0.7);
      ctx.font = `400 ${cpx(12)}px ${fonts.sans}`;
      ctx.fillText(`velocity ${Math.round(Math.hypot(pl.vel.x, pl.vel.y))} px/s`, 16, y + 4);
      ctx.restore();
      y += 22;
    }

    const bw = 110;
    const bh = 44;
    if (pl.pos) {
      const launch: CanvasButton = { label: 'Launch', x: 16, y, width: bw, height: bh };
      drawButton(ctx, launch, {
        primary: kind === 'star' ? palette.danger : palette.world,
        hovered: hoveredName === 'place_launch',
      });
      this.register('place_launch', launch);
    }
    const cancel: CanvasButton = { label: 'Cancel', x: pl.pos ? 16 + bw + 8 : 16, y, width: bw, height: bh };
    drawButton(ctx, cancel, { primary: palette.terracotta, hovered: hoveredName === 'place_cancel' });
    this.register('place_cancel', cancel);
  }

  private renderResolved(input: RenderInput): void {
    // Always draw the underlying scene first so the card sits on top
    this.renderSimulate(input);

    if (!input.outcome) return;

    // The sandbox failed — collapse (black hole) or extinction. Game-over card.
    if (input.sandboxOutcome) {
      const over = drawSandboxOver(
        this.ctx,
        input.sandboxOutcome,
        this.layout.canvas.width,
        this.layout.canvas.height,
      );
      const btn: CanvasButton = {
        label: 'Again',
        x: over.x + over.width / 2 - 90,
        y: over.buttonY,
        width: 180,
        height: 44,
      };
      drawButton(this.ctx, btn, {
        primary: over.titleColor,
        hovered: this.hoveredButton(input.hover) === 'again',
      });
      this.register('again', btn);
      return;
    }

    // The three-body unravel otherwise runs forever, like the WIN it grew from —
    // no card; renderSimulate painted the scene + the EXIT/AGAIN corner cluster
    // (drawCornerControls) is the way out.
    if (input.unravel) return;

    // Player tapped the ✕ on a WIN card: leave the wobble unobstructed. The
    // orbit keeps advancing in update(); AGAIN/EXIT live in the corner cluster.
    if (input.outcome.kind === 'win' && input.winCardDismissed) return;
    const statsLine = this.formatPlayStats(input);
    // WIN cards ride the drag offset; LOSE cards are fixed (sim is frozen).
    const offset = input.outcome.kind === 'win' ? input.winCardOffset : { x: 0, y: 0 };
    const card = drawOutcomeCard(
      this.ctx,
      input.outcome,
      this.layout.canvas.width,
      this.layout.canvas.height,
      statsLine,
      offset,
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
      x: card.x + card.width / 2 - 90,
      y: card.buttonY,
      width: 180,
      height: 44,
    };
    const hovered = this.hoveredButton(input.hover) === 'again';
    drawButton(this.ctx, btn, { primary: card.titleColor, hovered });
    this.register('again', btn);

    // WIN cards get a ✕ in their top-right corner: tap to dismiss the card and
    // watch the infinite wobble unobstructed. The disc is legibility-floored
    // (a ~6px speck at phone scale otherwise) and the hit rect is finger-sized.
    if (input.outcome.kind === 'win') {
      const closeR = cpx(13);
      const ccx = card.x + card.width - closeR - 13;
      const ccy = card.y + closeR + 13;
      const closeHovered = this.hoveredButton(input.hover) === 'dismiss_win';
      drawCloseButton(this.ctx, ccx, ccy, closeR, card.titleColor, closeHovered);
      const hit = closeR + 9;
      this.register('dismiss_win', {
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
    this.drawCarseFooter(card.carseY, card.x + card.width / 2);

    // (The "disturb it" controls — Add Star / Add Planet — live in the
    // top-left corner cluster now, repeatable; see drawCornerControls.)

    // The whole WIN card is a drag handle. Captured here, registered at the
    // END of render() (after the corner controls) so first-match hit-testing
    // lets AGAIN, ✕, AND the EXIT/AGAIN corner pills all win over it. A drag
    // only starts on bare card body where no button sits.
    if (input.outcome.kind === 'win') {
      this.winCardHitRect = {
        label: '',
        x: card.x,
        y: card.y,
        width: card.width,
        height: card.height,
      };
    }
  }

  private drawCarseFooter(topY: number, centerX: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = rgba(palette.rose, 0.55);
    ctx.font = `italic 400 ${cpx(12)}px ${fonts.serif}`;
    const lineHeight = lineHeightFor(12); // compensated text needs a wider advance
    const lines = [
      'Remember, this is just a finite game.',
      'The real infinite game is played for its own sake',
      'and is only won by playing again and again.',
    ];
    let y = topY;
    for (const line of lines) {
      ctx.fillText(line, centerX, y);
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
