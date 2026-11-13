import { useCallback, useRef, useState, type ReactNode } from 'react';

/**
 * 화면 안 대화상자. 브라우저의 confirm/prompt는 앱 웹뷰·임베드 환경에서 막히는 경우가 많아 쓰지 않는다.
 * ask()는 Promise로 결과를 돌려준다.
 */
export interface AskOptions {
  title: string;
  message?: string;
  /** 있으면 텍스트 입력칸을 보여준다 */
  input?: { defaultValue?: string; inputMode?: 'text' | 'numeric' };
  /** 있으면 칩 중 하나를 고르게 한다 */
  choices?: readonly string[];
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface AskResult {
  ok: boolean;
  value: string;
}

export function useDialog(): { ask: (o: AskOptions) => Promise<AskResult>; element: ReactNode } {
  const [opts, setOpts] = useState<AskOptions | null>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<((r: AskResult) => void) | null>(null);

  const ask = useCallback((o: AskOptions) => {
    setOpts(o);
    setValue(o.input?.defaultValue ?? o.choices?.[0] ?? '');
    return new Promise<AskResult>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: boolean, v = value) => {
    resolver.current?.({ ok, value: v });
    resolver.current = null;
    setOpts(null);
  };

  const element = opts ? (
    <div className="dialog-backdrop" onClick={() => close(false)}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={opts.title} onClick={(e) => e.stopPropagation()}>
        <h2>{opts.title}</h2>
        {opts.message && <p>{opts.message}</p>}
        {opts.input && (
          <input autoFocus inputMode={opts.input.inputMode} value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') close(true); }} />
        )}
        {opts.choices && (
          <div className="chips">
            {opts.choices.map((c) => (
              <button key={c} className={value === c ? 'chip on' : 'chip'} onClick={() => setValue(c)}>{c}</button>
            ))}
          </div>
        )}
        <div className="row end">
          <button onClick={() => close(false)}>{opts.cancelLabel ?? '취소'}</button>
          <button className="primary" onClick={() => close(true)}>{opts.confirmLabel ?? '확인'}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, element };
}
