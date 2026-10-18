/** English strings for the bulk media import (keys prefixed `bulk.`). Hindi twin: bulk.hi.ts must have exactly the same keys. */
export const bulkEn = {
  'bulk.limits.media':
    'Pictures: JPG, PNG or WebP up to {imageMb} MB each. Videos: MP4 up to {videoMb} MB. With media: up to {items} items and {files} media files per manifest.',
  'bulk.err.tooManyItems':
    'The file has more than {max} items that use pictures or videos. Split it into smaller files.',
  'bulk.err.tooManyFiles':
    'The file refers to more than {max} picture/video files. Split it into smaller files.',
  'bulk.media.title': 'Media files',
  'bulk.media.help':
    'This file refers to {files} picture/video files. Select ALL of them together in one go (long-press one file, then tap the others).',
  'bulk.media.pick': 'Select media files',
  'bulk.media.change': 'Select media files again',
  'bulk.media.pickFailed': 'The files could not be read. Try selecting them again.',
  'bulk.media.count': '{count} files selected',
  'bulk.media.none': 'No media files selected yet. Items that need files will be skipped.',
  'bulk.plan.ready': '{items} media items ready · {files} files to upload · {mb} MB',
  'bulk.plan.missing': 'Missing files ({count}):',
  'bulk.plan.unused': 'Selected but not used ({count}):',
  'bulk.plan.bad': 'Wrong type or too big ({count}):',
  'bulk.plan.dupes': 'Selected twice, only the first is used ({count}):',
  'bulk.plan.more': '…and {count} more',
  'bulk.plan.badType': '{name}: not a supported picture or MP4 video',
  'bulk.plan.badSize': '{name}: empty or too big',
  'bulk.plan.skipNote': 'Items whose files are missing or unusable are skipped.',
  'bulk.plan.keepOpen': 'Keep the app open while the files upload.',
  'bulk.progress.media': 'Uploading file {file} of {files}… · item {n} of {total}',
} as const;
