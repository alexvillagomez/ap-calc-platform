import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

const TAXONOMY_DIR = '/Users/alexvillagomez/Desktop/ap-calc-platform/content/math-taxonomy';
const OUTPUT_PATH = '/Users/alexvillagomez/Desktop/ap-calc-platform/docs/math-research/taxonomy-index.md';

const files = readdirSync(TAXONOMY_DIR)
  .filter(f => f.endsWith('.json') && f !== '_prereq_edges.json')
  .sort();

const parseFailures = [];
const allIds = new Map(); // id -> [filenames]
const categories = [];

for (const file of files) {
  const filePath = join(TAXONOMY_DIR, file);
  const raw = readFileSync(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    parseFailures.push({ file, error: e.message });
    continue;
  }

  // Collect all ids for duplicate detection
  const collectIds = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(collectIds); return; }
    if (obj.id) {
      if (!allIds.has(obj.id)) allIds.set(obj.id, []);
      allIds.get(obj.id).push(file);
    }
    Object.values(obj).forEach(collectIds);
  };
  collectIds(data);

  categories.push({ file, data });
}

// Find duplicates
const duplicates = [];
for (const [id, files] of allIds.entries()) {
  if (files.length > 1) {
    duplicates.push({ id, files });
  }
}

// Build markdown
let md = `# Math Taxonomy Index\n\n`;
md += `Generated: 2026-06-11\n\n`;
md += `---\n\n`;

let totalCategories = 0;
let totalUmbrellas = 0;
let totalInDepth = 0;

for (const { file, data } of categories) {
  totalCategories++;
  const catName = basename(file, '.json').replace(/_/g, ' ');

  // Try to find section name - look at top-level fields
  let section = data.section || data.category || data.name || catName;

  md += `## ${catName}\n\n`;
  md += `**File:** \`${file}\`  \n`;
  md += `**Section:** ${section}\n\n`;

  // Find umbrellas - look for arrays of umbrella objects
  let umbrellas = data.umbrellas || data.topics || data.units || data.keywords || [];

  // If data is an array at top level
  if (Array.isArray(data)) {
    umbrellas = data;
  }

  // If data has a single key that contains the array
  if (!Array.isArray(umbrellas) && umbrellas.length === 0) {
    const keys = Object.keys(data).filter(k => Array.isArray(data[k]));
    if (keys.length > 0) {
      umbrellas = data[keys[0]];
    }
  }

  if (!Array.isArray(umbrellas) || umbrellas.length === 0) {
    // Try to see if data itself has umbrella-like structure
    md += `_No umbrella structure found_\n\n`;
    md += `Raw keys: ${Object.keys(data).join(', ')}\n\n`;
    continue;
  }

  md += `### Umbrellas\n\n`;

  for (const umbrella of umbrellas) {
    totalUmbrellas++;
    const uid = umbrella.id || umbrella.umbrella_id || '(no id)';
    const ulabel = umbrella.label || umbrella.name || umbrella.title || '(no label)';
    md += `- **[${uid}]** ${ulabel}\n`;

    // Find in_depth items
    const inDepthItems = umbrella.in_depth || umbrella.keywords || umbrella.subtopics || umbrella.children || [];
    if (Array.isArray(inDepthItems) && inDepthItems.length > 0) {
      for (const kw of inDepthItems) {
        totalInDepth++;
        const kid = kw.id || kw.keyword_id || '(no id)';
        const klabel = kw.label || kw.name || kw.title || '(no label)';
        md += `  - \`${kid}\` ${klabel}\n`;
      }
    }
  }
  md += `\n`;
}

md += `---\n\n`;
md += `## Totals\n\n`;
md += `| Metric | Count |\n`;
md += `|--------|-------|\n`;
md += `| Categories (files) | ${totalCategories} |\n`;
md += `| Umbrellas | ${totalUmbrellas} |\n`;
md += `| In-depth keywords | ${totalInDepth} |\n\n`;

md += `## Duplicate IDs\n\n`;
if (duplicates.length === 0) {
  md += `None found.\n\n`;
} else {
  for (const { id, files } of duplicates) {
    md += `- \`${id}\`: ${files.join(', ')}\n`;
  }
  md += `\n`;
}

md += `## Parse Failures\n\n`;
if (parseFailures.length === 0) {
  md += `None.\n\n`;
} else {
  for (const { file, error } of parseFailures) {
    md += `- \`${file}\`: ${error}\n`;
  }
  md += `\n`;
}

writeFileSync(OUTPUT_PATH, md, 'utf8');

// Print summary to stdout
console.log(JSON.stringify({
  totalCategories,
  totalUmbrellas,
  totalInDepth,
  duplicates,
  parseFailures
}, null, 2));
