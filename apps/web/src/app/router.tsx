import { loadPublicEvent } from '../features/events/publicEventRead';
import { PrivacyPage } from '../routes/PrivacyPage';
import { lazyAdminRoute } from './lazyAdminRoute';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, useMatches, type RouteObject } from 'react-router-dom';

import { AdminLoading } from '../routes/admin/AdminLoading';
import { NotFoundPage } from '../routes/NotFoundPage';
import { AppLayout } from './AppLayout';
import { RouteErrorPage } from './RouteErrorPage';
import { QuizLoading } from '../features/quizzes/QuizLoading';

const ProjectorPage = lazy(async () => {
  const module = await import('../routes/projector/ProjectorPage');
  return { default: module.ProjectorPage };
});

function LazyProjectorRoute() {
  return <Suspense fallback={<section className="projector-stage projector-message"><h1>Načítám projektor…</h1></section>}><ProjectorPage /></Suspense>;
}

function PublicEventLoading() {
  return <section className="public-event-detail"><div className="event-public-state" role="status">Načítám akci…</div></section>;
}

function PublicRouteLoading() {
  return <QuizLoading label="Načítám stránku…" />;
}

const lazyAccountRoute = async () => {
  const { AccountPage } = await import('../routes/AccountPage');
  return { Component: AccountPage };
};

function isCurrentCreationEntry(entryKey: string): boolean {
  return router.state.location.key === entryKey && router.state.navigation.state === 'idle';
}

const sessionRoutes: RouteObject[] = [
  { path: 'admin/settings/drive/callback', lazy: async () => ({ Component: (await import('../features/drive/DriveConnectionCallback')).DriveConnectionCallback }), errorElement: <RouteErrorPage /> },
  { path: 'referee/:eventId', lazy: async () => ({ Component: (await import('../routes/referee/RefereePage')).RefereePage }), errorElement: <RouteErrorPage /> },
  { path: 'projector', element: <LazyProjectorRoute />, errorElement: <RouteErrorPage /> },
  { path: 'projector/:sessionId', element: <LazyProjectorRoute />, errorElement: <RouteErrorPage /> },
  {
    path: 'admin',
    lazy: async () => ({ Component: (await import('../routes/admin/RequireStaff')).RequireStaff }),
    errorElement: <RouteErrorPage />,
    HydrateFallback: AdminLoading,
    children: [
      { path: 'live/:sessionId', lazy: lazyAdminRoute(() => import('../routes/admin/LiveControlPage').then(module => module.LiveControlPage), ['event.live']) },
      { path: 'quizzes/:quizId/edit', lazy: lazyAdminRoute(() => import('../routes/admin/QuizEditorPage').then(module => module.QuizEditorPage), ['quiz.read']) },
      {
        lazy: async () => ({ Component: (await import('../app/AdminShell')).AdminShell }),
        children: [
          { index: true, lazy: async () => ({ Component: (await import('../routes/admin/AdminPage')).AdminPage }) },
          { path: 'settings', lazy: async () => ({ Component: (await import('../routes/admin/AdminSettingsPage')).AdminSettingsPage }) },
          { path: 'users', lazy: lazyAdminRoute(() => import('../routes/admin/UsersAccessPage').then(module => module.UsersAccessPage), ['users.manage']) },
          { path: 'quizzes', lazy: lazyAdminRoute(() => import('../routes/admin/QuizLibraryPage').then(module => module.QuizLibraryPage), ['quiz.read']) },
          { path: 'quizzes/new', lazy: lazyAdminRoute(async () => {
            const { QuizCreatePage } = await import('../routes/admin/QuizCreatePage');
            return function QuizCreateRoute() { return <QuizCreatePage isCurrentEntry={isCurrentCreationEntry} />; };
          }, ['quiz.create']) },
          { path: 'quizzes/:quizId', lazy: lazyAdminRoute(() => import('../routes/admin/QuizDetailPage').then(module => module.QuizDetailPage), ['quiz.read']) },
          { path: 'quizzes/:quizId/readiness', lazy: lazyAdminRoute(() => import('../routes/admin/QuizPreflightPage').then(module => module.QuizPreflightPage), ['quiz.read', 'quiz.answers.read']) },
          { path: 'quizzes/:quizId/readiness/repair', lazy: lazyAdminRoute(() => import('../routes/admin/QuizRepairPage').then(module => module.QuizRepairPage), ['quiz.edit', 'quiz.answers.edit']) },
          { path: 'events', lazy: lazyAdminRoute(() => import('../routes/admin/AdminEventsPage').then(module => module.AdminEventsPage), ['event.read']) },
          { path: 'events/new', lazy: lazyAdminRoute(async () => {
            const { AdminEventCreatePage } = await import('../routes/admin/AdminEventCreatePage');
            return function EventCreateRoute() { return <AdminEventCreatePage isCurrentEntry={isCurrentCreationEntry} />; };
          }, ['event.create']) },
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
    handle: 'public-shell',
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    HydrateFallback: PublicRouteLoading,
    children: [
      { path: 'admin/login', lazy: async () => ({ Component: (await import('../routes/admin/AdminLoginPage')).AdminLoginPage }) },
      { path: 'admin/no-access', lazy: async () => ({ Component: (await import('../routes/admin/AdminNoAccessPage')).AdminNoAccessPage }) },
      { path: 'events/:eventId/registration/manage', lazy: async () => ({ Component: (await import('../routes/events/ManageRegistrationPage')).ManageRegistrationPage }) },
      { path: 'account', lazy: lazyAccountRoute },
      { path: 'invite/:inviteId', lazy: lazyAccountRoute },
    ],
  },
];

function SessionLoading() {
  const publicShell = useMatches().some(match => match.handle === 'public-shell');
  return publicShell ? <AppLayout><PublicRouteLoading /></AppLayout> : <AdminLoading />;
}

const sessionLayout = async () => ({ Component: (await import('./SessionLayout')).SessionLayout });
const eventsRoute = async () => ({ Component: (await import('../routes/events/EventsPage')).EventsPage });

export const router = createBrowserRouter([
  {
    lazy: sessionLayout,
    HydrateFallback: SessionLoading,
    errorElement: <RouteErrorPage />,
    children: sessionRoutes,
  },
  {
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, lazy: eventsRoute, HydrateFallback: PublicRouteLoading },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: 'events', lazy: eventsRoute, HydrateFallback: PublicRouteLoading },
      {
        path: 'events/:eventId',
        loader: ({ params }) => loadPublicEvent(params.eventId!),
        lazy: async () => ({ Component: (await import('../routes/events/PublicEventPage')).PublicEventRoute }),
        HydrateFallback: PublicEventLoading,
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
