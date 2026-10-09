export function render(container) {
  container.replaceChildren();
  let remaining = 25 * 60, running = false, last = Date.now();
  const panel = document.createElement('div');
  panel.className = 'view-constrained';
  const title = document.createElement('h2'); title.textContent = 'Pomodoro';
  const note = document.createElement('p'); note.textContent = 'Choose one task. Focus for 25 minutes, then take a five-minute break.';
  const time = document.createElement('h3'); time.setAttribute('aria-live', 'off');
  const start = document.createElement('button'); start.className = 'btn primary'; start.textContent = 'Start';
  const draw = () => { time.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`; };
  start.onclick = () => { running = !running; last = Date.now(); start.textContent = running ? 'Pause' : 'Start'; };
  panel.append(title, note, time, start);
  for (const [label, seconds] of [['Focus', 1500], ['Break', 300]]) {
    const button = document.createElement('button'); button.className = 'btn quiet'; button.textContent = label;
    button.onclick = () => { remaining = seconds; running = false; start.textContent = 'Start'; draw(); };
    panel.append(button);
  }
  container.append(panel); draw();
  const timer = setInterval(() => {
    if (!panel.isConnected) { clearInterval(timer); return; }
    if (!running) return;
    const seconds = Math.floor((Date.now() - last) / 1000);
    remaining = Math.max(0, remaining - seconds); last += seconds * 1000; draw();
    if (!remaining) { running = false; start.textContent = 'Done'; }
  }, 250);
}
