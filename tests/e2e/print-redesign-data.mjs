// Entirely synthetic examples shared by PDF visual review and emulator browser QA.
export function printRedesignData(scenario = 'mixed') {
  const counts = scenario === 'long' ? [12, 11, 11, 11, 11, 11] : [scenario === 'abcd' ? 4 : scenario === 'six' ? 6 : 8];
  const rounds = [], slides = [];
  let position = 0;
  counts.forEach((count, r) => {
    const id = 'round-' + (r + 1);
    rounds.push({ id, data: { position: r + 1, title: r === 2 ? 'České filmové příběhy, známé melodie a vzpomínky na stříbrné plátno' : ['Filmové osobnosti', 'Hudba a zvuk', 'Obrazy a příběhy', 'Svět kolem nás', 'Zajímavosti', 'Velké finále'][r] } });
    for (let q = 0; q < count; q++) {
      const variant = scenario === 'abcd' ? 0 : scenario === 'six' ? 5 : q % 8;
      const choiceCount = variant === 0 ? 4 : variant === 2 ? 2 : variant === 3 ? 3 : variant === 4 ? 5 : variant === 5 ? 6 : 0;
      const kind = variant === 7 ? 'pl' : variant === 2 ? 'audio' : variant === 3 ? 'video' : variant === 5 ? 'image' : choiceCount ? 'question' : variant === 6 ? 'video' : 'free';
      const options = Array.from({ length: choiceCount }, (_, index) => `SOUKROMÁ_VOLBA_${r + 1}_${q + 1}_${index}`);
      slides.push({ id: `q-${r + 1}-${q + 1}`, data: { position: ++position, kind, isQuestion: true, roundId: id,
        text: `Soukromé zadání otázky ${q + 1}`, answerMode: choiceCount ? 'choice' : 'open', options,
        correctAnswer: kind === 'pl' ? 'Pravda' : options[1] ?? `SOUKROMÁ_ODPOVĚĎ_${r + 1}_${q + 1}`, ...(choiceCount ? { correctOptionIndex: 1 } : {}) } });
    }
  });
  return { event: { title: 'JustKvíz: filmový večer' }, snapshot: { status: 'ready', quizTitle: 'Filmy, hudba a příběhy', roundCount: rounds.length, questionCount: slides.length, slideCount: slides.length }, rounds, slides,
    teams: [{ id: 'team-1', name: 'Filmoví nadšenci' }, { id: 'team-2', name: 'Žluťoučcí koně, kteří znají české filmy i zapomenuté příběhy' }] };
}
