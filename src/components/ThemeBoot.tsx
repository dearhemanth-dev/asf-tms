"use client";

import { useEffect } from "react";

type AppTheme = "dark" | "light" | "steel";

const THEME_STORAGE_KEY = "asf:tms:theme";
const LEGACY_THEME_STORAGE_KEY = "asf:tms:fault-theme";

export default function ThemeBoot() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedTheme =
      window.localStorage.getItem(THEME_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);

    let resolvedTheme: AppTheme = "steel";
    if (savedTheme === "dark" || savedTheme === "light" || savedTheme === "steel") {
      resolvedTheme = savedTheme;
    } else if (savedTheme === "ops") {
      resolvedTheme = "steel";
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
    window.localStorage.setItem(LEGACY_THEME_STORAGE_KEY, resolvedTheme);
    document.documentElement.setAttribute("data-app-theme", resolvedTheme);
  }, []);

  return null;
}
