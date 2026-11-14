/**
 * 어린왕자 데모 재생 해시(입력 해시:상태 해시). 엔진 계산이 바뀌면 값이 바뀐다.
 * 바꿀 때는 ENGINE_VERSION을 올리고, 여기에 새 버전 값을 추가한다. 지난 버전 값은 기록으로 남긴다.
 */
export const GOLDEN_REPLAY: Record<string, string> = {
  '0.1.0': '897f99bd:a2f000ff', // main b809973 ~ bb039c0
  '0.2.0': 'b8124dae:25b3d408', // 이슈 #9 물고기 헤엄 공간 예산
};
