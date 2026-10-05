// ورقة كل الإكسسوارات بحجم كبير: node accsheet.mjs <out.png> [base]
import { chromium } from 'playwright';
const out = process.argv[2];
const BASE = process.argv[3] || 'http://127.0.0.1:8787';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
await page.goto(BASE + '/');
await page.waitForTimeout(1500);
const html = await page.evaluate(async () => {
  const m = await import('/js/stage.js');
  const faces = ['face:sunglasses', 'face:nerd', 'face:clown', 'face:mustache', 'face:eyepatch', 'face:star', 'face:mask', 'face:monocle'];
  const heads = ['head:party', 'head:cap', 'head:chef', 'head:headphones', 'head:bunny', 'head:cowboy', 'head:straw', 'head:tophat', 'head:horns', 'head:crown', 'head:halo', 'head:flower', 'head:viking', 'head:wizard', 'head:propeller', 'head:goldcrown'];
  const cells = [];
  faces.forEach((f, i) => cells.push([f, m.portrait(i % 8, { face: f }, 300)]));
  heads.forEach((h, i) => cells.push([h, m.portrait((i + 3) % 8, { head: h }, 300)]));
  return cells;
});
await page.setContent(
  `<body style="margin:0;background:#3b1d20;display:flex;flex-wrap:wrap;gap:6px;padding:6px;font:14px sans-serif;color:#fff">` +
    html.map(([n, u]) => `<div style="text-align:center"><img src="${u}" width="200" height="200" style="background:#6a3540;border-radius:12px"><div>${n}</div></div>`).join('') +
    '</body>',
);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
