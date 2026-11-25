// Order used by the reconciliation plan. Dependencies precede their callers.
export const d2Names = Object.freeze([
  'readQuizMedia', 'beginQuizMediaUpload', 'createQuizSlide', 'updateQuizSlide', 'lockEventQuiz',
  'readDriveConnection', 'createDriveMediaFolder', 'readDriveMediaImport', 'configureDriveMediaCompanion',
  'processDriveMediaImport', 'driveMediaCompanion', 'requestDriveMediaImport',
]);

export const exceptions = Object.freeze({
  processDriveMediaImport: 'Cloudový worker potřebuje clip.mjs, yt-dlp, ffmpeg a ffprobe. Ověřený historický ZIP překračuje 100 MiB.',
});
