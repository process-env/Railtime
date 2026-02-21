import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      // Static GTFS data files — built at deploy time, immutable between deploys
      source: '/data/:path*.json',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=86400, stale-while-revalidate=604800',
        },
      ],
    },
  ],
};

export default nextConfig;
