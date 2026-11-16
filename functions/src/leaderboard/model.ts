import { scoreHash } from '../scoring/core.js';
import { HttpsError } from 'firebase-functions/v2/https';
export const RESULTS_PAGE_SIZE = 8;
export interface ResultRow {
    rank: number;
    teamName: string;
    halfPoints: number;
}
export interface ResultRound {
    id: string;
    title: string;
    position: number;
}
export interface ResultTeam {
    id: string;
    name: string;
    revision: number;
}
export interface ResultScore {
    teamId: string;
    roundId: string;
    halfPoints: number | null;
    revision: number;
}
export const fingerprint = scoreHash;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export function calculateResults(rounds: ResultRound[], throughRoundId: string, teams: ResultTeam[], scores: ResultScore[], scope: 'interim' | 'final' = 'interim') {
    const ordered = [...rounds].sort((a, b) => a.position - b.position || compare(a.id, b.id));
    if (ordered.some((r, i) => !Number.isSafeInteger(r.position) || r.position < 1 || (i > 0 && r.position === ordered[i - 1]!.position)))
        throw new HttpsError('failed-precondition', 'Pořadí kol není jednoznačné.');
    const index = ordered.findIndex(r => r.id === throughRoundId);
    if (index < 0)
        throw new HttpsError('invalid-argument', 'Kolo nepatří do připraveného kvízu.');
    if (scope === 'interim' && index === ordered.length - 1)
        throw new HttpsError('failed-precondition', ordered.length === 1 ? 'Jednokolová akce nemá průběžné výsledky mezi koly.' : 'Poslední kolo patří budoucímu finálnímu vyhlášení.');
    if (teams.length > 1000)
        throw new HttpsError('resource-exhausted', 'Výsledky podporují nejvýše 1000 přijatých týmů.');
    const included = ordered.slice(0, index + 1);
    const missing: {
        teamId: string;
        teamName: string;
        roundId: string;
        roundTitle: string;
    }[] = [];
    const canonicalTeams = [...teams].sort((a, b) => compare(a.id, b.id));
    const values = new Map(scores.map(s => [JSON.stringify([s.teamId, s.roundId]), s]));
    const sources: unknown[] = [];
    const totals = canonicalTeams.map(team => {
        let total = 0;
        for (const round of included) {
            const score = values.get(JSON.stringify([team.id, round.id]));
            sources.push([team.id, round.id, score?.revision ?? 0, score?.halfPoints ?? null]);
            if (!score || score.halfPoints === null)
                missing.push({ teamId: team.id, teamName: team.name, roundId: round.id, roundTitle: round.title });
            else {
                if (!Number.isSafeInteger(score.halfPoints) || score.halfPoints < 0 || !Number.isSafeInteger(score.revision) || score.revision < 1)
                    throw new HttpsError('failed-precondition', 'Uložené skóre je neplatné.');
                total += score.halfPoints;
                if (!Number.isSafeInteger(total))
                    throw new HttpsError('failed-precondition', 'Součet přesahuje bezpečný rozsah.');
            }
        }
        return { id: team.id, teamName: team.name, halfPoints: total };
    }).sort((a, b) => b.halfPoints - a.halfPoints || compare(a.teamName.normalize('NFC'), b.teamName.normalize('NFC')) || compare(a.id, b.id));
    let rank = 0;
    const rows: ResultRow[] = totals.map((t, i) => {
        if (i === 0 || totals[i - 1]!.halfPoints !== t.halfPoints)
            rank++;
        return { rank, teamName: t.teamName, halfPoints: t.halfPoints };
    });
    const teamRanks = Object.fromEntries(totals.map((team, index) => [team.id, rows[index]!.rank]));
    return { throughRoundId, roundNumber: index + 1, includedRounds: included, rows, teamRanks, rowTeamIds: totals.map(t => t.id), missing,
        complete: teams.length > 0 && missing.length === 0,
        sourceFingerprint: fingerprint([included, canonicalTeams, sources]) };
}
export function calculateFinalResults(rounds: ResultRound[], teams: ResultTeam[], scores: ResultScore[]) {
    const last = [...rounds].sort((a, b) => b.position - a.position)[0];
    if (!last) throw new HttpsError('failed-precondition', 'Připravený kvíz nemá kola.');
    return calculateResults(rounds, last.id, teams, scores, 'final');
}
/** Current standings include every saved cell, including later/final rounds.
 * Missing cells remain missing: only the derived total starts at zero.
 */
export function calculateCurrentResults(rounds: ResultRound[], teams: ResultTeam[], scores: ResultScore[]) {
    const result = calculateFinalResults(rounds, teams, scores);
    const expectedScoreCount = result.includedRounds.length * teams.length;
    const missingScoreCount = result.missing.length;
    const presentScoreCount = expectedScoreCount - missingScoreCount;
    if (!result.rows.length || presentScoreCount === 0)
        throw new HttpsError('failed-precondition', 'Pro zobrazení aktuálních bodů nejprve zapište alespoň jedno skóre přijatého týmu.');
    return { ...result, expectedScoreCount, missingScoreCount, presentScoreCount };
}
