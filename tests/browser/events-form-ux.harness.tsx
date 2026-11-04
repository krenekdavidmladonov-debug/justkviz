import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AdminShell } from '../../apps/web/src/app/AdminShell';
import { AdminEventCreatePage } from '../../apps/web/src/routes/admin/AdminEventCreatePage';
import { AdminEventDetailPage } from '../../apps/web/src/routes/admin/AdminEventDetailPage';
import '../../apps/web/src/styles/theme.css';
import '../../apps/web/src/styles/global.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes><Route element={<AdminShell />}>
      <Route path="/admin/events/new" element={<AdminEventCreatePage />} />
      <Route path="/admin/events/:eventId" element={<AdminEventDetailPage />} />
    </Route></Routes>
  </BrowserRouter>,
);
