import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const mock = '\0event-quiz-warning-mocks';
export default defineConfig({
  root, plugins: [react(), {
    name: 'event-quiz-warning-isolation', enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('/AuthProvider') || source.endsWith('/eventRepository') || source.endsWith('/EventActions')) return mock;
    },
    load(id) {
      if (id !== mock) return;
      return `import { eventFormRecord } from '/tests/browser/events-form-ux.data.ts';
        export const useAuth = () => ({ can: () => false });
        export const EventActions = () => null;
        export const listEvents = async () => {
          const base = eventFormRecord(), now = Date.parse('2030-03-30T12:00:00Z'), day = 86400000;
          return [
            { id:'soon', title:'Brzy bez kvízu', delta:day },
            { id:'boundary', title:'Přesně za sedm dní', delta:7*day },
            { id:'later', title:'Později bez kvízu', delta:7*day+1 },
            { id:'past', title:'Minulý termín', delta:-1 },
            { id:'assigned', title:'Přiřazený kvíz', delta:day, quizAssignment:{ quizId:'quiz', quizTitle:'Kvíz' } },
            { id:'completed', title:'Dokončená akce', delta:day, lifecycleStatus:'completed' },
            { id:'cancelled', title:'Zrušená akce', delta:day, lifecycleStatus:'cancelled' },
          ].map(item => ({ ...base, ...item, startsAt:new Date(now+item.delta) }));
        };`;
    },
    configureServer(server) { server.middlewares.use((req, res, next) => { if (req.url === '/admin/events') req.url = '/tests/browser/event-quiz-warning.harness.html'; next(); }); },
  }], server: { host:'127.0.0.1', port:5788, strictPort:true },
});
