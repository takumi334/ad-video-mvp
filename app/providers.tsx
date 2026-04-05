"use client";

import { UiLocaleProvider } from "@/lib/i18n/UiLocaleProvider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <UiLocaleProvider>{children}</UiLocaleProvider>;
}
