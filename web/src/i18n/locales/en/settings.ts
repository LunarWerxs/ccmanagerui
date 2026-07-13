// SettingsView strings — scheduler controls and account credential management.
export default {
  // tab bar
  tabGeneral: 'General',
  tabScheduler: 'Scheduler',
  tabAccounts: 'Accounts',

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

  // accounts section
  accounts: 'Accounts',
  accountsIntro:
    'Each run can spawn under a chosen credential (injected into that child process only). OAuth tokens spend the Max subscription; API keys spend separate Console credits.',
  noAccountsYet: 'No accounts yet.',
  labelField: 'Label',
  labelPlaceholder: '6claude',
  authTypeField: 'Auth type',
  authTypeDefaultPlaceholder: 'Default',
  secretField: 'Secret',
  secretPlaceholder: 'token or key value',
  plaintextStorageWarning:
    "Stored in plaintext in this tool's local SQLite db (same trust level as your CLI credentials file).",
  addAccount: 'Add account',
  removeAction: 'Remove',
  apiKeyBadge: 'API key',
  oauthBadge: 'OAuth',
  authOauthOption: 'OAuth token (Max subscription — claude setup-token)',
  authApiKeyOption: 'API key (Console — separate API credits)',
}
