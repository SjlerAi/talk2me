'use strict';

const { refreshOverdueWatches } = require('./office-intelligence-agent');

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await refreshOverdueWatches();
  } catch (error) {
    console.error('[agent-deadline-watch]', error && error.message ? error.message : error);
  } finally {
    running = false;
  }
}

function startAgentDeadlineScheduler() {
  if (timer) return timer;
  setTimeout(tick, 5000).unref?.();
  timer = setInterval(tick, 60 * 1000);
  timer.unref?.();
  return timer;
}

module.exports = { startAgentDeadlineScheduler, tick };
