// A template (unlike layout) re-mounts on every navigation, so this wrapper
// replays its fade each time you move between pages. Opacity-only on purpose:
// a transform here would make this the containing block for `fixed` children
// (the reminders + button, drawers) and shift them mid-animation.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-fade">{children}</div>;
}
