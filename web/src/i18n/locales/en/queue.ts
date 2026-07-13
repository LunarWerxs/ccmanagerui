export default {
  title: 'Run queue',
  whatIsQueue:
    'Each queued item is a claude CLI run with its own prompt, working directory, model, ' +
    'effort, permission mode, and account. Press Run to dispatch an item on demand, or enable ' +
    'the scheduler in Settings to work through the queue automatically with concurrency and ' +
    'spacing limits. Nothing runs by itself while the scheduler is off.',
  schedulerOn: 'Scheduler on',
  newRun: 'New run',
  queueResume: 'Queue resume',
  itemsCount: '{n} item(s)',
  edit: 'Edit',
  scheduledFor: 'runs {time}',
  runDue: 'Run due ({n})',
  runDueTitle: 'Run every due queued item now (ignores scheduler limits)',
  toastRanDue: 'Started {n} run(s)',
  toastRanDueSkipped: '{n} skipped — session already running',
  toastRunDueFailed: 'Failed to start the due runs.',
  empty: 'Queue is empty.',
  queueARun: 'Queue a run',
  toggleLiveOutput: 'Toggle live output',
  newChat: 'new chat',
  fork: 'fork',
  exit: 'exit',
  runNow: 'Run now',
  run: 'Run',
  cancel: 'Cancel',
  stop: 'Stop',
  delete: 'Delete',
  toastCancelFailed: 'Failed to cancel the run.',
  toastDeleteFailed: 'Failed to delete the queue item.',
}
