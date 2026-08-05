import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduleJobDocuments } from '../../src/services/schedule.service.js';

/*
  항목별 projectId 가 DB 로 안 넘어가서, 잡을 저장하는 순간 프로젝트 지정이
  사라졌다. 워커는 projectId 가 없으니 manuscriptType 기본값으로 떨어졌고
  옛 엔드포인트를 불러 실패했다. 화면에서 맛집1/맛집2 를 섞어 보내도
  둘 다 기본 원고로 나가던 원인이다.
*/

const baseItem = {
  keyword: '산본맛집',
  category: '맛집',
  scheduledAt: new Date('2026-08-05T12:00:00+09:00'),
  slot: 0,
};

test('항목별 projectId 를 저장 문서에 싣는다', () => {
  const [doc] = buildScheduleJobDocuments('sch_1', [{ ...baseItem, projectId: 'prj_matjip1' }]);
  assert.equal(doc.projectId, 'prj_matjip1');
});

test('키워드마다 다른 프로젝트를 각각 유지한다', () => {
  const docs = buildScheduleJobDocuments('sch_1', [
    { ...baseItem, keyword: '산본맛집', projectId: 'prj_matjip1', slot: 0 },
    { ...baseItem, keyword: '부천중동맛집', projectId: 'prj_matjip2', slot: 1 },
  ]);

  assert.equal(docs[0].projectId, 'prj_matjip1');
  assert.equal(docs[1].projectId, 'prj_matjip2');
});

test('업체명과 원고 타입도 함께 실린다', () => {
  const [doc] = buildScheduleJobDocuments('sch_1', [
    { ...baseItem, businessName: '빙화만두집', manuscriptType: 'restaurant/v1' },
  ]);

  assert.equal(doc.businessName, '빙화만두집');
  assert.equal(doc.manuscriptType, 'restaurant/v1');
});

test('projectId 가 없으면 undefined 로 둔다', () => {
  const [doc] = buildScheduleJobDocuments('sch_1', [baseItem]);
  assert.equal(doc.projectId, undefined);
});

test('scheduleId 와 초기 상태를 채운다', () => {
  const [doc] = buildScheduleJobDocuments('sch_42', [baseItem]);
  assert.equal(doc.scheduleId, 'sch_42');
  assert.equal(doc.status, 'pending');
  assert.equal(doc.slot, 0);
  assert.equal(doc.keyword, '산본맛집');
});
