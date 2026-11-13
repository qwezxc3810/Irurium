/**
 * 검증 보고서 생성: npm run lab:report → docs/validation/REPORT.md
 * 샘플(가상 관장) 기록만 사용한다. 실제 기록·기존 스냅샷은 읽지도 바꾸지도 않는다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildReport } from '../src/lab/report';
import { runSuite } from '../src/lab/runner';

const suite = runSuite();
const md = buildReport(suite, { determinism: true });
mkdirSync('docs/validation', { recursive: true });
writeFileSync('docs/validation/REPORT.md', md + '\n');
console.log(`docs/validation/REPORT.md 작성 (시나리오 ${suite.scenarios.length}개, ${suite.ms}ms)`);
