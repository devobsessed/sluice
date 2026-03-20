import type { NextConfig } from "next"
import { withWorkflow } from 'workflow/next'

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || '',
  },
  serverExternalPackages: [
    // Agent SDK spawns a subprocess (cli.js) — must stay external so webpack
    // doesn't try to bundle it. Only used locally (no API key path).
    '@anthropic-ai/claude-agent-sdk',
  ],
  // Silence Next.js 16 warning about having webpack config without turbopack config.
  turbopack: {},
  // Force webpack to bundle these so resolve.alias can redirect
  // onnxruntime-node → onnxruntime-web (WASM). Both dev and prod use webpack.
  transpilePackages: [
    '@huggingface/transformers',
    'onnxruntime-node',
  ],
  // WASM everywhere — dev (--webpack) and production both use webpack.
  // No native addon, no Turbopack polyfill bugs.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'onnxruntime-node': 'onnxruntime-web',
    }
    return config
  },
  // Exclude onnxruntime-node native binaries (208MB) — WASM used everywhere now.
  outputFileTracingExcludes: {
    '*': ['node_modules/onnxruntime-node/**/*'],
  },
  // Include onnxruntime-web WASM files — the file tracer misses these
  // because they're loaded via constructed paths at runtime.
  outputFileTracingIncludes: {
    '*': [
      'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*',
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
    ],
  },
};

export default withWorkflow(nextConfig)
