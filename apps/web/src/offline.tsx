import { createRoot } from 'react-dom/client';
import { OfflineApp } from './features/offline/OfflineApp';
import './styles/global.css';
import './features/offline/offline.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element was not found.');
createRoot(root).render(<OfflineApp />);
