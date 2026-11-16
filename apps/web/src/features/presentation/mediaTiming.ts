export type AssetTransferTiming = 'asset-request' | 'asset-headers' | 'asset-body';
export type ImageTiming = AssetTransferTiming | 'image-ready' | 'image-error';
export type PlayerResourceTiming = AssetTransferTiming | 'player-mounted' | 'player-cued' | 'player-can-play';
export type PlayerTiming = PlayerResourceTiming | 'player-ready' | 'player-playing' | 'player-error';
export type LocalMediaTiming = ImageTiming | PlayerTiming;
