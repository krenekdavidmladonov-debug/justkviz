import { SlideRenderer } from './SlideRenderer';

export function ProjectorWelcome({ quizTitle }: { readonly quizTitle: string }) {
  // A fresh input cannot inherit question, answer, media or design fields.
  // quizTitle is the only welcome metadata currently published by the server.
  return <SlideRenderer
    quizTitle={quizTitle}
    mediaEnabled={false}
    slide={{ kind: 'intro', title: quizTitle, text: '', options: [], media: [] }}
  />;
}
