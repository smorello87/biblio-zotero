import { spawn } from 'node:child_process';
import { build } from './build.mjs';

await build;
const server = spawn(process.execPath, ['-e', "import('node:http').then(({createServer})=>import('node:fs').then(({createReadStream})=>createServer((req,res)=>{const path=req.url==='/'?'dist/index.html':'dist'+req.url;createReadStream(path).on('error',()=>{res.statusCode=404;res.end()}).pipe(res)}).listen(8000, '127.0.0.1',()=>console.log('http://127.0.0.1:8000'))))"], { stdio: 'inherit' });
process.on('SIGINT', () => server.kill('SIGINT'));
