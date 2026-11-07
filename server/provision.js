import { createApp } from './app.js';
// Supply a private JSON file, chmod 600, outside the repository. Never pass passwords in command arguments.
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { provision, db } = await createApp();
provision(config.email, config.password, config.role);
db.close();
console.log('Privileged account created. Remove the private provisioning file.');
