/**
 * ORBITAL ENGINEERING — entry point.
 */
import './ui/styles.css';
import { Game } from './core/Game';

function boot(): void {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui-root');

  if (!canvas || !uiRoot) {
    throw new Error('Missing #viewport or #ui-root in the document');
  }

  // A WebGL context is non-negotiable; fail with something readable rather than
  // a blank screen if the browser cannot provide one.
  const probe = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!probe) {
    uiRoot.innerHTML =
      '<div style="position:absolute;inset:0;display:grid;place-items:center;' +
      'font-family:monospace;color:#d6e4f0;text-align:center;padding:24px">' +
      '<div><div style="font-size:40px;margin-bottom:12px">🦆</div>' +
      'WebGL is not available in this browser.<br>' +
      'ORBITAL ENGINEERING needs hardware-accelerated 3D graphics.</div></div>';
    return;
  }

  const game = new Game(canvas, uiRoot);
  game.start();

  // Expose the instance for debugging without polluting module scope.
  (window as unknown as { orbital?: Game }).orbital = game;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
