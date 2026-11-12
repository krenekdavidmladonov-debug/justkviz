export type PrintArtifactType = 'team-sheets' | 'organizer-sheets' | 'answer-key' | 'score-table';
export type TeamSheetMode = 'generic' | 'single' | 'all';

export interface PrintTeam {
  readonly id: string;
  readonly name: string;
}

export interface PrintPresentationOptions {
  readonly layout?: 'compact' | 'spacious';
  readonly colorMode?: 'color' | 'grayscale';
  readonly showLogo?: boolean;
  readonly showInstructions?: boolean;
}

export type PrintOptions = PrintPresentationOptions & (
  | {
      readonly artifactType: 'team-sheets';
      readonly disposition: 'inline' | 'attachment';
      readonly mode: TeamSheetMode;
      readonly teamId?: string;
    }
  | {
      readonly artifactType: 'answer-key' | 'organizer-sheets';
      readonly disposition: 'inline' | 'attachment';
    }
  | {
      readonly artifactType: 'score-table';
      readonly disposition: 'inline' | 'attachment';
    });

export interface PrintArtifactBlob {
  readonly blob: Blob;
  readonly filename: string;
}
