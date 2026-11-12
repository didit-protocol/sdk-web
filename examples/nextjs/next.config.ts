import path from "node:path";

import type { NextConfig } from "next";

// The SDK packages are linked from this repository's workspace.
const root = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root
};

export default nextConfig;
