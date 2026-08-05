import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManuscriptRequest } from '../../src/services/manuscript.service.js';
import { verifyDabutToken } from '../../src/services/dabut-app.service.js';

/*
  다붓의 POST /generate/project 는 Depends(get_current_user) 로 막혀 있고
  프로젝트를 {_id, owner_id} 로 찾는다. 헤더가 없으면 401 이라 프로젝트 원고가
  한 건도 안 나온다. 요청을 만들 때 인증 헤더까지 같이 만들어지는지 본다.

  내장 원고 타입 경로는 인증이 없는 엔드포인트라 헤더를 붙이면 안 된다.
  실수로 붙이면 토큰이 불필요하게 밖으로 나간다.
*/

const OWNER_ID = '6a6802fc086d34ddeae9e0cf';
const PROJECT_ID = 'prj_abc123';

test('프로젝트 경로: ownerId 를 주면 Bearer 헤더가 함께 만들어진다', () => {
  const { headers } = buildManuscriptRequest('default', '흑염소 효능', 'default', '', undefined, {
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
  });

  const authorization = headers?.Authorization ?? '';
  assert.ok(authorization.startsWith('Bearer '), `Bearer 로 시작해야 함: ${authorization}`);

  const payload = verifyDabutToken(authorization.slice('Bearer '.length));
  assert.ok(payload, '붙인 토큰은 검증을 통과해야 함');
  assert.equal(payload?.sub, OWNER_ID, '토큰 주인이 요청한 계정이어야 함');
});

test('프로젝트 경로: ownerId 가 없으면 헤더를 만들지 않는다', () => {
  // 여기서 조용히 익명 호출을 보내면 다붓이 401 을 주는데, 원인을 찾기 어렵다.
  const { headers } = buildManuscriptRequest('default', '흑염소 효능', 'default', '', undefined, {
    projectId: PROJECT_ID,
  });

  assert.equal(headers?.Authorization, undefined);
});

/*
  ref 자리에는 스케쥴 배치 추적용 라벨("retry-3" 등)이 들어오는데, 이걸 그대로
  실어 보내면 다붓의 web_search pre_step 이 "사용자가 이미 참조원고를 줬다"로
  읽고 검색을 건너뛴다. 업체 정보 없이 모델한테 넘어가서 안전선 지침대로
  "정보 부족" 거절 답변(100~200자)만 나오고 700자 미달로 전부 리젝됐었다.
*/
test('프로젝트 경로: 프로젝트 식별자와 키워드가 본문에 실리고 ref 는 비운다', () => {
  const { url, body } = buildManuscriptRequest('default', '흑염소 효능', 'default', '참고', undefined, {
    projectId: PROJECT_ID,
    ownerId: OWNER_ID,
  });

  assert.ok(url.endsWith('/generate/project'), url);
  assert.equal(body.project_id, PROJECT_ID);
  assert.equal(body.keyword, '흑염소 효능');
  assert.equal(body.ref, '');
});

test('내장 원고 타입 경로: 인증 헤더를 붙이지 않는다', () => {
  const { headers } = buildManuscriptRequest('default', '흑염소 효능', 'default', '', undefined, {
    ownerId: OWNER_ID,
  });

  assert.equal(headers?.Authorization, undefined);
});
