import Link from "next/link";

export default function AdminHome() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-bold mb-6">AP Calculus Admin</h1>
      <nav>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <Link
              href="/generate"
              className="text-primary underline underline-offset-4 hover:no-underline"
            >
              Problem generation
            </Link>
          </li>
          <li>
            <Link
              href="/preview-json"
              className="text-primary underline underline-offset-4 hover:no-underline"
            >
              Preview from JSON
            </Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
