'use strict';

const path = require('path');
const { spawn } = require('child_process');

const TIME_ZONE = process.env.TZ || 'Africa/Johannesburg';
const CHECK_INTERVAL_MS = 60 * 1000;
const START_DELAY_MS = 5000;

const JOBS = Object.freeze([
  {
    key: 'staff-work',
    script: 'send-staff-work-digest.js',
    earliestMinute: 6 * 60,
    latestMinute: 7 * 60
  },
  {
    key: 'owner-daily',
    script: 'send-owner-daily-brief.js',
    earliestMinute: 6 * 60 + 5,
    latestMinute: 7 * 60
  },
  {
    key: 'staff-clients',
    script: 'send-staff-client-digest.js',
    earliestMinute: 8 * 60,
    latestMinute: 9 * 60
  }
]);

const launched = new Map();
let timer = null;
let startupTimer = null;

function localParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: hour * 60 + minute
  };
}

function shouldRun(job, state) {
  if (state.minuteOfDay < job.earliestMinute || state.minuteOfDay >= job.latestMinute) return false;
  return launched.get(job.key) !== state.dateKey;
}

function runJob(job, dateKey) {
  launched.set(job.key, dateKey);
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', job.script);
  const child = spawn(process.execPath, [scriptPath], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, DIGEST_FORCE_SEND: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', error => {
    console.error(`[DigestScheduler] ${job.key} could not start:`, error.message);
  });
  child.on('close', code => {
    const out = stdout.trim();
    const err = stderr.trim();
    if (out) console.log(`[DigestScheduler] ${job.key}:\n${out}`);
    if (code === 0) {
      console.log(`[DigestScheduler] ${job.key} completed for ${dateKey}.`);
    } else {
      console.error(`[DigestScheduler] ${job.key} exited with code ${code}.${err ? ` ${err}` : ''}`);
    }
  });
}

function tick(now = new Date()) {
  const state = localParts(now);
  for (const job of JOBS) {
    if (shouldRun(job, state)) runJob(job, state.dateKey);
  }
}

function startDigestScheduler() {
  if (timer || startupTimer) return;
  console.log(`[DigestScheduler] enabled in ${TIME_ZONE}; work 06:00, owner 06:05, clients 08:00.`);
  startupTimer = setTimeout(() => {
    startupTimer = null;
    tick();
    timer = setInterval(tick, CHECK_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }, START_DELAY_MS);
  if (typeof startupTimer.unref === 'function') startupTimer.unref();
}

function stopDigestScheduler() {
  if (startupTimer) clearTimeout(startupTimer);
  if (timer) clearInterval(timer);
  startupTimer = null;
  timer = null;
}

module.exports = { startDigestScheduler, stopDigestScheduler, localParts, shouldRun, JOBS };
