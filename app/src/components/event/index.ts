// SOP: architecture/15-component-architecture.md § 4 (barrels)
//
// Barrel for the event/ subfolder. Cross-folder imports go through this
// file only — never reach in to a tab component directly. Internal helpers
// (e.g. ChipLabel, RadioChip, SectionHeader from EventDetailsTab) are NOT
// re-exported per SOP 15 § Public-vs-private. The transitional `_stubs.tsx`
// shims (Phase 3B) were deleted in Phase 4 once the real Gallery and
// SignaturePad components landed.

export { EventTabs } from './EventTabs';
export type { TabKey } from './EventTabs';

export { EventDetailsTab } from './EventDetailsTab';
export { NapkinsTab } from './NapkinsTab';
export { TableDesignsTab } from './TableDesignsTab';
export { ChuppahTab } from './ChuppahTab';
export { UpgradesTab } from './UpgradesTab';
export { SummaryTab } from './SummaryTab';
