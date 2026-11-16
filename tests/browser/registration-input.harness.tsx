import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PublicEventPage } from '../../apps/web/src/routes/events/PublicEventPage';
import { ManageRegistrationPage } from '../../apps/web/src/routes/events/ManageRegistrationPage';
import '../../apps/web/src/styles/theme.css';
import '../../apps/web/src/styles/global.css';

createRoot(document.getElementById('root')!).render(
  <BrowserRouter><main className="page-shell"><Routes>
    <Route path="/events/:eventId" element={<PublicEventPage />} />
    <Route path="/events/:eventId/registration/manage" element={<ManageRegistrationPage />} />
  </Routes></main></BrowserRouter>,
);
