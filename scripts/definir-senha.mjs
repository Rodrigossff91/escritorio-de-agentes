// Define usuário e senha do escritório. Uso: node scripts/definir-senha.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DADOS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const N = 32768;

let perguntar = function (texto, oculto) {
  return new Promise(ok => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) rl._writeToOutput = s => { if (s.includes(texto)) process.stdout.write(s); };
    rl.question(texto, r => { rl.close(); if (oculto) process.stdout.write('\n'); ok(r.trim()); });
  });
}

// sem terminal (respostas vindas de um script): lê as três linhas de uma vez
const linhas = process.stdin.isTTY ? null : (await new Promise(ok => { let d = ''; process.stdin.on('data', c => { d += c; }).on('end', () => ok(d.split('\n').map(x => x.trim()))); }));
if (linhas) perguntar = async () => linhas.shift() || '';
const usuario = await perguntar('Usuário: ');
const senha = await perguntar('Senha (mínimo 10 caracteres): ', true);
const confirma = await perguntar('Repita a senha: ', true);
if (!usuario) { console.error('Usuário vazio.'); process.exit(1); }
if (senha.length < 10) { console.error('Senha curta demais.'); process.exit(1); }
if (senha !== confirma) { console.error('As senhas não batem.'); process.exit(1); }

const sal = crypto.randomBytes(16);
const hash = crypto.scryptSync(senha, sal, 64, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
fs.mkdirSync(DADOS, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(DADOS, 'auth.json'), JSON.stringify({ usuario, sal: sal.toString('hex'), hash: hash.toString('hex'), N }), { mode: 0o600 });
console.log('Senha salva. Já vale para o próximo login.');
