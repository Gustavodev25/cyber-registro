const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

const ALLOW = [
  /Starting development server/i,      // início do dev server
  /DONE\s+Compiled successfully/i,     // build ok
  /ERROR|Error|Failed|Exception|✖|✘|❌/ // sempre deixe erros passarem
];

rl.on('line', (line) => {
  if (ALLOW.some((rx) => rx.test(line))) console.log(line);
});
