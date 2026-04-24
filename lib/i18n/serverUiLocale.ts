import { cookies } from "next/headers";
import { DEFAULT_UI_LOCALE, UI_LOCALES, type UiLocale } from "./uiLocale";

export async function getServerUiLocale(): Promise<UiLocale> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("ui_locale")?.value;
  if (raw && (UI_LOCALES as readonly string[]).includes(raw)) {
    return raw as UiLocale;
  }
  return DEFAULT_UI_LOCALE;
}
