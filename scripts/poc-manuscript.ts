import dotenv from 'dotenv';
import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import { writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

dotenv.config({ path: process.env.ENV_FILE ?? '.env' });

const execFileAsync = promisify(execFile);
const CHECK_PY = '/Users/ganggyunggyu/Downloads/코덱스 일반원고 - 복사본/check.py';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// 코덱스 일반원고 스킬(00_스킬메인 + 03_정보성) 규칙 + 서식 마커
const SYSTEM_PROMPT = `너는 네이버 블로그 상위노출 정보성 원고 전문 작가다.
목표: 검색자가 이 글 하나만 읽고 다른 글을 더 찾지 않아도 되게, 궁금증을 한 번에 해소하는 정보 글을 쓴다.

[유형] 정보성 = 화자 없는 설명체. 합니다체(~입니다/~습니다)로 일관한다.

[구조]
- 큰 소제목 6개 + 마지막 소제목은 반드시 "자주 묻는 질문"(FAQ 역할). 번호(1. 2. …)를 붙인 소제목으로.
- 기승전결: 도입(문제 규모·수요로 연다) → 1층 기본정보 → 2층 심화(문제장면→원리→해결기준) → 결(상황별 정리).
- 2번 소제목은 "의사결정"으로: A상황이면 이것, B면 저것.

[밀도 — 가장 중요]
- 공백제외 2300~2700자를 지킨다. 절대 2800자를 넘기지 않는다(넘으면 검수 실패).
- 모든 블록에 구체 수치(가격·%·분·회·개월·mm·원). 글 전체 숫자 데이터 20개 이상.
- 효과·차이·비교·변화를 말하는 문장엔 반드시 데이터를 붙인다. 못 붙이면 삭제.
- 추상 형용사("좋다·시원하다")만인 문단 금지. 수치 하나를 축으로 2~3문장에 압축.

[제목]
- 메인 키워드 + 서브 키워드 조합. 공백제외 13~26자. 완결형. 제목에 'FAQ' 글자 금지.

[권위·출처]
- 핵심 수치엔 출처를 본문에 직접, 글당 2~3회, 구어체로. "한계 인정"을 1회 넣어 광고티를 뺀다.

[모바일 가독성]
- 한 줄은 의미 한 덩이, 공백제외 40자 이내. 한 문장도 2~3줄로 끊는다. 소재 바뀌면 빈 줄로 문단 분리.

[★서식 마커 — 반드시 사용]
- 인용구: 글에서 가장 핵심이 되는 한 문장 2~3개를, 그 줄 맨 앞에 "> "를 붙여 인용구로 표시한다. (인용구 줄은 앞뒤로 빈 줄을 둔다.)
- 색상 강조: 독자가 꼭 기억할 핵심 키워드·수치 5~8개를 [[텍스트]]로 감싼다. 예: [[하루 20분]], [[3개월]]. 너무 긴 문장 말고 단어·수치 단위로.

[금지 — 검수기가 자동 검출]
- 자기소개·인사, 메타표현("정리하면/오늘은 ~써볼게요/총정리/짧게 답합니다/이 글에서는/풀어봅니다/차례로 봅니다"), 쿠션("찾아보니/알아보니/결론부터 말하면").
- 도입부에 "이 글에서는 ~설명합니다" 류 안내문 절대 금지.

[정확성]
- 확실한 일반 사실·상식 수준 위주. 특정 업체명·논문·가격을 확신 없이 지어내지 말 것(불확실하면 범위·일반 기준으로).

[출력 형식]
- 첫 줄: 제목 한 줄. 그다음 빈 줄. 이후 본문(소제목은 "1. 소제목" 형태).
- 마크다운 기호(#, **, 리스트 -) 쓰지 말 것. 인용구는 "> ", 색상은 [[ ]] 마커만 쓴다.`;

type Engine = 'gemini' | 'deepseek' | 'openai';

interface CheckResult {
  pass: boolean;
  report: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const DEFAULT_MODEL: Record<Engine, string> = {
  gemini: 'gemini-2.5-flash',
  deepseek: 'deepseek-chat',
  openai: 'gpt-5.6',
};

const runCheck = async (outPath: string, title: string, keyword: string): Promise<CheckResult> => {
  try {
    const { stdout } = await execFileAsync('python3', [CHECK_PY, outPath, '--title', title, '--keyword', keyword]);
    return { pass: true, report: stdout };
  } catch (error) {
    const withStdout = error as { stdout?: string };
    return { pass: false, report: withStdout.stdout ?? String(error) };
  }
};

const extractFails = (report: string): string[] =>
  report.split('\n').filter((line) => line.includes('[FAIL]')).map((line) => line.replace(/.*\[FAIL\]\s*/, '').trim());

const summarizeReport = (report: string): string =>
  report.split('\n').filter((line) => line.includes('[OK]') || line.includes('[FAIL]')).join('\n');

const buildUserPrompt = (keyword: string, subKeyword: string, feedback: string): string => {
  const kw = subKeyword ? `메인 키워드: ${keyword}\n서브 키워드: ${subKeyword}` : `키워드: ${keyword}`;
  return feedback
    ? `${kw}\n\n직전 원고가 자동 검수에서 실패했다. 아래를 반드시 고쳐 원고 전체를 다시 작성한다:\n- ${feedback}\n\n글자수 상한(공백제외 2800자)과 금지 표현, 서식 마커(> 인용구, [[색상]])를 지켜라.`
    : `${kw}\n\n위 키워드로 정보성 상위노출 원고를 작성해라. 두 키워드를 제목과 본문에 자연스럽게 녹인다.`;
};

const callGemini = async (model: string, user: string): Promise<string> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY required');
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: user,
    config: { systemInstruction: SYSTEM_PROMPT, temperature: 0.85, maxOutputTokens: 8192 },
  });
  return (response.text ?? '').trim();
};

const callDeepSeek = async (model: string, user: string): Promise<string> => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY required');
  const response = await axios.post<ChatResponse>(
    DEEPSEEK_URL,
    {
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
      temperature: 0.85,
      max_tokens: 8192,
    },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 300000 },
  );
  return (response.data.choices?.[0]?.message?.content ?? '').trim();
};

const callOpenAI = async (model: string, user: string): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required');
  const response = await axios.post<ChatResponse>(
    OPENAI_URL,
    {
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
      max_completion_tokens: 8192,
    },
    { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 300000 },
  );
  return (response.data.choices?.[0]?.message?.content ?? '').trim();
};

const generate = async (engine: Engine, model: string, user: string): Promise<string> => {
  if (engine === 'deepseek') return callDeepSeek(model, user);
  if (engine === 'openai') return callOpenAI(model, user);
  return callGemini(model, user);
};

const runEngine = async (engine: Engine, keyword: string, subKeyword: string, outPath: string, maxRounds: number): Promise<void> => {
  const model = process.env.POC_MODEL ?? DEFAULT_MODEL[engine];
  console.log(`\n########## [${engine}] model=${model} → ${outPath} ##########`);

  let feedback = '';
  for (let round = 1; round <= maxRounds; round += 1) {
    const startedAt = Date.now();
    let text = '';
    try {
      text = await generate(engine, model, buildUserPrompt(keyword, subKeyword, feedback));
    } catch (error) {
      const axiosErr = error as { response?: { data?: unknown }; message?: string };
      console.log(`[${engine}] 호출 실패: ${axiosErr.message ?? String(error)}`);
      if (axiosErr.response?.data) console.log(JSON.stringify(axiosErr.response.data).slice(0, 300));
      return;
    }
    const title = (text.split('\n')[0] ?? keyword).trim();
    const noSpace = text.replace(/\s/g, '').length;
    await writeFile(outPath, text, 'utf8');

    const { pass, report } = await runCheck(outPath, title.replace(/\[\[|\]\]/g, ''), keyword);
    console.log(`[${engine}] round ${round} | ${Date.now() - startedAt}ms | 공백제외 ${noSpace}자`);
    console.log(summarizeReport(report));

    if (pass) {
      console.log(`[${engine}] PASS (round ${round})`);
      return;
    }
    feedback = extractFails(report).join(' / ');
    if (round === maxRounds) console.log(`[${engine}] 미통과(${maxRounds}회) — 마지막본 저장`);
  }
};

const main = async (): Promise<void> => {
  const keyword = process.argv[2] ?? '원주마사지';
  const subKeyword = process.argv[3] ?? '원주출장마사지';
  const engines = (process.env.POC_ENGINES ?? 'gemini').split(',').map((e) => e.trim()) as Engine[];
  const outDir = process.env.POC_OUT_DIR ?? '/tmp';
  const maxRounds = Number(process.env.POC_ROUNDS ?? 3);

  console.log(`[poc] engines=${engines.join(',')} keyword="${keyword}" sub="${subKeyword}"`);

  for (const engine of engines) {
    await runEngine(engine, keyword, subKeyword, `${outDir}/poc-${engine}.txt`, maxRounds);
  }
};

main().catch((error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
