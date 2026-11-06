import type { SettingsSection } from './SettingsView'

/** A small cog at the top of a page that leads to the settings of what the page shows. */
export function SettingsLink({ section, onOpen, title }: { section: SettingsSection; onOpen: (s: SettingsSection) => void; title: string }) {
  return (
    <button className="icon-btn page-cog" title={title} aria-label={title} onClick={() => onOpen(section)}>
      <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
        <path d="M13.23 6.66 L15.14 7.04 L15.14 8.96 L13.23 9.34 L12.65 10.75 L13.72 12.37 L12.37 13.72 L10.75 12.65 L9.34 13.23 L8.96 15.14 L7.04 15.14 L6.66 13.23 L5.25 12.65 L3.63 13.72 L2.28 12.37 L3.35 10.75 L2.77 9.34 L0.86 8.96 L0.86 7.04 L2.77 6.66 L3.35 5.25 L2.28 3.63 L3.63 2.28 L5.25 3.35 L6.66 2.77 L7.04 0.86 L8.96 0.86 L9.34 2.77 L10.75 3.35 L12.37 2.28 L13.72 3.63 L12.65 5.25Z" />
        <circle cx="8" cy="8" r="2.1" />
      </svg>
    </button>
  )
}
