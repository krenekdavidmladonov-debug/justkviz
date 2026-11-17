declare module '*leaderboard-fixture.mjs' {
export function leaderboardFixture(count?: number): Promise<{
 eventId: string; snapshotId: string; sessionId: string; roundIds: string[]; teamIds: string[];
 login: {email:string;password:string};
 referee():Promise<{eventId:string;accessId:string;key:string}>;
 call(name:string,data:unknown):Promise<unknown>;
 publicState():Promise<Record<string,unknown>>;
 session():Promise<Record<string,unknown>>;
 score(i:number,r:number,value:number|null):Promise<unknown>;
 close():Promise<void>;
}>;

}
