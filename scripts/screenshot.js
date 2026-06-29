import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  const fileUrl = 'file://' + path.resolve('sp-dashboard/index.html');
  console.log('Opening', fileUrl);

  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await page.setViewport({ width: 1200, height: 800 });

  // wait a moment for any mock data to load
  await new Promise(resolve => setTimeout(resolve, 1000));

  // use a custom range covering the mock data dates so bars render prominently
  await page.evaluate(() => {
    const sel = document.getElementById('date-preset');
    sel.value = 'custom';
    sel.dispatchEvent(new Event('change'));
    document.getElementById('date-from').value = '2026-02-17';
    document.getElementById('date-to').value = '2026-02-22';
    document.getElementById('date-from').dispatchEvent(new Event('change'));
  });
  await new Promise(resolve => setTimeout(resolve, 500));

  // ensure assets directory exists
  const outDir = path.resolve('assets');
  try { await fs.promises.mkdir(outDir, { recursive: true }); } catch {};

  // capture dashboard view first
  const dashPath = path.join(outDir, 'dashboard.png');
  await page.screenshot({ path: dashPath, fullPage: true });
  console.log('Dashboard screenshot saved to', dashPath);

  // switch to detailed list and capture second screenshot
  await page.evaluate(() => window.switchTab && window.switchTab('details'));
  // give DOM a moment to render the new view
  await new Promise(resolve => setTimeout(resolve, 500));
  const listPath = path.join(outDir, 'detailed_list.png');
  await page.screenshot({ path: listPath, fullPage: true });
  console.log('Detailed list screenshot saved to', listPath);

  // switch to drilldown tab, expand layout to show full content, then capture
  await page.evaluate(() => window.switchTab && window.switchTab('drilldown'));
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.evaluate(() => {
    document.body.style.height = 'auto';
    document.body.style.overflow = 'visible';
    const container = document.querySelector('.container');
    if (container) { container.style.height = 'auto'; container.style.overflow = 'visible'; }
    const mainCard = document.querySelector('.main-card');
    if (mainCard) { mainCard.style.overflow = 'visible'; }
    const viewContent = document.getElementById('view-drilldown');
    if (viewContent) { viewContent.style.overflow = 'visible'; viewContent.style.height = 'auto'; }
  });
  await new Promise(resolve => setTimeout(resolve, 300));
  const drillPath = path.join(outDir, 'drilldown.png');
  await page.screenshot({ path: drillPath, fullPage: true });
  console.log('Drilldown screenshot saved to', drillPath);

  await browser.close();
})();
