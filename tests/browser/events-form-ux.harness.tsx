import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { AdminShell } from '../../apps/web/src/app/AdminShell';
import { AdminEventCreatePage } from '../../apps/web/src/routes/admin/AdminEventCreatePage';
import { AdminEventDetailPage } from '../../apps/web/src/routes/admin/AdminEventDetailPage';
import '../../apps/web/src/styles/theme.css';
import '../../apps/web/src/styles/global.css';

function isCurrentEntry(entryKey: string): boolean {
  return router.state.location.key === entryKey && router.state.navigation.state === 'idle';
}

const router = createBrowserRouter([{ element: <AdminShell />, children: [
  { path: '/admin/events/new', element: <AdminEventCreatePage isCurrentEntry={isCurrentEntry} /> },
  { path: '/admin/events/:eventId', element: <AdminEventDetailPage /> },
] }]);

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
