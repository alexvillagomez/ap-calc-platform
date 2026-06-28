const fs = require('fs');
const path = require('path');

const dir = '/Users/alexvillagomez/Desktop/ap-calc-platform/content/math-taxonomy';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== '_prereq_edges.json');

const results = {};
const parseFailures = [];
const allIds = {};
const duplicates = [];

for (const file of files) {
  const filePath = path.join(dir, file);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    results[file] = data;

    // Collect all ids
    function collectIds(obj, fileKey) {
      if (obj && typeof obj === 'object') {
        if (obj.id) {
          if (allIds[obj.id]) {
            duplicates.push({ id: obj.id, files: [allIds[obj.id], fileKey] });
          } else {
            allIds[obj.id] = fileKey;
          }
        }
        for (const val of Object.values(obj)) {
          if (Array.isArray(val)) {
            for (const item of val) collectIds(item, fileKey);
          } else if (val && typeof val === 'object') {
            collectIds(val, fileKey);
          }
        }
      }
    }
    collectIds(data, file);
  } catch (e) {
    parseFailures.push({ file, error: e.message });
  }
}

// Print structure of first file to understand schema
console.log('=== SCHEMA SAMPLE (first file) ===');
const firstFile = Object.keys(results)[0];
if (firstFile) {
  const d = results[firstFile];
  console.log(JSON.stringify(d, null, 2).substring(0, 3000));
}

console.log('\n=== FILES PARSED ===');
console.log(Object.keys(results).join('\n'));

console.log('\n=== PARSE FAILURES ===');
console.log(parseFailures.length === 0 ? 'None' : JSON.stringify(parseFailures, null, 2));

console.log('\n=== DUPLICATE IDS ===');
console.log(duplicates.length === 0 ? 'None' : JSON.stringify(duplicates, null, 2));

// Output full structure as JSON for use in index generation
fs.writeFileSync('/tmp/taxonomy-data.json', JSON.stringify({ results, parseFailures, duplicates, allIds }, null, 2));
console.log('\n=== Data written to /tmp/taxonomy-data.json ===');
