const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: null });
  const page = await ctx.newPage();
  await page.goto('https://localhost:7298/', { timeout: 60000 });
  console.log('opened', await page.title());
  await new Promise(() => {}); // keep open
})();
