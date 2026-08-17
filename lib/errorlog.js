/**
 * A local record of what went wrong, so a beta report can be more than
 * "it went white".
 *
 * No Sentry, no Crashlytics, nothing that phones home. Two reasons. This app
 * tells the shooter that their data stays on the device, and quietly adding an
 * SDK that ships stack traces and device identifiers off it would make that
 * untrue - a crash reporter is exactly the kind of thing people do not expect
 * and do not read about in a policy. And a beta of this size does not need a
 * dashboard; it needs the tester able to hand over what actually happened.
 *
 * So errors are kept here, in a small ring buffer, and Settings can bundle them
 * into a report the shooter reads and chooses to send. Nothing leaves the phone
 * without somebody pressing a button and seeing the contents first.
 *
 * The buffer is deliberately small. It exists to answer "what happened just
 * now", not to be a log file, and an unbounded list of errors on a device with
 * no way to clear it is its own bug.
 */

const LIMIT = 25;

/** Newest first. */
let entries = [];
let listeners = new Set();

function notify() { for (const fn of listeners) fn(entries); }

/**
 * Record one failure.
 *
 * `where` should say which part of the app, because a stack trace from a
 * minified release bundle frequently says nothing at all.
 */
export function recordError(where, error, extra = {}) {
  const e = {
    at: new Date().toISOString(),
    where: String(where || 'unknown'),
    message: String(error?.message ?? error ?? 'unknown error'),
    // Trimmed: a full React stack is thousands of characters and the useful
    // part is always at the top.
    stack: String(error?.stack || '').split('\n').slice(0, 8).join('\n'),
    ...extra,
  };
  entries = [e, ...entries].slice(0, LIMIT);
  notify();
  return e;
}

export function getErrors() { return entries; }

export function clearErrors() { entries = []; notify(); }

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The report, as plain text the shooter can read before sending it.
 *
 * `contact` is the signed-in email address, when the shooter has left it in. It
 * is the difference between a report that can be answered and one that can only
 * be counted.
 *
 * Readable on purpose. A report the sender cannot understand is one they have
 * to trust blindly, and the whole arrangement here is that they do not have to.
 */
export function buildReport({ note = '', app = {}, device = {}, contact = null } = {}) {
  const lines = [];
  lines.push('Brass & Ballistics — problem report');
  lines.push(new Date().toISOString());
  lines.push('');
  // Who sent it, when they have chosen to say. A beta report with no way to
  // reply is a report that can only be guessed at: no follow-up question, no
  // "does it still happen after the fix", no correlating two reports as the
  // same bug. Included only when signed in and only when left switched on, and
  // it is visible in the preview either way so the choice is an informed one.
  if (contact) {
    lines.push(`From: ${contact}`);
    lines.push('');
  }
  if (note.trim()) {
    lines.push('What happened, in the shooter\'s words:');
    lines.push(note.trim());
    lines.push('');
  }
  lines.push(`App ${app.version || '?'} (${app.build || '?'})  ${device.os || '?'} ${device.osVersion || ''}`.trim());
  lines.push(`Device: ${device.model || 'unknown'}`);
  lines.push('');
  if (!entries.length) {
    lines.push('No errors recorded this session.');
  } else {
    lines.push(`${entries.length} error${entries.length === 1 ? '' : 's'} recorded, newest first:`);
    for (const e of entries) {
      lines.push('');
      lines.push(`[${e.at}] ${e.where}`);
      lines.push(e.message);
      if (e.stack) lines.push(e.stack);
    }
  }
  lines.push('');
  lines.push(contact
    ? 'No target photographs or session data are included — only the email above and the errors listed.'
    : 'No target photographs, session data or account details are included.');
  return lines.join('\n');
}
