import type { bulkEn } from './bulk.en';

/** Hindi twin of bulk.en.ts (same keys, same {placeholders}). */
export const bulkHi: Record<keyof typeof bulkEn, string> = {
  'bulk.limits.media':
    'तस्वीरें: JPG, PNG या WebP, हर एक {imageMb} MB तक। वीडियो: MP4, {videoMb} MB तक। मीडिया के साथ एक फ़ाइल में अधिकतम {items} आइटम और {files} मीडिया फ़ाइलें।',
  'bulk.err.tooManyItems':
    'फ़ाइल में तस्वीर या वीडियो वाले {max} से ज़्यादा आइटम हैं। इसे छोटी फ़ाइलों में बाँटें।',
  'bulk.err.tooManyFiles':
    'फ़ाइल में {max} से ज़्यादा तस्वीर/वीडियो फ़ाइलों का ज़िक्र है। इसे छोटी फ़ाइलों में बाँटें।',
  'bulk.media.title': 'मीडिया फ़ाइलें',
  'bulk.media.help':
    'इस फ़ाइल में {files} तस्वीर/वीडियो फ़ाइलों का ज़िक्र है। उन सभी को एक साथ चुनें (एक फ़ाइल को दबाकर रखें, फिर बाक़ी पर टैप करें)।',
  'bulk.media.pick': 'मीडिया फ़ाइलें चुनें',
  'bulk.media.change': 'मीडिया फ़ाइलें दोबारा चुनें',
  'bulk.media.pickFailed': 'फ़ाइलें पढ़ी नहीं जा सकीं। उन्हें फिर से चुनकर देखें।',
  'bulk.media.count': '{count} फ़ाइलें चुनी गईं',
  'bulk.media.none':
    'अभी कोई मीडिया फ़ाइल नहीं चुनी गई। जिन आइटम को फ़ाइलें चाहिए, वे छोड़ दिए जाएँगे।',
  'bulk.plan.ready': '{items} मीडिया आइटम तैयार · {files} फ़ाइलें अपलोड होंगी · {mb} MB',
  'bulk.plan.missing': 'गुम फ़ाइलें ({count}):',
  'bulk.plan.unused': 'चुनी गईं पर इस्तेमाल नहीं हुईं ({count}):',
  'bulk.plan.bad': 'गलत प्रकार या बहुत बड़ी ({count}):',
  'bulk.plan.dupes': 'दो बार चुनी गईं, सिर्फ़ पहली इस्तेमाल होगी ({count}):',
  'bulk.plan.more': '…और {count} और',
  'bulk.plan.badType': '{name}: यह समर्थित तस्वीर या MP4 वीडियो नहीं है',
  'bulk.plan.badSize': '{name}: खाली है या बहुत बड़ी है',
  'bulk.plan.skipNote':
    'जिन आइटम की फ़ाइलें गुम हैं या इस्तेमाल लायक़ नहीं हैं, वे छोड़ दिए जाएँगे।',
  'bulk.plan.keepOpen': 'फ़ाइलें अपलोड होने तक ऐप खुला रखें।',
  'bulk.progress.media': 'फ़ाइल {file} / {files} अपलोड हो रही है… · आइटम {n} / {total}',
};
