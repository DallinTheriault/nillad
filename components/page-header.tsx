import { MenuButton } from "./menu-button";

// iOS-style top bar: hamburger left, large centered title, optional right action.
// Replaces the old mono "NF · X" eyebrow + left-aligned title look.
export function PageHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="relative flex items-center px-3 pt-4 pb-3 min-h-[3.75rem]">
      <MenuButton />
      <h1 className="absolute left-1/2 -translate-x-1/2 text-[28px] leading-none font-bold tracking-tight text-bone whitespace-nowrap">
        {title}
      </h1>
      <div className="ml-auto flex items-center">{action}</div>
    </header>
  );
}
