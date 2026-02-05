import { config } from 'dotenv';
config({ path: '.env.local' });
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

const client = new S3Client({
  region: 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});
const BUCKET = process.env.AWS_S3_BUCKET || '';

const SUB_FOLDERS = ['본문', '개별', '슬라이드', '콜라주', '라이브러리제외', '라이브러리제외_링크'];
const IMG_EXTS = /\.(png|jpg|jpeg|webp|gif)$/i;

async function main() {
  const localDir = process.argv[2];
  const categoryName = process.argv[3];

  if (!localDir || !categoryName) {
    console.log('Usage: npx tsx scripts/upload-category.ts <폴더경로> <카테고리명>');
    process.exit(1);
  }

  const s3Base = `category-images/${categoryName}`;
  let total = 0;

  for (const sub of SUB_FOLDERS) {
    const subDir = path.join(localDir, sub);
    if (!fs.existsSync(subDir)) continue;

    const files = fs.readdirSync(subDir).filter((f) => IMG_EXTS.test(f));
    if (files.length === 0) { console.log(`  ${sub}: 비어있음`); continue; }

    for (const file of files) {
      const body = fs.readFileSync(path.join(subDir, file));
      const ext = path.extname(file).toLowerCase();
      const contentType =
        ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.webp' ? 'image/webp'
        : 'image/gif';

      await client.send(
        new PutObjectCommand({ Bucket: BUCKET, Key: `${s3Base}/${sub}/${file}`, Body: body, ContentType: contentType })
      );
      total++;
    }
    console.log(`  ${sub}: ${files.length}장`);
  }

  const metaPath = path.join(localDir, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    await client.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: `${s3Base}/metadata.json`, Body: fs.readFileSync(metaPath), ContentType: 'application/json' })
    );
    console.log('  metadata.json 업로드 완료');
  }

  console.log(`\ncategory-images/${categoryName} 업로드 완료 (이미지 ${total}장)`);
}

main().catch(console.error);
