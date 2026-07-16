// SettingsView strings — scheduler controls and account credential management.
export default {
  // appearance section
  appearance: 'Appearance',
  themeLabel: 'Theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  themeSystem: 'System',
  showTooltipsLabel: 'Show tooltips',
  showTooltipsHint: 'Hover help on buttons and controls. Info icons stay on.',
  portableModeLabel: 'Portable window',
  portableModeHint:
    'Opens CC Manager UI in its own window (no tabs or address bar) instead of a browser tab. The desktop launcher and tray icon follow this setting too.',
  portableModeToastOpened: 'Opened in portable window - you can close this tab.',
  portableModeToastNoBrowser: 'No Edge or Chrome install found to open a portable window.',
  portableModeToastFailed: 'Failed to save portable window setting.',
  hideTrayIconLabel: 'Hide tray icon',
  hideTrayIconHint:
    'Removes the CC Manager UI icon from the notification area. CC Manager UI keeps running in the background - launch the shortcut again to reopen the UI, or come back here to turn the icon back on.',
  hideTrayIconToastFailed: 'Failed to save hide tray icon setting.',

  // usage section
  usage: 'Usage',
  usageAutoRefreshLabel: 'Auto-refresh usage',
  usageAutoRefreshHint:
    "Keep every instance's quota numbers up to date in the background, so the Instances table is never stale. Checking your quota does not use any of it, and each check takes about a third of a second, so this costs you nothing. Turn it off to only ever check when you click Refresh.",
  usageIntervalLabel: 'Refresh every',
  usageIntervalHint:
    'How often to re-check. Quota moves over hours, not seconds, so there is little reason to go below 15 minutes.',
  usageIntervalMinutes: '{minutes} min',
  showDesktopInstancesLabel: 'Show desktop instances',
  showDesktopInstancesHint:
    'Show the Claude Desktop instances table. Turn this off if you only use the CLI.',
  showCliInstancesLabel: 'Show CLI instances',
  showCliInstancesHint:
    'Show the CLI instances table. Turn this off if you only use the desktop app.',
  usageToastFailed: 'Failed to save usage setting.',

  // updates section
  updates: 'Updates',
  currentVersion: 'Current version',
  checkForUpdates: 'Check for updates',
  checkingForUpdates: 'Checking…',
  updateAvailable: 'Update available',
  updateAndRestart: 'Update & restart',
  applyingUpdate: 'Updating…',
  updateBlocked: 'Update blocked',
  noUpdateSource: "Updates can't be checked",
  noUpdateSourceHint:
    'This install is not linked to a Git remote, so there is nowhere to pull new versions ' +
    'from. Link one (git remote add origin <url>) or set CCMANAGERUI_UPDATE_REPO, and the ' +
    'update check and auto-update come to life.',
  upToDate: 'Up to date',
  restartGuidance: ' Restart CC Manager UI from the tray icon to run the new code.',

  // auto-update section
  autoUpdate: 'Auto-update',
  autoUpdateDescription:
    'Off by default. When on, CC Manager UI periodically checks for a newer version and, if there are no uncommitted local changes, pulls it, reinstalls, rebuilds, and restarts the daemon on its own - no prompt. A dirty working tree is never touched; updates only apply on a clean checkout.',
  autoUpdateToastEnabled: 'Auto-update enabled.',
  autoUpdateToastDisabled: 'Auto-update disabled.',
  autoUpdateToastFailed: 'Failed to save auto-update settings.',
  toastSchedulerFailed: 'Failed to update scheduler settings.',
  toastAccountDeleteFailed: 'Failed to delete account.',

  // cloud sync section ("Sync my settings with Connections")
  cloudSyncTitle: 'Cloud sync',
  cloudSyncConnectButton: 'Sync settings with Connections',
  cloudSyncEnableToggle: 'Sync settings',
  cloudSyncHint:
    'Syncs scheduler preferences and appearance (theme) to your Connections account, so they follow you to CC Manager UI on another machine. Optional; never syncs accounts, secrets, or queue data.',
  cloudSyncSyncNow: 'Sync now',
  cloudSyncSyncing: 'Syncing…',
  cloudSyncSyncedToast: 'Settings synced.',
  cloudSyncSyncedNow: 'Synced - just now',
  cloudSyncSyncedAgo: 'Synced - {when}',
  cloudSyncSecondsAgo: '{n}s ago',
  cloudSyncMinutesAgo: '{n}m ago',
  cloudSyncHoursAgo: '{n}h ago',
  cloudSyncNeverSynced: 'Not synced yet',
  cloudSyncDisconnect: 'Disconnect',
  cloudSyncConfirmDisconnect: 'Click again to confirm',
  cloudSyncConnectFailed: "Couldn't connect to Connections. Try again.",

  // scheduler section
  scheduler: 'Scheduler',
  schedulerHint:
    "When enabled, the scheduler automatically spawns real claude runs for queued items; this spends the selected account's quota and acts on real repositories. Leave it off to dispatch items manually with the Run button.",
  schedulerEnabledLabel: 'Enabled',
  running: 'running',
  queued: 'queued',
  advanced: 'Advanced',
  tomorrowTimeLabel: 'Tomorrow preset time',
  tomorrowTimeHint:
    'The time of day the composer\'s "Tomorrow …" quick option schedules for. Saved immediately.',
  spacingLabel: 'Spacing (s)',
  pollLabel: 'Poll (s)',
  maxConcurrentLabel: 'Max concurrent',
  saveSettings: 'Save settings',
  toastSaved: 'Settings saved.',

  // auto-resume monitor section
  monitorTitle: 'Auto-resume monitor',
  monitorHint:
    'Watches sessions that stopped on a rate limit and, once the 5-hour window resets, resumes them automatically. Off by default; it prompts sessions while you are away, so review the settings below before turning it on.',
  monitorEnabledLabel: 'Enabled',
  monitorMaxAttemptsLabel: 'Max resume attempts',
  monitorBufferLabel: 'Resume buffer (min)',
  monitorEmpty:
    'Nothing to resume right now. A session appears here once it stops on a rate limit — whether the app ran it or you started it yourself in a terminal, which the monitor finds by checking recent transcripts. The monitor then tracks it until the window resets and resumes it. An empty list means nothing is currently waiting on a limit, not that monitoring is off.',
  monitorAttempts: '{n} attempts',
  monitorDiscovered: 'Found',
  monitorDiscoveredHint:
    'The monitor found this session stopped at a rate limit on disk — you started it outside the app, so there was no queued run to watch.',
  monitorStateScheduled: 'Scheduled',
  monitorStateBlockedWeekly: 'Blocked (weekly limit)',
  monitorStateNeedsHuman: 'Needs you',
  monitorStateDone: 'Done',
  monitorAccountOverridesLabel: 'Per-account overrides',
  monitorToastEnabled: 'Auto-resume monitor enabled.',
  monitorToastDisabled: 'Auto-resume monitor disabled.',
  monitorToastFailed: 'Failed to save auto-resume monitor settings.',

  // accounts section — LIST + REMOVE of legacy pasted credentials only. Accounts are ADDED by
  // signing an instance in on the Instances tab; the queue's run-as picker lists every
  // signed-in instance automatically.
  accounts: 'Accounts',
  accountsIntro:
    'Accounts are added by signing in on the Instances tab — every signed-in instance can run queued work under its own login, no token-pasting involved. Listed below are leftover manually-pasted credentials (a legacy path); they still work for dispatch and can be removed here.',
  noAccountsYet: 'No pasted credentials — add accounts by signing in on the Instances tab.',
  removeAction: 'Remove',
  apiKeyBadge: 'API key',
  oauthBadge: 'OAuth',
}
