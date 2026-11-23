import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import ts from 'typescript';
export function loadTsx(relative,mocks={}) {
 const root=process.cwd();const require=createRequire(path.join(root,'package.json'));const original=Module._resolveFilename;const originalLoad=Module._load;
 Module._load=function(request,parent,...args){if(Object.hasOwn(mocks,request))return mocks[request];return originalLoad.call(this,request,parent,...args)};
 const extensions={};for(const extension of ['.ts','.tsx']){extensions[extension]=Module._extensions[extension];Module._extensions[extension]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);}
 Module._resolveFilename=function(request,parent,...args){return original.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args)};
 try{if(Object.keys(mocks).length)delete require.cache[require.resolve(path.join(root,relative))];return require(path.join(root,relative));}finally{Module._load=originalLoad;Module._resolveFilename=original;for(const [extension,handler]of Object.entries(extensions)){if(handler)Module._extensions[extension]=handler;else delete Module._extensions[extension];}}
}
