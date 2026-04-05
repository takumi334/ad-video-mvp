import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // 本番対応: threaded wasm (SharedArrayBuffer) を使う場合は COOP/COEP を有効にする
  // ※MVP は threaded 無効（onnxruntime-web 1.18 + ort-wasm-simd.wasm）のためコメントアウト
  // async headers() {
  //   return [
  //     {
  //       source: "/:path*",
  //       headers: [
  //         { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  //         { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  //       ],
  //     },
  //   ];
  // },
};

export default nextConfig;
