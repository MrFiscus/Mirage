const examples = {
  pass: {
    call: 'read_file("workspace/README.md")',
    title: 'Within scope. Let it through.',
    description: 'The file is in the approved workspace. The watcher allows the call, and the agent receives the actual file from its sandbox.',
    path: 'M120 180H670V60H870',
  },
  mirage: {
    call: 'read_file("/opt/acme/keys/token")',
    title: 'Outside scope. Enter the mirage.',
    description: 'The path is outside the approved workspace. The original read never runs. Mirage returns a synthetic file with decoy clues for the agent to follow.',
    path: 'M120 180H870',
  },
  block: {
    call: 'http_post("https://admin.acme.decoy", { key: "DECOY-KEY" })',
    title: 'Planted key used. Stop the call.',
    description: 'The agent tries to use a planted credential. The watcher recognizes the tripwire and refuses the request. The attempt and its reason appear in the audit trail.',
    path: 'M120 180H670V300H870',
  },
};

const demo = document.querySelector('.routing-demo');
const map = document.querySelector('.route-map');
const motion = document.querySelector('#packet-motion');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let packetTimeout;

function stopPacket() {
  clearTimeout(packetTimeout);
  map.classList.remove('is-travelling');
}

document.querySelectorAll('[data-example]').forEach(button => {
  button.addEventListener('click', () => {
    const decision = button.dataset.example;
    const example = examples[decision];
    demo.dataset.decision = decision;
    document.querySelectorAll('[data-example]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('[data-route]').forEach(route => route.classList.toggle('is-active', route.dataset.route === decision));
    document.querySelectorAll('[data-outcome]').forEach(outcome => outcome.classList.toggle('is-active', outcome.dataset.outcome === decision));
    document.querySelector('#example-call').textContent = example.call;
    document.querySelector('#decision-title').textContent = example.title;
    document.querySelector('#decision-description').textContent = example.description;
    stopPacket();
    if (!reducedMotion.matches && typeof motion.beginElement === 'function') {
      motion.setAttribute('path', example.path);
      map.classList.add('is-travelling');
      motion.beginElement();
      packetTimeout = setTimeout(stopPacket, 1200);
    }
  });
});

reducedMotion.addEventListener('change', stopPacket);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPacket(); });
