import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AdminEventsPage } from '../../apps/web/src/routes/admin/AdminEventsPage';
import '../../apps/web/src/styles/theme.css';
import '../../apps/web/src/styles/global.css';
import '../../apps/web/src/features/events/eventManagement.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><main className="admin-content"><AdminEventsPage /></main></BrowserRouter>);
