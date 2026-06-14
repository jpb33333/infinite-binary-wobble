import './style.css';
import { Game } from './game/Game.ts';

// Frame-busting. `frame-ancestors` in the CSP meta tag is ignored by the
// browser (header-only directive), so we defend in JS: if we've been
// embedded in someone else's iframe, redirect the top-level page to our
// canonical URL. Cross-origin tops throw on access — fall back to a
// visible refusal so the visitor at least sees something honest.
if (window.top !== window.self) {
  try {
    window.top!.location.href = window.self.location.href;
  } catch {
    // Build the refusal with DOM APIs (no innerHTML, no inline styles) so the
    // page needs no 'unsafe-inline' in its CSP and stays Trusted-Types-safe.
    const notice = document.createElement('p');
    notice.className = 'iframe-refusal';
    notice.append('Infinite Binary Wobble does not run inside iframes. Open it at ');
    const link = document.createElement('a');
    link.href = 'https://jpb33333.github.io/infinite-binary-wobble/';
    link.textContent = 'its own URL';
    notice.append(link, '.');
    document.body.replaceChildren(notice);
    throw new Error('Refused to run inside a cross-origin iframe');
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (!canvas) throw new Error('Stage canvas not found in index.html');

// Homepage copyright signature. The game is canvas-drawn, so this is a DOM
// overlay pinned to the bottom of the viewport (styled in style.css, shown only
// on the title screen). Built with DOM APIs — no innerHTML, no inline styles —
// so the page needs no 'unsafe-inline' in its CSP and stays Trusted-Types-safe,
// just like the iframe-refusal notice above. Appended after the frame-buster so
// it is never created inside a refused iframe (that path replaces the body).
const dedication = document.createElement('footer');
dedication.className = 'dedication';
const copyright = document.createElement('p');
copyright.className = 'dedication__copyright';
copyright.textContent = '© Gamerboygirl Gaming 2026';
dedication.append(copyright);
document.body.append(dedication);

const game = new Game(canvas);
game.start();
