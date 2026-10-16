// Import a reviewed backend contract; normal builds validate the pinned copy.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target=resolve(root,'public/docs/public-api-contract.json');
const provenance=resolve(root,'public/docs/api-contract-source.json');
const sourceIndex=process.argv.indexOf('--source');
if(sourceIndex>=0) {
  const repo=resolve(process.argv[sourceIndex+1]);
  const relative='services/leandata-v2/rest-rs/src/public-api-contract.json';
  const bytes=readFileSync(resolve(repo,relative));
  const committed=execFileSync('git',['-C',repo,'show',`HEAD:${relative}`]);
  if(!bytes.equals(committed)) throw new Error('Commit the exact backend contract before importing it');
  writeFileSync(target,bytes);
  writeFileSync(provenance,JSON.stringify({source_repository:'openalice',source_commit:execFileSync('git',['-C',repo,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),source_path:relative,sha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n');
}
const bytes=readFileSync(target);const meta=JSON.parse(readFileSync(provenance));const contract=JSON.parse(bytes);
if(createHash('sha256').update(bytes).digest('hex')!==meta.sha256) throw new Error('Contract source fingerprint drift; import the committed backend source');
if(contract.schema_version!==1 || !/^[a-f0-9]{40}$/.test(meta.source_commit)) throw new Error('Unknown contract/provenance schema');
const paths=new Set();const ids=new Set();
for(const op of contract.operations) {
 if(paths.has(op.path)||ids.has(op.id)||!contract.access_policies[op.access])throw new Error('Duplicate or unknown contract operation '+op.path);
 paths.add(op.path);ids.add(op.id);
 if(op.status==='unavailable' && (op.error.status!==501 || op.example))throw new Error('Unavailable API cannot advertise a successful example');
 if(op.parameters.length===0 && op.status==='available' && !op.parameter_specification) throw new Error('Incomplete parameter specification '+op.path);
}
console.log(`Public contract ${contract.version}: ${paths.size} routes; source SHA256 ${meta.sha256}`);
