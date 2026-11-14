/**
 * 측정 환경 판정. 실제 휴대폰 값과 개발 환경 시뮬레이션 값을 섞지 않기 위해 결과마다 붙인다.
 * 자동 판정은 추정일 뿐이라(개발자 도구의 기기 흉내도 휴대폰처럼 보인다), 사람이 "실제 휴대폰에서 쟀는지"를 따로 고른다.
 */
export type EnvKind = 'simulated' | 'mobile' | 'desktop';
export type Declared = 'unset' | 'real-phone' | 'not-real';

export interface NavLike {
  userAgent: string;
  webdriver?: boolean;
  maxTouchPoints?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

export interface EnvInfo {
  kind: EnvKind;
  reasons: string[];
  userAgent: string;
  cores: number | null;
  memoryGb: number | null;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;
const HEADLESS_UA = /HeadlessChrome/i;

export function detectEnvironment(nav: NavLike): EnvInfo {
  const reasons: string[] = [];
  let kind: EnvKind;
  if (nav.webdriver || HEADLESS_UA.test(nav.userAgent)) {
    kind = 'simulated';
    reasons.push(nav.webdriver ? '자동화 브라우저(navigator.webdriver)' : '헤드리스 브라우저');
  } else if (MOBILE_UA.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 0) {
    kind = 'mobile';
    reasons.push('휴대폰 브라우저 정보와 터치 화면');
  } else {
    kind = 'desktop';
    reasons.push(MOBILE_UA.test(nav.userAgent) ? '휴대폰 정보지만 터치 없음(개발자 도구 흉내일 수 있음)' : '데스크톱 브라우저');
  }
  return {
    kind,
    reasons,
    userAgent: nav.userAgent,
    cores: nav.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
  };
}

/** 결과에 붙일 측정 출처. 사람이 실제 휴대폰이라고 확인했고 자동 판정도 휴대폰일 때만 "실제 휴대폰" */
export function sourceLabel(env: EnvInfo, declared: Declared): { real: boolean; text: string } {
  if (env.kind === 'simulated') return { real: false, text: '개발 환경 시뮬레이션(자동화·헤드리스)' };
  if (declared === 'real-phone' && env.kind === 'mobile') return { real: true, text: '실제 휴대폰(측정자 확인)' };
  if (declared === 'real-phone') return { real: false, text: '확인 필요: 실제 휴대폰이라고 골랐지만 휴대폰으로 보이지 않음' };
  if (declared === 'not-real') return { real: false, text: env.kind === 'mobile' ? '개발 환경 시뮬레이션(측정자 확인: 실기기 아님)' : '개발 환경(데스크톱)' };
  return { real: false, text: env.kind === 'mobile' ? '미확인: 휴대폰으로 보이지만 측정자가 실기기인지 고르지 않음' : '개발 환경(데스크톱)' };
}

export function currentEnvironment(): EnvInfo {
  const n = navigator as Navigator & { deviceMemory?: number };
  return detectEnvironment({
    userAgent: n.userAgent,
    webdriver: n.webdriver,
    maxTouchPoints: n.maxTouchPoints,
    hardwareConcurrency: n.hardwareConcurrency,
    deviceMemory: n.deviceMemory,
  });
}
