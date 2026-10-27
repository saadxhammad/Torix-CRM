import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits on top of the sidebar footer and ends up in QA screenshots.
  devIndicators: false,
};

export default nextConfig;
