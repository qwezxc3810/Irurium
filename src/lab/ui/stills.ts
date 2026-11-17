import { AquariumRenderer } from '../../render/AquariumRenderer';
import { hashOf } from '../../engine/random';
import type { TankState } from '../../engine/types';
import { RENDER_STYLE, type RenderStyle } from '../../render/atmosphere';

/**
 * 갤러리용 정지 그림 공장. 실제 앱과 같은 AquariumRenderer를 화면 밖에 하나만 만들어 차례로 그린다.
 * (어항마다 WebGL 화면을 따로 만들면 브라우저 한도에 걸리기 때문)
 */
const SIZE = { width: 400, height: 240 };

class StillService {
  private starting: Promise<AquariumRenderer> | null = null;
  private cache = new Map<string, string>();
  private queue: Array<{ key: string; state: TankState; moss: 0 | 1 | 2 | 3; spread: number; style: RenderStyle; resolve: (u: string) => void; reject: (e: unknown) => void }> = [];
  private pumping = false;
  failed: string | null = null;

  private start(): Promise<AquariumRenderer> {
    if (!this.starting) {
      this.starting = (async () => {
        const r = new AquariumRenderer();
        await r.init(null, { still: SIZE });
        return r;
      })();
    }
    return this.starting;
  }

  /** spread: 감정 이력 흔들림(분위기 렌더링), style: 렌더링 버전 */
  get(state: TankState, moss: 0 | 1 | 2 | 3, extra: { spread?: number; style?: RenderStyle } = {}): Promise<string> {
    const spread = extra.spread ?? 0;
    const style = extra.style ?? RENDER_STYLE;
    const key = hashOf({ state, moss, spread, style });
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      this.queue.push({ key, state, moss, spread, style, resolve, reject });
      void this.pump();
    });
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const r = await this.start();
      while (this.queue.length) {
        const job = this.queue.shift()!;
        const hit = this.cache.get(job.key);
        if (hit) { job.resolve(hit); continue; }
        try {
          r.setRenderStyle(job.style);
          const url = r.renderStill(job.state, { mossStage: job.moss, moodSpread: job.spread });
          this.cache.set(job.key, url);
          job.resolve(url);
        } catch (e) {
          job.reject(e);
        }
        // 화면이 멈추지 않게 한 장씩 숨을 돌린다
        await new Promise((res) => setTimeout(res, 0));
      }
    } catch (e) {
      this.failed = String(e);
      for (const j of this.queue.splice(0)) j.reject(e);
    } finally {
      this.pumping = false;
    }
  }

  /** 남은 작업 수(진행 표시용) */
  get pending() {
    return this.queue.length;
  }

}

export const stills = new StillService();
