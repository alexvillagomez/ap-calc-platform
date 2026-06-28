import Link from "next/link";

const adminLinks = [
  { href: "/input", label: "Problem input" },
  { href: "/lessons", label: "Lesson authoring" },
  { href: "/generate", label: "Problem generation" },
  { href: "/rag-agent", label: "RAG problem agent" },
  { href: "/rag-examples", label: "RAG examples" },
  { href: "/keywords", label: "Keyword engine" },
  { href: "/keyword-add", label: "Add keyword" },
  { href: "/keyword-dedup", label: "Keyword deduplication" },
  { href: "/keyword-test", label: "Keyword similarity test" },
  { href: "/tagging", label: "Tagging pipeline" },
  { href: "/lookup", label: "Problem lookup" },
  { href: "/compare", label: "Compare text" },
  { href: "/preview-json", label: "Preview from JSON" },
  { href: "/preview-katex", label: "KaTeX preview" },
  { href: "/preview-pdf", label: "PDF preview" },
];

export default function AdminHome() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-bold mb-6">AP Calculus Admin</h1>
      <nav>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {adminLinks.map((link) => (
            <li key={link.href} className="list-none">
              <Link
                href={link.href}
                className="block rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-primary hover:bg-muted"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
