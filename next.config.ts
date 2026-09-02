import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The driver UI has a bottom-left control (Back / Edit); the dev badge would cover it on phones.
  devIndicators: false,
};

export default nextConfig;
