import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { publicCatalog } = require('../commerce/product-catalog.cjs');
await writeFile(new URL('../public/product-catalog.json', import.meta.url), JSON.stringify(publicCatalog(), null, 2) + '\n');
