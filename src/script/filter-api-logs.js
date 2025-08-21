const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

const ALLOW = [
  /Database:\s*Conexão/i,              // conexão OK
  /Backend:.*Iniciado/i,               // servidor iniciado
  /ERROR|Error|Failed|Exception|Unhandled|✖|✘|❌/ // erros do backend
];

rl.on('line', (line) => {
  if (ALLOW.some((rx) => rx.test(line))) console.log(line);
});
