import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// StrictMode는 개발 중 effect를 두 번 실행해 PixiJS 앱을 두 번 만들기 때문에 쓰지 않는다.
createRoot(document.getElementById('root')!).render(<App />);
