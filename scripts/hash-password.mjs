import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  const password = await rl.question('Crie uma senha de administrador (min. 12 caracteres): ');
  if (password.length < 12) throw Error('Use pelo menos 12 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const rounds = 210000;
  const digest = pbkdf2Sync(password, Buffer.from(salt, 'hex'), rounds, 32, 'sha256').toString('hex');
  console.log('\nCopie TODO o conteúdo a seguir para o secret ADMIN_PASSWORD_HASH:\n');
  console.log(`pbkdf2_sha256$${rounds}$${salt}$${digest}`);
  console.log('\nNão publique esse hash nem sua senha no repositório.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { rl.close(); }
