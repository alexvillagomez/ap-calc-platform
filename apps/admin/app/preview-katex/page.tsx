import { KatexRenderToStringPreview } from "@/components/KatexRenderToStringPreview";

export default function PreviewKatexPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">KaTeX preview</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Try <code className="rounded bg-muted px-1.5 py-0.5">$…$</code>,{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">$$…$$</code>, or a bare{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">\begin&#123;aligned&#125;…</code> block, plus optional{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">&lt;SlopeField /&gt;</code> /{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">&lt;FunctionGraph /&gt;</code> tags.
        </p>
      </div>
      <KatexRenderToStringPreview />
    </main>
  );
}

