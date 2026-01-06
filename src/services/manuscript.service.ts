import axios from 'axios';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { env } from '../config/env';

interface Manuscript {
  _id?: string;
  content?: string;
  keyword?: string;
  category?: string;
  engine?: string;
}

export async function generateManuscript(
  keyword: string,
  service: string,
  ref: string = ''
): Promise<{ id: string; title: string; content: string; raw: Manuscript }> {
  const response = await axios.post<Manuscript>(
    `${env.MANUSCRIPT_API_URL}/generate/grok`,
    {
      service,
      keyword,
      ref,
    },
    { timeout: 300000 }
  );

  const raw = response.data;
  const lines = (raw.content ?? '').split('\n');
  const title = (lines[0] ?? '').trim() || keyword;
  const content = lines.slice(1).join('\n').trim();

  return { id: raw._id ?? '', title, content, raw };
}

export async function generateImageUrls(
  keyword: string,
  imageCount: number,
  category?: string
): Promise<string[]> {
  const response = await axios.post(
    `${env.MANUSCRIPT_API_URL}/generate/image`,
    {
      keyword,
      count: imageCount,
      category,
    },
    { timeout: 300000 }
  );

  const data = response.data as {
    images?: string[];
    urls?: string[];
    imageUrls?: string[];
  };

  const urls = data.images ?? data.urls ?? data.imageUrls ?? [];
  return Array.isArray(urls) ? urls : [];
}

export async function downloadImages(imageUrls: string[]): Promise<string[]> {
  if (imageUrls.length === 0) return [];

  const dir = await mkdtemp(path.join(tmpdir(), 'scheduler-images-'));
  const saved: string[] = [];

  for (let i = 0; i < imageUrls.length; i += 1) {
    const imageUrl = imageUrls[i];
    const url = new URL(imageUrl);
    const ext = path.extname(url.pathname) || '.jpg';
    const filePath = path.join(dir, `${i + 1}${ext}`);

    const response = await axios.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer' });
    await writeFile(filePath, Buffer.from(response.data));
    saved.push(filePath);
  }

  return saved;
}

export async function prepareImages(
  keyword: string,
  imageCount: number,
  category?: string
): Promise<string[]> {
  const imageUrls = await generateImageUrls(keyword, imageCount, category);
  return downloadImages(imageUrls.slice(0, imageCount));
}
