// Session composer — the chat-style input at the bottom of the transcript pane.
export default {
  placeholder: 'Message this session. Enter to send, Shift+Enter for a new line',
  placeholderMulti: 'Message {n} sessions. Enter to send to each',
  sendingToN: 'Sending to {n} sessions',
  busyHintAuto:
    'This session is busy, so your message will queue and start on its own once the current run finishes (two runs cannot share one session).',
  busyHintManual:
    'This session is busy, so your message will queue behind the current run. The scheduler is off, so it waits until you press Run.',
  send: 'Send',
  queue: 'Queue',
  queueForLater: 'Queue for later',
  clearOption: 'Default',
  chipModel: 'Model',
  chipEffort: 'Effort',
  chipPermission: 'Permissions',
  chipAccount: 'Account',
  cwdPopoverLabel: 'Working directory override',
  cwdPopoverHint: "Leave empty to use the session's own directory.",
  toastStarted: 'Started {n} run(s)',
  toastQueued: 'Queued {n} message(s)',
  toastMixed: 'Started {ran} run(s), queued {queued}',
  toastFailed: 'Failed for {n} session(s)',
  schedulerOffHint: 'Scheduler is off; queued messages only run when you press Run.',
  viewQueue: 'View queue',
}
