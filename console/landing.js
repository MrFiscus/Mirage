const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>';

document.querySelector("#landing").innerHTML = `
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="Mirage home">Mirage.</a>
    <nav class="site-nav" aria-label="Main navigation">
      <button class="motion-toggle" id="motion-toggle" type="button" aria-label="Pause animation" aria-pressed="false" title="Pause animation"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M7 5v10M13 5v10"/></svg></button>
    </nav>
  </header>

  <main class="hero" id="main">
    <div class="hero-copy">
      <h1>Let them wander.<br /><span>Keep the boundary.</span></h1>
      <p class="hero-description">When an agent steps outside its scope, Mirage redirects it into a world of decoys. Watch every move. Stay in control.</p>
      <div class="hero-actions">
        <a class="primary-link" href="/fleet.html">Enter the sandbox ${arrow}</a>
        <a class="primary-link outline-link" href="/how-it-works.html">How it works ${arrow}</a>
      </div>
    </div>

    <div class="world" aria-hidden="true">
      <div class="world-orbit orbit-outer"></div>
      <div class="world-orbit orbit-inner"></div>
      <div class="world-disc"><span class="world-signal"><span class="world-signal-runner"><i></i></span></span><span class="world-core"><svg class="world-watcher" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 32s9-15 23-15 23 15 23 15-9 15-23 15S9 32 9 32Z"/><circle class="world-watcher-pupil" cx="32" cy="32" r="6"/></svg></span><span class="world-caption">A WORLD WITHIN REACH.<br />ALWAYS OUT OF SCOPE.</span></div>
      <div class="world-agent-track"><span class="world-bot"><svg viewBox="0 0 64 64" fill="none"><path d="M32 9v8" stroke="#e0e0e0" stroke-width="2.5" stroke-linecap="round"/><circle cx="32" cy="7" r="3" fill="#e0e0e0"/><rect x="6" y="28" width="5" height="15" rx="2.5" fill="#a4a4a7"/><rect x="53" y="28" width="5" height="15" rx="2.5" fill="#a4a4a7"/><rect x="11" y="17" width="42" height="37" rx="11" fill="#e0e0e0"/><rect x="17" y="24" width="30" height="19" rx="6" fill="#18181b"/><g class="world-bot-eyes" fill="#e0e0e0"><rect x="23" y="29" width="4" height="8" rx="2"/><rect x="37" y="29" width="4" height="8" rx="2"/></g><path d="M28 48h8" stroke="#737379" stroke-width="2" stroke-linecap="round"/></svg></span></div>
      <div class="world-request-track"><span></span></div>
      <span class="world-coordinate">THE SHADOW WORLD / 01</span>
    </div>
  </main>

  <footer class="site-footer">
    <span>A contained experiment. <span class="footer-detail">Synthetic data. Full visibility.</span></span>
    <span class="footer-signature">Built for the boundary.</span>
  </footer>

`;

const world = document.querySelector('.world');
const motionButton = document.querySelector('#motion-toggle');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let motionPaused = false;

function updateMotion() {
  world.classList.toggle('motion-paused', motionPaused || reducedMotion.matches || document.hidden);
  motionButton.disabled = reducedMotion.matches;
  motionButton.setAttribute('aria-pressed', String(motionPaused || reducedMotion.matches));
  const label = reducedMotion.matches ? 'Animation disabled by reduced-motion preference' : motionPaused ? 'Play animation' : 'Pause animation';
  motionButton.setAttribute('aria-label', label);
  motionButton.title = label;
  motionButton.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${motionPaused ? '<path d="m7 4 9 6-9 6Z"/>' : '<path d="M7 5v10M13 5v10"/>'}</svg>`;
}
motionButton.addEventListener('click', () => { motionPaused = !motionPaused; updateMotion(); });
reducedMotion.addEventListener('change', updateMotion);
document.addEventListener('visibilitychange', updateMotion);
updateMotion();
