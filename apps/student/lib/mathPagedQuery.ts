/**
 * PostgREST caps result sets at 1000 rows regardless of intent. Any query that
 * loads a whole course's keyword set (1700+ rows across 19 categories) silently
 * truncates without this helper.
 *
 * Usage:
 *   const rows = await fetchAllPages<KeywordRow>((from, to) =>
 *     supabase.from("math_keywords").select("...").in("category_id", ids).range(from, to)
 *   );
 */

const PAGE_SIZE = 1000;

export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows = 20000
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}
