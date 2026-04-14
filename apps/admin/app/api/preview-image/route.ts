import { NextResponse } from "next/server";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import sharp from "sharp";

// Same LaTeX as /api/preview-pdf (simple, no TikZ dependency).
const EXAMPLE_TEX = String.raw`\documentclass{article}
\usepackage{amsmath}
\pagestyle{empty}
\begin{document}

Hello, world.

\[
\int_{0}^{1} (3x^2 + 2x + 1)\,dx
\]

\end{document}
`;

export async function GET() {
  let dir: string | null = null;

  try {
    dir = mkdtempSync(join(tmpdir(), "latex-preview-"));
    const texPath = join(dir, "main.tex");
    const pdfPath = join(dir, "main.pdf");

    writeFileSync(texPath, EXAMPLE_TEX, { encoding: "utf-8" });

    try {
      execSync("pdflatex -interaction=nonstopmode main.tex", {
        cwd: dir,
        stdio: "ignore",
      });
    } catch (e) {
      console.error("pdflatex failed", e);
      return NextResponse.json({ error: "LaTeX compilation failed" }, { status: 500 });
    }

    const pdfBuffer = readFileSync(pdfPath);

    // Render first page to PNG using sharp's PDF support.
    // density controls rasterization resolution.
    const pngBuffer = await sharp(pdfBuffer, { density: 200 })
      .png()
      .toBuffer();

    return new NextResponse(pngBuffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("preview-image error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}
