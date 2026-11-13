import { createRoot } from 'react-dom/client';
import { LabApp } from './LabApp';
import '../../styles.css';
import './lab.css';

// 검증실 진입점(lab.html). 실제 앱(index.html → src/main.tsx)과 따로 빌드·실행된다.
createRoot(document.getElementById('root')!).render(<LabApp />);
