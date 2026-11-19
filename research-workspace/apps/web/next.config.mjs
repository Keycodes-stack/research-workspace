/** @type {import('next').NextConfig} */
// When running in Docker, internal server-side rewrites need to talk to the gateway container
// (http://gateway:8080), while browser-direct requests or host Next.js dev server use NEXT_PUBLIC_API_URL.
const internalApiUrl = process.env.INTERNAL_API_URL?.replace(/\/$/, "")
  || process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

if (!internalApiUrl) {
  throw new Error("NEXT_PUBLIC_API_URL or INTERNAL_API_URL is not set.");
}

const nextConfig = {
  reactStrictMode: true,
  // Rewrites are proxied with a 30 s default timeout, which cuts off paper discovery and multi-model /ask
  // calls (ECONNRESET -> 500). Match the gateway's 5-minute upstream limit instead.
  experimental: { proxyTimeout: 300_000 },
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: `${internalApiUrl}/:path*`,
      },
    ];
  },
};
export default nextConfig;
