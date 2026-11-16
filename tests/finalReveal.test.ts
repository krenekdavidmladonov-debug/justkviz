import { describe, expect, test } from 'vitest';
import { calculateFinalResults, calculateResults } from '../functions/src/leaderboard/model';
import { advanceFinal, initialFinal, publicFinalPage, revealRanks } from '../functions/src/final-reveal/model';
import { parseFinalPage } from '../apps/web/src/features/final-reveal/types';
const rounds = [1, 2, 3].map(position => ({ id: 'r' + position, title: 'Kolo ' + position, position }));
const teams = ['Alfa', 'Beta', 'Gama', 'Delta'].map((name, i) => ({ id: 't' + i, name, revision: 1 }));
const scores = teams.flatMap((t, i) => rounds.map((r, n) => ({ teamId: t.id, roundId: r.id, halfPoints: n === 0 ? 20 : n === 1 ? [20, 15, 15, 10][i]! : 0, revision: 1 })));
const version = 'a'.repeat(64);
describe('final totals and manual reveal', () => {
  test('two entered scores across two teams and six rounds leave ten missing cells', () => {
    const sixRounds = Array.from({ length: 6 }, (_, index) => ({ id: 'round-' + index, title: 'Synthetic round ' + index, position: index + 1 }));
    const twoTeams = teams.slice(0, 2);
    const entered = twoTeams.map((team, index) => ({ teamId: team.id, roundId: sixRounds[0]!.id, halfPoints: index === 0 ? 4 : 0, revision: 1 }));
    const before = structuredClone(entered);
    const preview = calculateFinalResults(sixRounds, twoTeams, entered);
    expect(preview.complete).toBe(false);
    expect(preview.rows).toHaveLength(2);
    expect(preview.includedRounds).toHaveLength(6);
    expect(preview.missing).toHaveLength(10);
    expect(preview.missing.filter(item => item.roundId === sixRounds[0]!.id)).toEqual([]);
    for (const round of sixRounds.slice(1)) expect(preview.missing.filter(item => item.roundId === round.id)).toHaveLength(2);
    expect(preview.rows.length * preview.includedRounds.length - preview.missing.length).toBe(2);
    expect(entered).toEqual(before);
  });
  test('all rounds, exact half points, dense ties and stable order; interim restriction unchanged', () => {
    const result = calculateFinalResults(rounds, [...teams].reverse(), scores);
    expect(result.rows).toEqual([{ rank: 1, teamName: 'Alfa', halfPoints: 40 }, { rank: 2, teamName: 'Beta', halfPoints: 35 }, { rank: 2, teamName: 'Gama', halfPoints: 35 }, { rank: 3, teamName: 'Delta', halfPoints: 30 }]);
    expect(result.includedRounds).toEqual(rounds); expect(result.complete).toBe(true);
    expect(() => calculateResults(rounds, 'r3', teams, scores)).toThrow();
    expect(calculateFinalResults(rounds, teams, scores.map(s => ({ ...s, halfPoints: s.roundId === 'r3' ? 1 : s.halfPoints }))).rows[0]!.halfPoints).toBe(41);
  });
  test('zero differs from absent or null; empty roster is blocked; one round works', () => {
    expect(calculateFinalResults(rounds, teams, scores.slice(1)).missing[0]).toMatchObject({ teamId: 't0', roundId: 'r1' });
    expect(calculateFinalResults(rounds, teams, scores.map((s, i) => i === 0 ? { ...s, halfPoints: null } : s)).complete).toBe(false);
    expect(calculateFinalResults(rounds, [], []).complete).toBe(false);
    expect(calculateFinalResults([rounds[0]!], [teams[0]!], [{ ...scores[0]!, halfPoints: 0 }]).complete).toBe(true);
    expect(() => calculateResults([rounds[0]!], 'r1', teams, scores)).toThrow();
    expect(() => initialFinal(version, [])).toThrow();
  });
  test('intro has no rows; only next server group; final table requires all revealed groups', () => {
    const rows = calculateFinalResults(rounds, teams, scores).rows;
    let state = initialFinal(version, rows);
    expect(publicFinalPage(state, rows).rows).toEqual([]);
    expect(() => advanceFinal(state, rows, 'table')).toThrow();
    expect(revealRanks(rows)).toEqual([3, 2, 1]);
    for (const rank of [3, 2, 1]) {
      state = advanceFinal(state, rows, 'reveal');
      expect(publicFinalPage(state, rows).rows).toEqual(rows.filter(r => r.rank === rank));
      expect(parseFinalPage(publicFinalPage(state, rows))).toEqual(publicFinalPage(state, rows));
    }
    expect(() => advanceFinal(state, rows, 'reveal')).toThrow();
    state = advanceFinal(state, rows, 'table'); expect(publicFinalPage(state, rows).rows).toEqual(rows);
  });
  test.each([1, 10])('%i first-place teams reveal in one group; paging is not another reveal', count => {
    const rows = Array.from({ length: count }, (_, i) => ({ rank: 1, teamName: 'Tým ' + i, halfPoints: 0 }));
    let state = advanceFinal(initialFinal(version, rows), rows, 'reveal');
    expect(state.revealedCount).toBe(1); expect(state.totalGroups).toBe(1);
    expect(publicFinalPage(state, rows).groupSize).toBe(count);
    if (count > 8) { state = advanceFinal(state, rows, 'page', 1); expect(state.rank).toBe(1); expect(state.revealedCount).toBe(1); expect(publicFinalPage(state, rows).rows).toHaveLength(2); }
    const hidden = advanceFinal(state, rows, 'hide'); expect(() => publicFinalPage(hidden, rows)).toThrow();
    expect(() => advanceFinal(hidden, rows, 'reveal')).toThrow();
    expect(advanceFinal(hidden, rows, 'resume')).toEqual(state);
    expect(initialFinal('b'.repeat(64), rows).revealedCount).toBe(0);
  });
  test('strict public mapper rejects nested extras, future intro rows and mixed ranks', () => {
    const rows = calculateFinalResults(rounds, teams, scores).rows, intro = publicFinalPage(initialFinal(version, rows), rows);
    expect(parseFinalPage(intro)).toEqual(intro);
    expect(() => parseFinalPage({ ...intro, rows })).toThrow();
    expect(() => parseFinalPage({ ...intro, privateRows: rows })).toThrow();
    const group = publicFinalPage(advanceFinal(initialFinal(version, rows), rows, 'reveal'), rows);
    expect(() => parseFinalPage({ ...group, rows: [{ ...group.rows[0], staffUid: 'secret' }] })).toThrow();
    expect(() => parseFinalPage({ ...group, rows: [rows[0]] })).toThrow();
  });
});
