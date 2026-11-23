import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import ts from 'typescript';
export function loadTsx(relative) {
 const root=process.cwd();const require=createRequire(path.join(root,'package.json'));const original=Module._resolveFilename;
 const extensions={};for(const extension of ['.ts','.tsx']){extensions[extension]=Module._extensions[extension];Module._extensions[extension]=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,file);}
 Module._resolveFilename=function(request,parent,...args){return original.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,...args)};
 try{return require(path.join(root,relative));}finally{Module._resolveFilename=original;for(const [extension,handler]of Object.entries(extensions)){if(handler)Module._extensions[extension]=handler;else delete Module._extensions[extension];}}
}
