// تنزيل صوت من myinstants.com: نقرأ صفحة الصوت ونطلع رابط الملف ونجيبه.
// يشتغل على Cloudflare نفسه (مو من جهازك)، ومرة وحدة لكل صوت لأن الملف ينحفظ بالـHub.

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const MIME = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4' };
export const LIB_MAX_BYTES = 1900000; // حد صف SQLite بالـDurable Object حوالي 2MB

function baseOf(env) {
  return String(env.MYINSTANTS_BASE || 'https://www.myinstants.com').replace(/\/$/, '');
}

/** يطلع رابط الصوت الأساسي من HTML الصفحة (og:audio أولًا، بعدين أول رابط /media/sounds/). */
export function audioLinkFromHtml(html) {
  const og = /<meta[^>]+property=["']og:audio["'][^>]+content=["']([^"']+)["']/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:audio["']/i.exec(html);
  if (og && /\/media\/sounds\/[^"']+\.(mp3|ogg|wav|m4a)$/i.test(og[1])) return og[1];
  const m = /\/media\/sounds\/[^"'\s<>?#]+?\.(?:mp3|ogg|wav|m4a)/i.exec(html);
  return m ? m[0] : null;
}

export async function fetchLibrarySound(env, slug) {
  const base = baseOf(env);
  const pageUrl = `${base}/en/instant/${slug}/`;
  const page = await fetch(pageUrl, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en,ar;q=0.8' } });
  if (!page.ok) throw new Error('الصفحة ' + page.status);
  const link = audioLinkFromHtml(await page.text());
  if (!link) throw new Error('ما لگينا رابط الصوت بالصفحة');
  const src = /^https?:\/\//i.test(link) ? link : base + link;
  const res = await fetch(src, { headers: { 'user-agent': UA, referer: pageUrl, accept: 'audio/*,*/*;q=0.8' } });
  if (!res.ok) throw new Error('الملف ' + res.status);
  const data = await res.arrayBuffer();
  if (data.byteLength < 600) throw new Error('الملف صغير كلش');
  if (data.byteLength > LIB_MAX_BYTES) throw new Error('الملف أكبر من 1.9MB');
  if (new Uint8Array(data, 0, 1)[0] === 0x3c) throw new Error('رجع صفحة بدل صوت');
  const ext = (/\.(mp3|ogg|wav|m4a)$/i.exec(src) || [, 'mp3'])[1].toLowerCase();
  return { data, mime: MIME[ext] || 'audio/mpeg', src };
}
