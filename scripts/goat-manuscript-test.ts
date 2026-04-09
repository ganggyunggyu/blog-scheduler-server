import axios from 'axios';

const MANUSCRIPT_API = 'http://localhost:8000';
const keywords = [
  '수족냉증원인', '소음인흑염소', '임산부흑염소', '흑염소진액복용법', '기력회복',
  '녹용효능', '도라지효능', '간에좋은음식', '면역력영양제', '골밀도높이는법',
];

interface Result {
  keyword: string;
  title: string;
  content: string;
  length: number;
  error?: string;
}

const main = async () => {
  const results: Result[] = [];

  for (const keyword of keywords) {
    console.log(`[${results.length + 1}/${keywords.length}] ${keyword} 생성 중...`);
    try {
      const { data } = await axios.post(`${MANUSCRIPT_API}/generate/hanryeo`, {
        service: 'test',
        keyword,
        ref: '',
      }, { timeout: 120000 });

      const content = data.content || data.text || '';
      const title = data.title || content.split('\n')[0]?.slice(0, 50) || keyword;
      results.push({ keyword, title, content, length: content.length });
      console.log(`  ✅ ${title} (${content.length}자)`);
    } catch (e: any) {
      console.log(`  ❌ ${e.message}`);
      results.push({ keyword, title: '', content: '', length: 0, error: e.message });
    }
  }

  console.log('\n--- 결과 요약 ---');
  for (const r of results) {
    console.log(`${r.keyword}: ${r.error ? '❌ ' + r.error : `✅ ${r.length}자`}`);
  }

  // JSON으로 출력 (시트 내보내기용)
  const outputPath = '/tmp/hanryeo-manuscripts.json';
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n결과 저장: ${outputPath}`);
};

main().catch(console.error);
