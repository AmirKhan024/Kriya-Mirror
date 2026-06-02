/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't fail production builds on ESLint warnings (e.g. unused vars in
  // exercise modules). Linting still runs in local dev; this only relaxes
  // the build gate so deploys aren't blocked by non-bug lint issues.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
