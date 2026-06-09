/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native node module; mark it external so Next doesn't try to bundle it.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
