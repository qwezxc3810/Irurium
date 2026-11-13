import { describe, expect, it } from 'vitest';
import { analyzeMood, analyzeNote } from '../mood';

describe('analyzeMood', () => {
  it('칩도 한마디도 없으면 중립', () => {
    expect(analyzeMood([], '')).toMatchObject({ temp: 0, energy: 0, confidence: 0 });
  });

  it('칩만 있으면 칩 벡터를 그대로 쓴다', () => {
    const m = analyzeMood(['따뜻함'], '');
    expect(m.temp).toBeCloseTo(0.8);
    expect(m.labels).toEqual(['따뜻함']);
  });

  it('칩 0.7 + 한마디 0.3으로 합친다', () => {
    const m = analyzeMood(['따뜻함'], '쓸쓸하다');
    expect(m.temp).toBeCloseTo(0.8 * 0.7 + -0.6 * 0.3);
  });

  it('한마디만 있어도 키워드와 이모지로 분석한다', () => {
    expect(analyzeMood([], '장미 얄밉다 😤').temp).toBeLessThan(0);
    expect(analyzeMood([], '몽글몽글').temp).toBeGreaterThan(0);
  });

  it('신뢰도가 낮은 한마디는 감정에 반영하지 않는다', () => {
    expect(analyzeMood([], '오늘 30쪽').confidence).toBe(0);
  });

  it('부정어는 가중치를 낮춘다', () => {
    expect(analyzeNote('안 슬프다').confidence).toBeLessThan(analyzeNote('슬프다').confidence);
  });
});
