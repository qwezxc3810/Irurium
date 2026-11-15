/**
 * 성능 측정 장면. 엔진이 만든 샘플 상태를 그대로 쓴다(성능 측정 때문에 상태를 바꾸지 않음).
 * UI·렌더러를 불러오지 않는 파일이라 테스트(Node)에서도 쓸 수 있다.
 */
export const PERF_SCENES: Array<{ id: string; name: string; run: string; key: string; day: number }> = [
  { id: 'C14', name: '어린왕자 14일', run: 'case-C', key: 'C', day: 14 },
  { id: 'LS100', name: '꾸준형 100일', run: 'long-steady', key: 'LS', day: 100 },
  { id: 'LS200', name: '꾸준형 200일', run: 'long-steady', key: 'LS', day: 200 },
];
