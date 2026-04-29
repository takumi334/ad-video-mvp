import EatingDemoClient from "./EatingDemoClient";

export const metadata = {
  title: "Image to Shorts Batch Generator Demo",
  robots: { index: false, follow: false },
};

export default function EatingDemoPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Image to Shorts Demo</h1>
      <p className="mb-8 text-sm text-slate-600">
        1枚の画像から 9:16 ショート動画を複数本まとめて生成できます。ズーム速度・切り抜き位置・テキストを調整して個別ダウンロードできます。
      </p>

      <EatingDemoClient />
    </main>
  );
}
