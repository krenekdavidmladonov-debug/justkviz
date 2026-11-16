import { createRoot } from 'react-dom/client';
import { OfflineApp } from './features/offline/OfflineApp';
import { currentOfflineMode } from './features/offline/offlineAvailability';
import './styles/global.css';
import './features/offline/offline.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element was not found.');
createRoot(root).render(currentOfflineMode() ? <OfflineApp /> : <p>Offline kvíz na této adrese není dostupný.</p>);
