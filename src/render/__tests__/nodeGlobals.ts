// Node 20(CI)에는 전역 navigator가 없어 pixi.js를 불러올 때 멈춘다. 테스트에서 실제 FishView를 만들기 위한 최소 대역(그리기는 하지 않음)
const g = globalThis as { navigator?: unknown };
if (typeof g.navigator === 'undefined') g.navigator = { userAgent: 'node', platform: 'node', maxTouchPoints: 0 };
export {};
