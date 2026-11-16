import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './app/router';
import { AuthProvider } from './auth/AuthProvider';
import { DriveConnectionSessionGuard } from './features/drive/DriveConnectionCallback';
import { productConfig } from './config/product';
import { pageTitle } from './config/pageTitle';
import './styles/global.css';
import './styles/editor.css';

const rootElement = document.getElementById('root');
const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');

document.title = pageTitle(router.state.location.pathname);
router.subscribe((state) => { document.title = pageTitle(state.location.pathname); });
description?.setAttribute('content', productConfig.description);

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
