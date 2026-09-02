import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, preferredTheme, THEME_STORAGE_KEY, type AppTheme } from "@/lib/theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<AppTheme>("light");

  useEffect(() => {
    const initial = preferredTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
    setTheme(next);
  }

  const nextLabel = theme === "dark" ? "Use light mode" : "Use dark mode";
  return (
    <button type="button" onClick={toggleTheme} aria-label={nextLabel} title={nextLabel} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-card hover:border-brand ${className}`}>
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

