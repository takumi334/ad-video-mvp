import { Suspense } from "react";
import { SelectionLogClient } from "./SelectionLogClient";

export default async function AdminSelectionLogPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;
  const expected = process.env.ADMIN_SELECTION_LOG_KEY?.trim();
  const authorized = Boolean(expected && key === expected);

  return (
    <Suspense fallback={null}>
      <SelectionLogClient authorized={authorized} />
    </Suspense>
  );
}
