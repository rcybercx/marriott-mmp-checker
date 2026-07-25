import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const HOTEL = 'Sheraton Okinawa Sunmarina Resort';
const PROPERTY_CODE = 'OKASI';
const CHECK_IN = '2026-07-25';
const CHECK_OUT = '2026-07-26';
const RATE_CODE = 'MMP';
const ARTIFACT_DIR = 'artifacts/public-test';

await fs.mkdir(ARTIFACT_DIR, { recursive: true });

const nowJst = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
}).format(new Date());

const searchUrl = new URL('https://www.marriott.com/search/findHotels.mi');
searchUrl.searchParams.set('destinationAddress.destination', HOTEL);
searchUrl.searchParams.set('propertyCode', PROPERTY_CODE);
searchUrl.searchParams.set('fromDate', CHECK_IN);
searchUrl.searchParams.set('toDate', CHECK_OUT);
searchUrl.searchParams.set('clusterCode', 'corp');
searchUrl.searchParams.set('corporateCode', RATE_CODE);
searchUrl.searchParams.set('useRewardsPoints', 'false');

let browser;
let page;
let responseStatus = null;
let finalUrl = null;
let title = null;
let bodyText = '';
let error = null;

try {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1440, height: 1100 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'accept-language': 'en-US,en;q=0.9',
      'upgrade-insecure-requests': '1',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  page = await context.newPage();
  page.setDefaultTimeout(30000);

  const response = await page.goto(searchUrl.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  responseStatus = response?.status() ?? null;
  await page.waitForTimeout(8000);

  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch {
    // Marriott pages may keep analytics connections open.
  }

  finalUrl = page.url();
  title = await page.title();
  bodyText = await page.locator('body').innerText({ timeout: 15000 }).catch(() => '');

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'marriott-page.png'),
    fullPage: true,
  });

  await fs.writeFile(path.join(ARTIFACT_DIR, 'page.html'), await page.content(), 'utf8');
} catch (err) {
  error = err instanceof Error ? err.message : String(err);

  if (page) {
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'marriott-error.png'),
      fullPage: true,
    }).catch(() => {});
  }
} finally {
  await browser?.close().catch(() => {});
}

const normalized = `${title ?? ''}\n${bodyText}`.toLowerCase();
const hotelVisible = normalized.includes('sheraton okinawa sunmarina') || normalized.includes(PROPERTY_CODE.toLowerCase());
const mmpVisible = normalized.includes('explore rate') || normalized.includes('explore friends rate') || normalized.includes('mmp');
const blockedTerms = [
  'access denied',
  'captcha',
  'verify you are human',
  'unusual traffic',
  'request unsuccessful',
  'reference #',
];
const blocked = responseStatus === 403 || blockedTerms.some((term) => normalized.includes(term));

const yenMatches = [...bodyText.matchAll(/(?:JPY|¥)\s?([0-9]{1,3}(?:,[0-9]{3})*)/gi)]
  .map((match) => Number(match[1].replaceAll(',', '')))
  .filter(Number.isFinite);
const lowestVisibleYen = yenMatches.length ? Math.min(...yenMatches) : null;

const result = {
  checkedAtJst: nowJst,
  hotel: HOTEL,
  propertyCode: PROPERTY_CODE,
  checkIn: CHECK_IN,
  checkOut: CHECK_OUT,
  rateCode: RATE_CODE,
  mode: 'playwright-public-no-login',
  requestUrl: searchUrl.toString(),
  httpStatus: responseStatus,
  finalUrl,
  pageTitle: title,
  hotelVisible,
  mmpTextVisible: mmpVisible,
  lowestVisibleYen,
  blocked,
  error,
};

await fs.writeFile(
  path.join(ARTIFACT_DIR, 'result.json'),
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify(result, null, 2));

const statusEmoji = blocked ? '🛑' : hotelVisible ? '✅' : '⚠️';
const lines = [
  '🧪 **TEST NOTIFICATION — not an availability alert**',
  `${statusEmoji} **Sheraton Okinawa Playwright test**`,
  `Hotel: ${HOTEL} (${PROPERTY_CODE})`,
  `Dates: ${CHECK_IN} to ${CHECK_OUT}`,
  'Mode: Real Chromium browser / no Marriott login',
  `HTTP status: ${responseStatus ?? 'none'}`,
  `Page title: ${title || 'none'}`,
  `Hotel detected: ${hotelVisible ? 'yes' : 'no'}`,
  `MMP/Explore text detected: ${mmpVisible ? 'yes' : 'no'}`,
  `Lowest visible price: ${lowestVisibleYen ? `¥${lowestVisibleYen.toLocaleString('en-CA')}` : 'none'}`,
  `Blocked/challenge detected: ${blocked ? 'yes' : 'no'}`,
  `Checked: ${nowJst} JST`,
  `Final URL: ${finalUrl || searchUrl.toString()}`,
];

if (error) lines.push(`Error: ${error.slice(0, 500)}`);
lines.push('Screenshot, HTML, and result JSON were saved to the workflow artifacts.');

const webhook = process.env.DISCORD_WEBHOOK_URL;
if (webhook) {
  const discordResponse = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'MARRIOTT MMP',
      content: lines.join('\n'),
      allowed_mentions: { parse: [] },
    }),
  });

  if (!discordResponse.ok) {
    throw new Error(`Discord notification failed with HTTP ${discordResponse.status}`);
  }

  console.log('Discord notification sent.');
} else {
  console.log('DISCORD_WEBHOOK_URL is not configured; notification preview follows:');
  console.log(lines.join('\n'));
}

// Preserve artifacts even when Marriott blocks the request, without making the test workflow fail.
if (error) process.exitCode = 1;
