export type CliDialogNamespace = 'cliInstances' | 'codexInstances'

// Keep these as full, static key paths. Besides making the reusable dialogs type-safe, this lets
// the locale audit verify both namespaces instead of treating template-built paths as unknown.
export const CLI_INSTANCE_DIALOG_KEYS = {
  cliInstances: {
    nameLabel: 'cliInstances.nameLabel',
    namePlaceholder: 'cliInstances.namePlaceholder',
    createDialogTitle: 'cliInstances.createDialogTitle',
    createDialogDescription: 'cliInstances.createDialogDescription',
    createDialogSubmit: 'cliInstances.createDialogSubmit',
    createDialogCreating: 'cliInstances.createDialogCreating',
    renameDialogTitle: 'cliInstances.renameDialogTitle',
    renameDialogDescription: 'cliInstances.renameDialogDescription',
    renameDialogSubmit: 'cliInstances.renameDialogSubmit',
    renameDialogRenaming: 'cliInstances.renameDialogRenaming',
    deleteDialogTitle: 'cliInstances.deleteDialogTitle',
    deleteDialogDescription: 'cliInstances.deleteDialogDescription',
    deleteDialogLabel: 'cliInstances.deleteDialogLabel',
    deleteDialogPlaceholder: 'cliInstances.deleteDialogPlaceholder',
    deleteDialogMismatch: 'cliInstances.deleteDialogMismatch',
    deleteDialogSubmit: 'cliInstances.deleteDialogSubmit',
    deleteDialogDeleting: 'cliInstances.deleteDialogDeleting',
  },
  codexInstances: {
    nameLabel: 'codexInstances.nameLabel',
    namePlaceholder: 'codexInstances.namePlaceholder',
    createDialogTitle: 'codexInstances.createDialogTitle',
    createDialogDescription: 'codexInstances.createDialogDescription',
    createDialogSubmit: 'codexInstances.createDialogSubmit',
    createDialogCreating: 'codexInstances.createDialogCreating',
    renameDialogTitle: 'codexInstances.renameDialogTitle',
    renameDialogDescription: 'codexInstances.renameDialogDescription',
    renameDialogSubmit: 'codexInstances.renameDialogSubmit',
    renameDialogRenaming: 'codexInstances.renameDialogRenaming',
    deleteDialogTitle: 'codexInstances.deleteDialogTitle',
    deleteDialogDescription: 'codexInstances.deleteDialogDescription',
    deleteDialogLabel: 'codexInstances.deleteDialogLabel',
    deleteDialogPlaceholder: 'codexInstances.deleteDialogPlaceholder',
    deleteDialogMismatch: 'codexInstances.deleteDialogMismatch',
    deleteDialogSubmit: 'codexInstances.deleteDialogSubmit',
    deleteDialogDeleting: 'codexInstances.deleteDialogDeleting',
  },
} as const
