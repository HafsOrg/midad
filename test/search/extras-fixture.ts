// Query classes where quran-search-engine plausibly beats a skeleton/edit-distance
// matcher. Written before either engine's output on these was looked at.
// Ground truth is a substring/regex test on the folded ayah text, independent of
// both engines: a result is "relevant" when its ayah text satisfies `ok`.

/** Fold used only to judge relevance (independent of both engines' folds). */
export function judgeFold(s: string): string {
  return s
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/ء/g, '')
}

export type Extra = { q: string; kind: 'root' | 'lemma' | 'phonetic'; ok: (foldedAyah: string) => boolean; note: string }

const has = (re: RegExp) => (t: string) => re.test(t)

// root / lemma: any inflection of the same root counts. Roots chosen with no weak letters,
// so the three radicals appear consecutively in every derived form checked here.
export const EXTRAS: Extra[] = [
  { q: 'رحم', kind: 'root', ok: has(/رحم/), note: 'root r-h-m, bare' },
  { q: 'غفر', kind: 'root', ok: has(/غفر/), note: 'root gh-f-r, bare' },
  { q: 'شكر', kind: 'root', ok: has(/شكر/), note: 'root sh-k-r' },
  { q: 'صبر', kind: 'root', ok: has(/صبر/), note: 'root s-b-r' },
  { q: 'نصر', kind: 'root', ok: has(/نصر/), note: 'root n-s-r' },
  { q: 'ظلم', kind: 'root', ok: has(/ظلم/), note: 'root zh-l-m' },
  { q: 'يرحمكم', kind: 'lemma', ok: has(/رحم/), note: 'inflected verb form of r-h-m' },
  { q: 'الراحمين', kind: 'lemma', ok: has(/رحم/), note: 'participle of r-h-m' },
  { q: 'يغفر', kind: 'lemma', ok: has(/غفر/), note: 'imperfect of gh-f-r' },
  { q: 'غفور', kind: 'lemma', ok: has(/غفر/), note: 'intensive adjective of gh-f-r' },
  { q: 'شاكرين', kind: 'lemma', ok: has(/شكر/), note: 'participle of sh-k-r' },
  { q: 'اصبروا', kind: 'lemma', ok: has(/صبر/), note: 'imperative of s-b-r' },
  { q: 'ينصركم', kind: 'lemma', ok: has(/نصر/), note: 'verb with suffix of n-s-r' },
  { q: 'ظالمون', kind: 'lemma', ok: has(/ظلم/), note: 'participle of zh-l-m' },
  // phonetic: Latin input a person might type for a well-known phrase
  { q: 'bismillah', kind: 'phonetic', ok: has(/بسم الله/), note: 'basmalah' },
  { q: 'alhamdulillah', kind: 'phonetic', ok: has(/الحمد لله/), note: 'al-hamdu lillah' },
  { q: 'rahman', kind: 'phonetic', ok: has(/الرحمن/), note: 'ar-rahman' },
  { q: 'subhanallah', kind: 'phonetic', ok: has(/سبحان الله/), note: 'subhan allah' },
  { q: 'astaghfirullah', kind: 'phonetic', ok: has(/استغفر/), note: 'istaghfar' },
  { q: 'inshallah', kind: 'phonetic', ok: has(/ان شاء الله|ان يشاء الله|شاء الله/), note: 'in sha allah' },
  { q: 'kawthar', kind: 'phonetic', ok: has(/الكوثر/), note: 'al-kawthar' },
  { q: 'allahu akbar', kind: 'phonetic', ok: has(/الله اكبر/), note: 'allahu akbar' },
]
