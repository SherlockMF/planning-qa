/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  // pdf-parse / mammoth 为 Node 原生库，交给服务端 require，避免被打包导致的副作用
  experimental: {
    // pdf-parse / mammoth 为 CJS 原生库，让 webpack 用 require() 外部化
    // pdfjs-dist 是 ESM-only，不能加入此列表（否则 webpack 用 require() 加载 .mjs 会报错）
    // pdfjs-dist 通过 import(/* webpackIgnore: true */) 在运行时由 Node.js 原生加载
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
  },
};

export default nextConfig;
