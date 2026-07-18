export default {
  off: 'Scheduler off',
  idle: 'Scheduler idle',
  running: '{n} running',
  dispatching: 'Dispatching {n}',
  nextIn: 'Next in {time}',
  onTooltip:
    'The scheduler is on: queued items dispatch automatically, respecting your spacing and concurrency limits. A spinner means a run is executing now; a countdown is the next scheduled item.',
  offTooltip:
    'The scheduler is off; nothing runs on its own. Turn it on in Settings → Scheduler, or press Run on a queued item.',
  clickToOpen: 'Click to open scheduler settings.',

  // --- the shared "run at…" panel (SchedulePanel.vue) ---
  // These used to live under composer.*, back when the chat composer was the only thing that could
  // schedule. The queue builder now shows the same panel, so they belong to the scheduler.
  scheduleTitle: 'Run at…',
  presetIn5h: 'In 5 hours',
  presetTomorrow: 'Tomorrow {time}',
  presetInHM: 'In {h}h {m}m',
  presetInHours: 'In {h}h',
  presetInMinutes: 'In {m}m',
  hoursValue: '{n}h',
  minutesValue: '{n}m',
  hoursDecrease: 'One hour less',
  hoursIncrease: 'One hour more',
  minutesDecrease: 'Ten minutes less',
  minutesIncrease: 'Ten minutes more',
  editTomorrowTime: 'Change this time (Settings → Scheduler)',
  schedulePickLabel: 'Or pick a date & time',
  scheduleConfirm: 'Queue for then',
  scheduleUseTime: 'Use this time',
  scheduleClear: 'Clear',
  scheduleNotSet: 'Run as soon as it can',
}
