import EatingDemoClient from "./EatingDemoClient";

export const metadata = {
  title: "Character Eating/Singing Loop Demo",
  robots: { index: false, follow: false },
};

export default function EatingDemoPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Character loop demo</h1>
      <p className="mb-8 text-sm text-slate-600">
        3秒ループ。`eat / sing` の2モード + `minimal / improved` を比較できます。先頭で自分の画像を試せます。
      </p>

      <EatingDemoClient />
    </main>
  );
}
