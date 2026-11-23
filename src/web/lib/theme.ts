import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "patch-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media().matches));
}

/** The viewer's theme choice, kept in this browser and applied to <html>. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored);
  useEffect(() => {
    apply(theme);
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // Storage blocked: the choice lasts for this page only.
    }
    if (theme !== "system") return;
    const m = media();
    const onChange = () => apply("system");
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [theme]);
  return [theme, setTheme] as const;
}
