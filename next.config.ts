import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Transformers.js uses native onnxruntime; keep it out of the webpack bundle.
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node'],
  // Contract files are sent to the upload form's server action; allow up to 5 MB.
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
};

export default nextConfig;
