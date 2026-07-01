import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ["@ap-calc/types", "@ap-calc/supabase"],
  // sql.js ships a .wasm + Node/fs glue that webpack must NOT bundle — keep it
  // external so it's required at runtime (used by /api/mcat/import to read .apkg).
  serverExternalPackages: ["sql.js"],
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Use a writable directory for the build output.  The default ".next" lives
  // on the FUSE-mounted macOS host share which disallows unlink/rmdir from
  // inside the sandbox.  NEXT_DIST_DIR can point to /tmp/... for local builds;
  // Vercel sets its own output path independently.
  distDir: process.env.NEXT_DIST_DIR
    ? path.isAbsolute(process.env.NEXT_DIST_DIR)
      ? process.env.NEXT_DIST_DIR
      : path.join(__dirname, process.env.NEXT_DIST_DIR)
    : ".next",
};

export default nextConfig;
