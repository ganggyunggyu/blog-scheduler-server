import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';

const TARGET_DATE = process.argv.find((arg) => arg.startsWith('--date='))?.slice('--date='.length) || '2026-06-17';
const OUTPUT_PATH = `outputs/today-balance-${TARGET_DATE}.json`;
const TARGET_CATEGORIES = ['흑염소', '한려담원', '윤슬', '추상의구체화', '알리바바'];

const normalizeKeyword = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Mongo connection is not ready');
    }

    const accounts = await db.collection('blogaccounts')
      .find(
        {
          category: { $in: TARGET_CATEGORIES },
          $or: [{ isEnabled: true }, { isEnabled: { $exists: false } }],
          status: { $ne: 'disabled' },
        },
        { projection: { _id: 0, accountId: 1, blogId: 1, nickname: 1, category: 1 } },
      )
      .toArray();

    const accountById = new Map(accounts.map((account) => [account.accountId, account]));
    const scheduleRows = await db.collection('schedules')
      .find(
        {
          accountId: { $in: accounts.map((account) => account.accountId) },
          status: { $ne: 'cancelled' },
        },
        { projection: { _id: 1, accountId: 1, service: 1, ref: 1, scheduleDate: 1, status: 1, createdAt: 1 } },
      )
      .toArray();

    const scheduleById = new Map(scheduleRows.map((schedule) => [String(schedule._id), schedule]));

    const jobs = await db.collection('schedulejobs')
      .find(
        {
          scheduleId: { $in: scheduleRows.map((schedule) => schedule._id) },
          scheduledAt: { $regex: `^${TARGET_DATE}` },
          status: { $ne: 'cancelled' },
        },
        {
          projection: {
            _id: 1,
            scheduleId: 1,
            keyword: 1,
            category: 1,
            scheduledAt: 1,
            slot: 1,
            status: 1,
            generateJobId: 1,
            publishJobId: 1,
            postUrl: 1,
            completedAt: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      )
      .sort({ scheduledAt: 1, createdAt: 1, _id: 1 })
      .toArray();

    const enriched = jobs.flatMap((job) => {
      const schedule = scheduleById.get(String(job.scheduleId));
      const account = schedule ? accountById.get(schedule.accountId) : null;
      if (!schedule || !account) {
        return [];
      }
      return [{
        id: String(job._id),
        scheduleId: String(job.scheduleId),
        accountId: schedule.accountId,
        blogId: account.blogId || schedule.accountId,
        nickname: account.nickname || schedule.accountId,
        accountCategory: account.category,
        service: schedule.service || '',
        ref: schedule.ref || '',
        scheduleDate: schedule.scheduleDate,
        scheduleStatus: schedule.status,
        keyword: job.keyword,
        normalizedKeyword: normalizeKeyword(job.keyword),
        jobCategory: job.category || '',
        scheduledAt: job.scheduledAt,
        slot: job.slot,
        status: job.status,
        generateJobId: job.generateJobId || '',
        publishJobId: job.publishJobId || '',
        postUrl: job.postUrl || '',
        completedAt: job.completedAt || null,
        createdAt: job.createdAt || null,
        updatedAt: job.updatedAt || null,
      }];
    });

    const categorySummary = new Map();
    const duplicateMap = new Map();
    for (const row of enriched) {
      const key = row.accountCategory;
      const summary = categorySummary.get(key) ?? { total: 0, byStatus: {}, accounts: {} };
      summary.total += 1;
      summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + 1;
      summary.accounts[row.accountId] = (summary.accounts[row.accountId] ?? 0) + 1;
      categorySummary.set(key, summary);

      const duplicateKey = `${row.accountCategory}\u0000${row.normalizedKeyword}`;
      const duplicateRows = duplicateMap.get(duplicateKey) ?? [];
      duplicateRows.push(row);
      duplicateMap.set(duplicateKey, duplicateRows);
    }

    const duplicates = Array.from(duplicateMap.values())
      .filter((rows) => rows.length > 1)
      .map((rows) => ({
        category: rows[0].accountCategory,
        keyword: rows[0].keyword,
        normalizedKeyword: rows[0].normalizedKeyword,
        count: rows.length,
        rows: rows.map((row) => ({
          id: row.id,
          accountId: row.accountId,
          nickname: row.nickname,
          scheduledAt: row.scheduledAt,
          status: row.status,
          postUrl: row.postUrl,
        })),
      }));

    const report = {
      targetDate: TARGET_DATE,
      generatedAt: new Date().toISOString(),
      accounts: accounts
        .map((account) => ({
          accountId: account.accountId,
          blogId: account.blogId || account.accountId,
          nickname: account.nickname || account.accountId,
          category: account.category,
        }))
        .sort((left, right) => `${left.category}\u0000${left.nickname}`.localeCompare(`${right.category}\u0000${right.nickname}`, 'ko')),
      summary: Object.fromEntries(Array.from(categorySummary.entries()).sort(([left], [right]) => left.localeCompare(right, 'ko'))),
      duplicates,
      jobs: enriched,
    };

    await fs.mkdir('outputs', { recursive: true });
    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    console.log(JSON.stringify({
      outputPath: OUTPUT_PATH,
      targetDate: TARGET_DATE,
      summary: report.summary,
      duplicateCount: duplicates.length,
      jobCount: enriched.length,
    }, null, 2));
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
