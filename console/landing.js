const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>';

document.querySelector("#landing").innerHTML = `
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/" aria-label="Mirage home">Mirage.</a>
    <nav class="site-nav" aria-label="Main navigation">
      <button class="text-link" id="how-open" type="button" aria-haspopup="dialog">How it works</button>
      <button class="motion-toggle" id="motion-toggle" type="button" aria-label="Pause animation" aria-pressed="false" title="Pause animation"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M7 5v10M13 5v10"/></svg></button>
    </nav>
  </header>

  <main class="hero" id="main">
    <div class="hero-copy">
      <h1>Let them wander.<br /><span>Keep the boundary.</span></h1>
      <p class="hero-description">When an agent steps outside its scope, Mirage redirects it into a world of decoys. Watch every move. Stay in control.</p>
      <div class="hero-actions">
        <a class="primary-link" href="/fleet.html">Enter the sandbox ${arrow}</a>
      </div>
    </div>

    <div class="world" aria-hidden="true">
      <div class="world-orbit orbit-outer"></div>
      <div class="world-orbit orbit-inner"></div>
      <div class="world-disc"><span class="world-signal"><span class="world-signal-runner"><i></i></span></span><span class="world-core"></span><span class="world-caption">A WORLD WITHIN REACH.<br />ALWAYS OUT OF SCOPE.</span></div>
      <div class="world-agent-track"><span class="world-satellite"></span></div>
      <div class="world-request-track"><span></span></div>
      <span class="world-coordinate">THE SHADOW WORLD / 01</span>
    </div>
  </main>

  <footer class="site-footer">
    <span>A contained experiment. <span class="footer-detail">Synthetic data. Full visibility.</span></span>
    <span class="footer-signature">Built for the boundary.</span>
  </footer>

  <dialog class="how-dialog" id="how-dialog" aria-labelledby="how-title">
    <div class="how-header"><a class="brand" href="/">Mirage.</a><button class="close-button" id="how-close" type="button" aria-label="Close how it works"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
    <div class="how-body">
      <h2 id="how-title">How it works.</h2>
      <ol class="how-steps">
        <li><div><h3>Observe.</h3><p>The watcher checks each tool call before it runs. In-scope actions continue to the honest environment.</p></div></li>
        <li><div><h3>Redirect.</h3><p>Out-of-scope requests get synthetic responses from the mirage. A consistent trail of decoys gives the agent somewhere else to go.</p></div></li>
        <li><div><h3>Contain.</h3><p>Planted credential use is blocked. The cage caps the run, while the console records the calls and verdicts.</p></div></li>
      </ol>
      <a class="primary-link" href="/fleet.html">Enter the sandbox ${arrow}</a>
    </div>
  </dialog>
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

const dialog = document.querySelector("#how-dialog");
const openButton = document.querySelector("#how-open");
openButton.addEventListener("click", () => {
  dialog.showModal();
  document.body.classList.add("dialog-open");
});
document.querySelector("#how-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
dialog.addEventListener("close", () => {
  document.body.classList.remove("dialog-open");
  openButton.focus();
});
