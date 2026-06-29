import type { NextConfig } from "next";

const backendOrigin =
  process.env.NEXT_PUBLIC_API_BASE ||
  process.env.NEXT_PUBLIC_BACKEND_ORIGIN ||
  "http://127.0.0.1:5001";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    domains: ["i.pravatar.cc"],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin.replace(/\/$/, "")}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
