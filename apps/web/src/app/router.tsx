import { PrivacyPage } from '../routes/PrivacyPage';
import { lazyAdminRoute } from './lazyAdminRoute';
import { PermissionGate } from '../features/access/PermissionGate';
import { RefereePage } from '../routes/referee/RefereePage';
import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';

import { AdminPage } from '../routes/admin/AdminPage';
import { AdminLoginPage } from '../routes/admin/AdminLoginPage';
import { AdminLoading } from '../routes/admin/AdminLoading';
import { AdminNoAccessPage } from '../routes/admin/AdminNoAccessPage';
import { RequireStaff } from '../routes/admin/RequireStaff';
import { EventsPage } from '../routes/events/EventsPage';
import { PublicEventPage } from '../routes/events/PublicEventPage';
import { ManageRegistrationPage } from '../routes/events/ManageRegistrationPage';
import { NotFoundPage } from '../routes/NotFoundPage';
import { AdminShell } from './AdminShell';
import { AppLayout } from './AppLayout';
import { RouteErrorPage } from './RouteErrorPage';
import { AccountPage } from '../routes/AccountPage';
import { UsersAccessPage } from '../routes/admin/UsersAccessPage';
import { AdminSettingsPage } from '../routes/admin/AdminSettingsPage';
import { DriveConnectionCallback } from '../features/drive/DriveConnectionCallback';
import '../styles/access.css';

const ProjectorPage = lazy(async () => {
  const module = await import('../routes/projector/ProjectorPage');
  return { default: module.ProjectorPage };
});

function LazyProjectorRoute() {
  return <Suspense fallback={<section className="projector-stage projector-message"><h1>Načítám projektor…</h1></section>}><ProjectorPage /></Suspense>;
}

export const router = createBrowserRouter([
  { path: 'admin/settings/drive/callback', element: <DriveConnectionCallback />, errorElement: <RouteErrorPage /> },
  { path: 'referee/:eventId', element: <RefereePage />, errorElement: <RouteErrorPage /> },
  { path: 'projector', element: <LazyProjectorRoute />, errorElement: <RouteErrorPage /> },
  { path: 'projector/:sessionId', element: <LazyProjectorRoute />, errorElement: <RouteErrorPage /> },
  {
    path: 'admin',
    element: <RequireStaff />,
    errorElement: <RouteErrorPage />,
    HydrateFallback: AdminLoading,
    children: [
      { path: 'live/:sessionId', lazy: lazyAdminRoute(() => import('../routes/admin/LiveControlPage').then(module => module.LiveControlPage), ['event.live']) },
      { path: 'quizzes/:quizId/edit', lazy: lazyAdminRoute(() => import('../routes/admin/QuizEditorPage').then(module => module.QuizEditorPage), ['quiz.read']) },
      {
        element: <AdminShell />,
        children: [
          { index: true, element: <AdminPage /> },
          { path: 'settings', element: <AdminSettingsPage /> },
          { path: 'users', element: <PermissionGate requires={['users.manage']}><UsersAccessPage /></PermissionGate> },
          { path: 'quizzes', lazy: lazyAdminRoute(() => import('../routes/admin/QuizLibraryPage').then(module => module.QuizLibraryPage), ['quiz.read']) },
          { path: 'quizzes/new', lazy: lazyAdminRoute(() => import('../routes/admin/QuizCreatePage').then(module => module.QuizCreatePage), ['quiz.create']) },
          { path: 'quizzes/:quizId', lazy: lazyAdminRoute(() => import('../routes/admin/QuizDetailPage').then(module => module.QuizDetailPage), ['quiz.read']) },
          { path: 'quizzes/:quizId/readiness', lazy: lazyAdminRoute(() => import('../routes/admin/QuizPreflightPage').then(module => module.QuizPreflightPage), ['quiz.read', 'quiz.answers.read']) },
          { path: 'quizzes/:quizId/readiness/repair', lazy: lazyAdminRoute(() => import('../routes/admin/QuizRepairPage').then(module => module.QuizRepairPage), ['quiz.edit', 'quiz.answers.edit']) },
          { path: 'events', lazy: lazyAdminRoute(() => import('../routes/admin/AdminEventsPage').then(module => module.AdminEventsPage), ['event.read']) },
          { path: 'events/new', lazy: lazyAdminRoute(() => import('../routes/admin/AdminEventCreatePage').then(module => module.AdminEventCreatePage), ['event.create']) },
          { path: 'events/:eventId/scoring', lazy: lazyAdminRoute(() => import('../routes/admin/AdminEventScoringPage').then(module => module.AdminEventScoringPage), ['event.read']) },
          { path: 'events/:eventId/results', lazy: lazyAdminRoute(() => import('../routes/admin/AdminEventResultsPage').then(module => module.AdminEventResultsPage), ['event.read']) },
          { path: 'events/:eventId', lazy: lazyAdminRoute(() => import('../routes/admin/AdminEventDetailPage').then(module => module.AdminEventDetailPage), ['event.read']) },
          { path: 'events/:eventId/print', lazy: lazyAdminRoute(() => import('../routes/admin/AdminPrintCenterPage').then(module => module.AdminPrintCenterPage), ['event.export']) },
          { path: 'events/:eventId/registrations', lazy: lazyAdminRoute(() => import('../routes/admin/AdminEventRegistrationsPage').then(module => module.AdminEventRegistrationsPage), ['event.contacts']) },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <EventsPage /> },
      { path: 'admin/login', element: <AdminLoginPage /> },
      { path: 'admin/no-access', element: <AdminNoAccessPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: 'invite/:inviteId', element: <AccountPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:eventId', element: <PublicEventPage /> },
      { path: 'events/:eventId/registration/manage', element: <ManageRegistrationPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
