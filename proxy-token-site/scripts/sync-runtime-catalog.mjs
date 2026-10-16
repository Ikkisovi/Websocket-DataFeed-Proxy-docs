// The commerce catalog is authoritative; runtime copies must be byte-identical.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2);
const root=args[args.indexOf('--root')+1];
if(!args.includes('--root') || !root || (!args.includes('--check') && !args.includes('--write'))) throw new Error('Usage: node scripts/sync-runtime-catalog.mjs --root <OpenAlice checkout> --check|--write');
const source=await readFile(new URL('../commerce/product-catalog.json',import.meta.url));
const targets=['rest-rs/src/product-catalog.json','ws-gateway-go/cmd/ws-gateway/product-catalog.json'];
for(const relative of targets) {
  const path=resolve(root,'services/leandata-v2',relative);
  if(args.includes('--write')) await writeFile(path,source);
  if(!source.equals(await readFile(path))) throw new Error('Runtime catalog differs: '+relative);
}
console.log('Commerce, REST and WS catalog bytes match: '+createHash('sha256').update(source).digest('hex'));
