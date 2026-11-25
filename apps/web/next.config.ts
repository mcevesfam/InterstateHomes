import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ['@interstate/shared'],
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.interstatehomes.com' }],
        destination: 'https://interstatehomes.com/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
