import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QuizLibraryPage } from '../../apps/web/src/routes/admin/QuizLibraryPage';
import '../../apps/web/src/styles/theme.css';
import '../../apps/web/src/styles/global.css';
import '../../apps/web/src/styles/editor.css';

createRoot(document.getElementById('root')!).render(<BrowserRouter><div className="admin-shell" data-area="quizzes"><aside className="admin-sidebar"><div className="admin-brand-group"><strong>JustKvíz</strong></div><nav className="admin-navigation" aria-label="Administrace"><a className="admin-nav-link active" href="/admin/quizzes">Kvízy</a></nav></aside><main className="admin-main"><div className="admin-content"><QuizLibraryPage /></div></main></div></BrowserRouter>);
