import 'dotenv/config';
import fs from 'fs';

const SENTINEL = '/tmp/alibaba_meta2_triggered';

const ACCOUNTS = [
  { id: 'crvfwy7062', password: 'akfalwk12@', group: 'A', label: '블로그1' },
  { id: 'heavymouse448', password: 'akfalwk12@', group: 'A', label: '블로그3' },
  { id: 'rqr1io45', password: 'akfalwk12@', group: 'A', label: '블로그5' },
  { id: 'wzlphw5449', password: 'akfalwk12@', group: 'B', label: '블로그2' },
  { id: 'ui3nnkai', password: 'akfalwk12@', group: 'B', label: '블로그4' },
  { id: 'individual14144', password: 'jito308141', group: 'B', label: '블로그6' },
];

const KEYWORDS = {
  A: ['해외직구관세기준', '해외직구관세', '국제배송조회'],
  B: ['타오바오', '1688', '타오바오 직구방법'],
};

const ALL_KEYWORDS = [...KEYWORDS.A, ...KEYWORDS.B];

const checkImageMatch = async () => {
  let matched = 0;
  const details = [];
  for (const kw of ALL_KEYWORDS) {
    try {
      const url = `http://localhost:3939/api/image/product-images?keyword=${encodeURIComponent(kw)}&manuscriptType=alibaba&count=5`;
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      const excl = (j.images?.excludeLibrary || []).length;
      const body = (j.images?.body || []).length;
      const ok = excl >= 1;
      if (ok) matched += 1;
      details.push({ kw, excl, body, ok });
    } catch (e) {
      details.push({ kw, err: e.message });
    }
  }
  return { matched, total: ALL_KEYWORDS.length, details };
};

const triggerAutoUpdate = async () => {
  const results = [];
  for (const account of ACCOUNTS) {
    const body = {
      queues: [
        {
          account: { id: account.id, password: account.password },
          keywords: KEYWORDS[account.group],
          update_count: 3,
        },
      ],
      manuscript_type: 'alibaba',
      image_source: 'product',
      image_count: 5,
      keyword_category: '기타',
      generate_images: true,
      delay_between_posts: 10,
      service: 'default',
      ref: '',
    };
    const res = await fetch('http://localhost:8001/bot/auto-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    results.push({
      label: account.label,
      accountId: account.id,
      status: res.status,
      totalJobs: json.totalJobs,
      posts: (json.updates?.[0]?.posts || []).map((p) => ({ logNo: p.logNo, title: p.title })),
      error: json.message || null,
    });
  }
  return results;
};

const ts = () => new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

const main = async () => {
  if (fs.existsSync(SENTINEL)) {
    console.log(`[${ts()}] already triggered (sentinel exists). exit.`);
    return;
  }
  console.log(`[${ts()}] watcher start (poll every 60s, threshold ≥5/6 매칭)`);
  let pollCount = 0;
  while (true) {
    pollCount += 1;
    const { matched, total, details } = await checkImageMatch();
    console.log(`[${ts()}] poll #${pollCount} matched ${matched}/${total}`);
    for (const d of details) {
      const tag = d.ok ? '✓' : '✗';
      console.log(`  ${tag} ${d.kw} excl=${d.excl ?? '-'} body=${d.body ?? '-'}${d.err ? ` err=${d.err}` : ''}`);
    }
    if (matched >= 5) {
      fs.writeFileSync(SENTINEL, new Date().toISOString());
      console.log(`[${ts()}] THRESHOLD MET. triggering auto-update for 6 accounts...`);
      const result = await triggerAutoUpdate();
      console.log(JSON.stringify(result, null, 2));
      console.log(`[${ts()}] auto-update dispatched. watcher exit.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 60000));
  }
};

main().catch((e) => {
  console.error('watcher error:', e);
  process.exit(1);
});
