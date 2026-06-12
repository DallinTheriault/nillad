/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native node module; mark it external so Next doesn't try to
  // bundle it. pdf-parse/mammoth are also kept external — pdf-parse has a bundler-
  // hostile debug block, and both are required at runtime in the documents pipeline.
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "mammoth"],
};

export default nextConfig;
