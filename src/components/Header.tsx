import { Link } from "@tanstack/react-router";
import { User } from "lucide-react";
import { BranchSwitcher } from "@/components/BranchSwitcher";
import { NotificationCenter } from "@/components/NotificationCenter";
import { ThemeToggle } from "@/components/ThemeToggle";

const LOGO_SRC = "/images/champs/champs-logo.png";

export function Header({ subtitle }: { subtitle?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-lg items-center gap-2 px-4 py-2.5">
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <img src={LOGO_SRC} alt="Champs Chicken" className="h-9 w-auto" />
          <div className="leading-tight min-w-0">
            <div className="font-display text-base text-brand truncate">Champs Chicken</div>
            {subtitle && <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{subtitle}</div>}
          </div>
        </Link>
        <div className="ml-auto flex items-center gap-1.5">
          <BranchSwitcher />
          <NotificationCenter />
          <ThemeToggle className="hidden sm:grid" />
          <Link
            to="/auth"
            aria-label="Account"
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card hover:border-brand"
          >
            <User className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
