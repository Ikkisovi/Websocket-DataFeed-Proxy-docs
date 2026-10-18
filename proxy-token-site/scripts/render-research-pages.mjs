// Render readable article text into the static documents before client enhancement.
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const React=require('react');
const {renderToString}=require('react-dom/server');
for(const [source,component,pages]of [
 ['reports/reports-page.jsx','ReportsPage',[['reports/index.html','/reports/'],['reports/brain-stock-ranking/index.html','/reports/brain-stock-ranking/']]],
 ['research-data-page.jsx','ResearchDataPage',[['research-data.html','/research-data']]],
]){
 const result=await build({entryPoints:[resolve(root,'public',source)],bundle:true,platform:'node',format:'cjs',write:false,external:['react'],jsx:'transform',logLevel:'silent'});
 const module={exports:{}};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 for(const [file,pathname]of pages){
  const previous=globalThis.window;
  try{
   globalThis.window={location:{pathname},LeandataI18n:{getLanguage:()=> 'zh'}};
   const markup=renderToString(React.createElement(module.exports[component]));
   const path=resolve(root,'public',file);let html=await readFile(path,'utf8');
   const content='<!-- research-content:start --><div id="root">'+markup+'</div><!-- research-content:end -->';
   html=html.includes('<!-- research-content:start -->')?html.replace(/<!-- research-content:start -->[\s\S]*?<!-- research-content:end -->/,content):html.replace('<div id="root"></div>',content);
   html=html.replace(/<noscript>[\s\S]*?<\/noscript>/g,'');
   await writeFile(path,html);
  }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
 }
}
