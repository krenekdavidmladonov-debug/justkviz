import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './app/router';
import { AuthProvider } from './auth/AuthProvider';
import { DriveConnectionSessionGuard } from './features/drive/DriveConnectionCallback';
import { pageTitle } from './config/pageTitle';
import './styles/global.css';
import './styles/editor.css';

const rootElement = document.getElementById('root');

let pathname = router.state.location.pathname;
document.title = pageTitle(pathname);
router.subscribe(({ location }) => {
  if (location.pathname === pathname) return;
  pathname = location.pathname;
  document.title = pageTitle(pathname);
});

if (!rootElement) {
  throw new Error('Root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <DriveConnectionSessionGuard />
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
