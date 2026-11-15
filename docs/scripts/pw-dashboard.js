const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: null });
  const page = await ctx.newPage();
  await page.goto('https://localhost:19888/login?t=<TOKEN_FROM_aspire_ps>', { timeout: 60000 });
  console.log('opened', await page.title());
  await new Promise(() => {}); // keep open
})();
