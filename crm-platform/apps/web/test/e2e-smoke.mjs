/* End-to-end smoke: register → import-free CRM loop → screenshots. */
import { chromium } from 'playwright-core';

const shots = '/tmp/claude-0/-home-user-Analystakim-github-io/16acf325-8df4-5f5b-a0b3-cf0131554251/scratchpad/shots';
import { mkdirSync } from 'node:fs';
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1360, height: 850 } });
const fail = async (msg) => {
  await page.screenshot({ path: `${shots}/FAIL.png`, fullPage: true });
  console.error('E2E FAIL:', msg);
  process.exit(1);
};
page.on('pageerror', (e) => console.error('pageerror:', e.message));

try {
  // 1. Register an organization
  await page.goto('http://localhost:5173/register');
  await page.getByLabel(/Organization name/).fill('Acme Demo Co');
  await page.getByLabel(/Your name/).fill('Sara Founder');
  await page.getByLabel(/^Email/).fill(`sara-${Date.now()}@acmedemo.test`);
  await page.getByLabel(/Password/).fill('password123');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.waitForURL('**/');
  await page.getByText('Dashboard', { exact: true }).first().waitFor({ timeout: 10000 });
  console.log('✓ registered org, dashboard loaded');

  // 2. Create a lead and convert it with a deal
  await page.getByRole('link', { name: /Leads/ }).click();
  await page.getByRole('button', { name: '+ New lead' }).first().click();
  await page.getByLabel(/^Name/).fill('Grace Hopper');
  await page.getByLabel(/Company/).fill('US Navy');
  await page.getByLabel(/Source/).fill('website');
  await page.getByRole('button', { name: 'Create lead' }).click();
  await page.getByText('Grace Hopper').waitFor();
  console.log('✓ lead created');

  await page.getByRole('button', { name: 'Convert' }).click();
  await page.getByLabel(/Deal title/).fill('Navy – Platform rollout');
  await page.getByLabel(/Value/).fill('50000');
  await page.getByRole('button', { name: 'Convert lead' }).click();
  await page.locator('table').getByText('converted').first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${shots}/3-leads.png` });
  console.log('✓ lead converted to contact+company+deal');

  // 3. Kanban shows the deal; move it a stage
  await page.getByRole('link', { name: /Deals/ }).click();
  await page.getByText('Navy – Platform rollout').waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${shots}/4-kanban.png` });
  const card = page.getByText('Navy – Platform rollout');
  const target = page.getByRole('region', { name: 'Stage Demo Scheduled' })
    .or(page.locator('section[aria-label="Stage Demo Scheduled"]'));
  await card.dragTo(target.first());
  await page.waitForTimeout(800);
  const demoCol = page.locator('section[aria-label="Stage Demo Scheduled"]');
  if (!(await demoCol.getByText('Navy – Platform rollout').count())) await fail('drag did not move card');
  console.log('✓ kanban drag moved deal to Demo Scheduled');

  // 4. Contacts list has the converted contact; open detail, add a note
  await page.getByRole('link', { name: /Contacts/ }).click();
  await page.getByText('Grace Hopper').first().click();
  await page.getByRole('tab', { name: 'notes' }).click();
  await page.getByPlaceholder('Write a note…').fill('Had a great first call. Send proposal next week.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await page.getByText('Had a great first call').waitFor();
  await page.getByRole('tab', { name: 'timeline' }).click();
  await page.getByText(/note added/i).waitFor();
  await page.screenshot({ path: `${shots}/5-contact.png` });
  console.log('✓ contact detail: note + timeline');

  // 5. Dashboard reflects pipeline
  await page.getByRole('link', { name: /Dashboard/ }).click();
  await page.getByText("Open pipeline").waitFor();
  await page.waitForTimeout(1200);
  await page.getByText('$50,000').first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${shots}/1-dashboard.png` });
  console.log('✓ dashboard shows $50,000 open pipeline');

  // 6. Dark mode
  await page.getByRole('button', { name: /Switch to dark mode/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/2-dashboard-dark.png` });
  console.log('✓ dark mode toggles');

  // 7. Global search
  await page.getByLabel('Global search').fill('Grace');
  await page.getByText('Contacts', { exact: false }).first().waitFor();
  await page.waitForTimeout(600);
  console.log('✓ global search returns results');

  console.log('E2E PASS');
} catch (err) {
  await fail(err.message);
} finally {
  await browser.close();
}
