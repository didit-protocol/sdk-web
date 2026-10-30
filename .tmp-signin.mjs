import { chromium } from '/tmp/botinc-run-26851706-4127-4ea6-93a3-bf8ef7d351f5/didit-protocol__sdk-web/node_modules/@playwright/test/index.mjs';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';

const env = {};
for (const line of fs.readFileSync('/tmp/botinc-run-26851706-4127-4ea6-93a3-bf8ef7d351f5/didit-protocol__fe-application-console/.env','utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g,'');
}
const BASE32="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret, at=Date.now()){
  const bits=[...secret.replace(/=+$/,'').replace(/\s+/g,'').toUpperCase()].map(c=>{const v=BASE32.indexOf(c); if(v<0) throw new Error('bad secret'); return v.toString(2).padStart(5,'0');}).join('');
  const key=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));
  const counter=Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at/30000)));
  const digest=createHmac('sha1',key).update(counter).digest();
  const o=digest[digest.length-1]&15;
  return ((digest.readUInt32BE(o)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL: env.E2E_STAGING_BASE_URL });
const page = await context.newPage();
try {
  await page.goto('/sign-in');
  await page.locator('#email').fill(env.E2E_STAGING_EMAIL);
  await page.locator('#current-password').fill(env.E2E_STAGING_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(/\/2fa/, { timeout: 60000 });
  const field = page.getByRole('textbox', { name: '6-digit code' });
  for (let i=0;i<3;i++){
    await field.fill(totp(env.E2E_STAGING_TOTP_SECRET));
    try { await page.waitForURL((u)=>!u.pathname.startsWith('/2fa'), {timeout:30000}); break; } catch { console.log('retry code, url path', new URL(page.url()).pathname); await page.waitForTimeout(31000); }
  }
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('session-store');
    return raw && JSON.parse(raw)?.state?.accessToken;
  }, null, { timeout: 60000 });
  await context.storageState({ path: '/tmp/staging-state.json' });
  console.log('signed in');
} finally {
  await browser.close();
}
