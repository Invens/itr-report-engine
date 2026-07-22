/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
  async rewrites() {
    const api = process.env.INTERNAL_API_URL ?? 'http://localhost:4000';
    return [{ source: '/backend/:path*', destination: `${api}/:path*` }];
  }
};

export default nextConfig;
