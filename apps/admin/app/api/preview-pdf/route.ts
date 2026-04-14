import { NextResponse } from "next/server";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";

// Simple non-TikZ example so we don't depend on pgf/tikz being installed yet.
// NOTE: String.raw lets us write LaTeX with normal backslashes.
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
      return NextResponse.json(
        { error: "LaTeX compilation failed" },
        { status: 500 }
      );
    }

    const pdfBuffer = readFileSync(pdfPath);

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=preview.pdf",
      },
    });
  } catch (err) {
    console.error("preview-pdf error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
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
