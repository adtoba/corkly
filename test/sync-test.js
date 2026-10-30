// End-to-end test of shared boards with a fake cloud: two people, two separate browser profiles.
// Run: node test/sync-test.js   (from the project root, after npm install)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const createFakeServer = require('./fake-server');

const root = path.join(__dirname, '..');
const rdir = path.join(__dirname, 'r');
fs.rmSync(rdir, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src/renderer'), rdir, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'fake-cloud.js'), path.join(rdir, 'cloud.js'));
const url = 'file://' + path.join(rdir, 'index.html');
const shots = process.env.SHOTS || '/tmp';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

(async () => {
  const server = createFakeServer();
  const browser = await chromium.launch();
  async function person(name) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 780 } });
    const page = await ctx.newPage();
    const state = {};
    page.on('pageerror', (e) => { console.log(`[${name}] PAGEERR`, e.message); failures++; });
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] console`, m.text()); });
    await page.exposeFunction('__cloud', server.handler(page, state));
    await page.addInitScript(() => { window.__corklyFirebase = { apiKey: 'fake' }; });
    await page.goto(url);
    await page.waitForTimeout(1200);
    return page;
  }
  async function signUp(page, name, email) {
    await page.click('.panel .seg button[data-m="up"]');
    await page.fill('.auth-form input[name="name"]', name);
    await page.fill('.auth-form input[name="email"]', email);
    await page.fill('.auth-form input[name="password"]', 'secret123');
    await page.click('.auth-form [type=submit]');
    await page.waitForTimeout(400);
  }

  // --- Toba shares his board (with a real photo on the polaroid) ---
  const A = await person('Toba');
  const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.click('.ph-pick')]);
  await chooser.setFiles(path.join(root, 'build/icon.png'));
  await A.waitForTimeout(400);
  await A.click('#shareBtn');
  await signUp(A, 'Toba', 'toba@example.com');
  await A.screenshot({ path: `${shots}/dbg-a.png` });
  await A.waitForSelector('#startShareBtn', { timeout: 5000 });
  await A.click('#startShareBtn');
  await A.waitForSelector('#makeInvite');
  await A.click('#makeInvite');
  await A.waitForSelector('.invite-out .code');
  const code = (await A.textContent('.invite-out .code')).trim();
  check(/^[A-Z0-9]{5}-[A-Z0-9]+$/.test(code), `invite code shown (${code})`);
  await A.screenshot({ path: `${shots}/share-1-invite.png` });
  await A.click('.panel-close');

  // --- Ada joins with the code ---
  const B = await person('Ada');
  await B.click('#boardBtn');
  await B.click('text=Join a shared board…');
  await signUp(B, 'Ada', 'ada@example.com');
  await B.waitForSelector('.code-input');
  await B.fill('.code-input', code);
  await B.click('.auth-form [type=submit]');
  await B.waitForTimeout(800);
  const bName = await B.textContent('#boardName');
  check(bName === 'My first board', `Ada now sees Toba's board (“${bName}”)`);
  const bCount = await B.locator('.item').count();
  check(bCount === 4, `Ada sees all 4 pins (${bCount})`);
  check(await B.locator('.yarn').count() === 2, 'Ada sees both yarn strings');
  check(await B.locator('.item.locked').count() === 4, 'Toba’s pins are locked for a pin-only guest');
  await B.waitForTimeout(600);
  const imgSrc = await B.getAttribute('.type-photo .ph img', 'src').catch(() => null);
  check(!!imgSrc && imgSrc.startsWith('blob:'), `Ada sees Toba’s photo (${imgSrc ? imgSrc.slice(0, 20) : 'none'})`);
  const stored = Object.values(server.boards)[0].images;
  const sizes = Object.values(stored).map((i) => i.bytes.length);
  check(sizes.length === 1 && sizes[0] < 700 * 1024, `photo was shrunk before upload (${sizes.map((n) => Math.round(n / 1024) + ' KB').join(', ')})`);

  // --- Ada pins a note ---
  await B.mouse.move(900, 600);
  await B.keyboard.press('n');
  await B.waitForTimeout(200);
  await B.keyboard.type('Hey Toba! Dinner on Friday?');
  await B.mouse.click(1100, 100); // blur → commit
  await B.waitForTimeout(900);
  const aCount = await A.locator('.item').count();
  check(aCount === 5, `Toba gets Ada's new note (${aCount} pins)`);
  check(await A.locator('.new-sticker').count() === 1, 'Ada’s note has a NEW sticker on Toba’s board');
  check((await A.textContent('.item .by')).includes('Ada'), 'Ada’s note is signed “— Ada”');
  const txt = await A.locator('.type-note .txt').allTextContents();
  check(txt.some((t) => t.includes('Dinner on Friday')), 'note text arrived');
  check(await A.locator('#boardBtn.has-new').count() === 1, 'board chip shows a new-pin badge');
  await A.screenshot({ path: `${shots}/share-2-new-pin.png` });

  // --- Ada can't drag Toba's note ---
  const tobaNote = B.locator('.item.locked.type-note').first();
  const id = await tobaNote.getAttribute('data-id');
  const before = await tobaNote.boundingBox();
  await B.mouse.move(before.x + 60, before.y + 120); await B.mouse.down();
  await B.mouse.move(before.x + 260, before.y + 220, { steps: 8 }); await B.mouse.up();
  await B.waitForTimeout(500);
  const after = await B.locator(`.item[data-id="${id}"]`).boundingBox();
  check(Math.abs(after.x - before.x) < 3, 'guest cannot move someone else’s pin');

  // --- Toba moves his note; Ada sees it move ---
  const aNote = A.locator(`.item[data-id="${id}"]`);
  const ab = await aNote.boundingBox();
  await A.mouse.move(ab.x + 60, ab.y + 140); await A.mouse.down();
  await A.mouse.move(ab.x - 140, ab.y + 200, { steps: 10 }); await A.mouse.up();
  await A.waitForTimeout(900);
  const bx = await B.evaluate((i) => document.querySelector(`.item[data-id="${i}"]`).style.left, id);
  const ax = await A.evaluate((i) => document.querySelector(`.item[data-id="${i}"]`).style.left, id);
  check(ax === bx, `Ada sees Toba’s move (${ax} / ${bx})`);

  // --- Toba renames the board and changes the surface ---
  await A.click('[data-bg="felt"]');
  await A.waitForTimeout(500);
  check(await B.evaluate(() => document.getElementById('board').className.includes('bg-felt')), 'surface change syncs');

  // --- Toba tosses Ada's note (owner can) ---
  const adaNoteId = await A.locator('.item:has(.by)').first().getAttribute('data-id');
  await A.click(`.item[data-id="${adaNoteId}"] .fastener`, { force: true }).catch(() => {});
  await A.evaluate((i) => { const el = document.querySelector(`.item[data-id="${i}"]`); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })); }, adaNoteId);
  await A.click('text=Crumple & toss');
  await A.waitForTimeout(1200);
  check(await B.locator('.item:not(.crumpling)').count() === 4, 'owner removing a pin syncs to the guest');

  // --- Ada ties yarn from her own new note to Toba's list (allowed) ---
  await B.mouse.move(700, 600);
  await B.keyboard.press('n'); await B.waitForTimeout(150); await B.keyboard.type('Me again'); await B.mouse.click(1100, 100);
  await B.waitForTimeout(600);
  await B.keyboard.press('y');
  const own = B.locator('.item:not(.locked)').first();
  await own.click({ position: { x: 30, y: 30 } });
  await B.locator('.item.type-list').click({ position: { x: 40, y: 80 } });
  await B.keyboard.press('Escape');
  await B.waitForTimeout(700);
  check(await A.locator('.yarn').count() === 3, `guest’s yarn shows up for the owner (${await A.locator('.yarn').count()})`);

  // --- Toba removes Ada; she keeps a copy ---
  await A.click('#shareBtn');
  await A.waitForSelector('[data-remove]');
  await A.screenshot({ path: `${shots}/share-3-people.png` });
  A.once('dialog', (d) => d.accept());
  await A.click('[data-remove]');
  await A.waitForTimeout(800);
  const shared = await B.evaluate(() => document.getElementById('boardBtn').classList.contains('is-shared'));
  check(!shared, 'removed guest’s board turns back into a private copy');
  check(await B.locator('.item').count() >= 4, 'removed guest keeps a copy of the pins');
  await B.screenshot({ path: `${shots}/share-4-guest.png` });

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL GOOD');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
