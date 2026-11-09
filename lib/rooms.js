// A session file written by the panel's own agent (a control.js run), not by the user's terminal.
// runStartMs = start of the panel run active for that cwd (undefined if none); knownSids = sessions already classified as panel.
const isPanelSession = (s, runStartMs, knownSids) =>
  !!s && !!s.sessionId && (knownSids.has(s.sessionId) || (runStartMs != null && Number(s.startedAt) >= runStartMs - 5000));
// A pinned room is always awake: idle ('dormant'/'waiting') shows as neutral 'ready'; working/ask/done/stale are untouched.
const pinStatus = (status, pinned) => (pinned && (status === 'dormant' || status === 'waiting') ? 'ready' : status);
module.exports = { isPanelSession, pinStatus };
