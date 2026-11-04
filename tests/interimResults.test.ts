import { describe, expect, it } from 'vitest';
import { calculateResults, calculateCurrentResults } from '../functions/src/leaderboard/model';
import { parseResultPage } from '../apps/web/src/features/leaderboard/types';
const rounds = [1, 2, 3].map(i => ({ id: 'r' + i, title: 'Kolo ' + i, position: i }));
const teams = ['Alfa', 'Beta', 'Gama', 'Delta'].map((name, i) => ({ id: 't' + i, name, revision: 1 }));
const scores = teams.flatMap((t, i) => [20, [20, 15, 15, 10][i]!, 999].map((halfPoints, r) => ({ teamId: t.id, roundId: 'r' + (r + 1), halfPoints, revision: 1 })));
describe('interim cumulative results', () => {
    it('current standings sum entered cells from all rounds while retaining incomplete coverage', () => {
        const entered = [
            { teamId: 't0', roundId: 'r1', halfPoints: 7, revision: 1 },
            { teamId: 't0', roundId: 'r3', halfPoints: 5, revision: 1 },
            { teamId: 't1', roundId: 'r2', halfPoints: 0, revision: 2 },
            { teamId: 't2', roundId: 'r1', halfPoints: null, revision: 3 },
            { teamId: 'cancelled', roundId: 'r3', halfPoints: 1000, revision: 1 },
            { teamId: 't3', roundId: 'foreign', halfPoints: 1000, revision: 1 },
        ];
        const before = structuredClone(entered);
        const result = calculateCurrentResults(rounds, teams, entered);
        expect(result.rows.map(r => r.halfPoints)).toEqual([12, 0, 0, 0]);
        expect(result).toMatchObject({ roundNumber: 3, expectedScoreCount: 12, presentScoreCount: 3, missingScoreCount: 9, complete: false });
        expect(result.missing).toContainEqual({ teamId: 't2', teamName: 'Gama', roundId: 'r1', roundTitle: 'Kolo 1' });
        expect(result.missing).not.toContainEqual(expect.objectContaining({ teamId: 't1', roundId: 'r2' }));
        expect(entered).toEqual(before);
        expect(calculateCurrentResults([...rounds].reverse(), [...teams].reverse(), [...entered].reverse())).toEqual(result);
        expect(calculateCurrentResults(rounds, teams, entered.map(s => s.roundId === 'r3' ? { ...s, halfPoints: 6, revision: 2 } : s)).sourceFingerprint).not.toBe(result.sourceFingerprint);
    });
    it('current standings support the single/final round but require an entered score for an accepted team', () => {
        const zero = [{ teamId: 't0', roundId: 'r1', halfPoints: 0, revision: 1 }];
        expect(calculateCurrentResults(rounds.slice(0, 1), [teams[0]!], zero)).toMatchObject({ complete: true, presentScoreCount: 1 });
        for (const [currentTeams, currentScores] of [[[], zero], [teams, []], [teams, [{ ...zero[0]!, halfPoints: null }]], [teams, [{ ...zero[0]!, teamId: 'cancelled' }]]] as const)
            expect(() => calculateCurrentResults(rounds, [...currentTeams], [...currentScores])).toThrow(/alespoň jedno skóre/);
    });
    it('uses snapshot order, integer half points and dense 1/2/2/3 ranking', () => {
        const p = calculateResults([...rounds].reverse(), 'r2', teams, scores);
        expect(p.complete).toBe(true);
        expect(p.rows.map(r => r.rank)).toEqual([1, 2, 2, 3]);
        expect(p.rows.map(r => r.halfPoints)).toEqual([40, 35, 35, 30]);
        expect(p.includedRounds.map(r => r.id)).toEqual(['r1', 'r2']);
    });
    it('distinguishes missing and null from explicit zero', () => {
        const s = [{ teamId: 't0', roundId: 'r1', halfPoints: 0, revision: 1 }];
        expect(calculateResults(rounds, 'r1', [teams[0]!], s).complete).toBe(true);
        const p = calculateResults(rounds, 'r2', [teams[0]!], s);
        expect(p.complete).toBe(false);
        expect(p.missing).toEqual([{ teamId: 't0', teamName: 'Alfa', roundId: 'r2', roundTitle: 'Kolo 2' }]);
        expect(calculateResults(rounds, 'r1', [teams[0]!], [{ ...s[0]!, halfPoints: null }]).complete).toBe(false);
        expect(calculateResults(rounds, 'r1', [], []).complete).toBe(false);
    });
    it('rejects unknown, last and single round and ambiguous ordering', () => {
        for (const id of ['none', 'r3'])
            expect(() => calculateResults(rounds, id, teams, scores)).toThrow();
        expect(() => calculateResults(rounds.slice(0, 1), 'r1', teams, scores)).toThrow(/Jednokolová/);
        expect(() => calculateResults([...rounds, { ...rounds[0]!, id: 'duplicate' }], 'r1', teams, scores)).toThrow(/jednoznačné/);
    });
    it('has stable ties and fingerprint independent of query ordering', () => {
        const p = calculateResults(rounds, 'r2', teams, scores), q = calculateResults(rounds, 'r2', [...teams].reverse(), [...scores].reverse());
        expect(q).toEqual(p);
        expect(calculateResults(rounds, 'r2', teams.map(t => t.id === 't0' ? { ...t, name: 'Renamed' } : t), scores).sourceFingerprint).not.toBe(p.sourceFingerprint);
        expect(calculateResults(rounds, 'r2', teams, scores.map(s => s.roundId === 'r3' ? { ...s, halfPoints: 1, revision: 2 } : s)).sourceFingerprint).toBe(p.sourceFingerprint);
    });
    it('rejects malformed and overflowing values', () => {
        expect(() => calculateResults(rounds, 'r1', teams, scores.map(s => ({ ...s, halfPoints: -1 })))).toThrow();
        expect(() => calculateResults(rounds, 'r2', teams, scores.map(s => ({ ...s, halfPoints: Number.MAX_SAFE_INTEGER })))).toThrow();
    });
    it('strictly validates public nested rows and page limits', () => {
        const p = { versionId: 'a'.repeat(64), roundNumber: 2, page: 0, pageCount: 1, rows: [{ rank: 1, teamName: 'Alfa', halfPoints: 35 }] };
        expect(parseResultPage(p)).toEqual(p);
        expect(() => parseResultPage({ ...p, rows: [{ ...p.rows[0], contactEmail: 'private' }] })).toThrow();
        expect(() => parseResultPage({ ...p, page: 1 })).toThrow();
        expect(() => parseResultPage({ ...p, rows: Array(9).fill(p.rows[0]) })).toThrow();
    });
});
