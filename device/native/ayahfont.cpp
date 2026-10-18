// ayahfont: per-category Arabic fonts for xochitl's typed text.
//
// Preloaded into xochitl after xovi (LD_PRELOAD from the midad service drop-in). xochitl
// builds each page's typed text as a QTextDocument through QTextCursor calls into QtGui, which
// go through its PLT and so can be interposed (the document's own layout runs inside QtGui and
// can't). After xochitl inserts a span of text, if the span is Quran or hadith, the shim merges
// that category's font family into exactly that span's character format. Sizes, weights and
// paragraph styles stay as xochitl set them, so every category keeps all four sizes.
//
// Categories:
//   Quran   an invisible U+2061 tag near the start (added by the ayah bar), or any mark only the
//           KFGQPC Quran encoding uses (so earlier inserts are recognised too)
//   Hadith  an invisible U+2062 tag near the start (added by the hadith bar)
//
// Placement: xochitl lays a page's text out in one column and offers no way to move a paragraph
// sideways, but its layout honours Qt's block margins. A tag may be followed by six variation
// selectors (U+FE00..U+FE0F, invisible): hex digits of the paragraph's right and left margins in
// scene units, each biased by 2048. After every insert, each block it touched gets the margins its
// own text names, so placement travels with the text into the file and back on load.
//
// Built without linking Qt and with no load-time references to Qt data, so the shim loads cleanly
// in xochitl's non-Qt helper processes, which inherit LD_PRELOAD; Qt functions bind lazily.
#include <QtCore/QString>
#include <QtCore/QStringList>
#include <QtGui/QTextBlock>
#include <QtGui/QTextCharFormat>
#include <QtGui/QTextCursor>
#include <QtGui/QTextFormat>

#include <dlfcn.h>

namespace {

enum class Category { None, Quran, Hadith };

constexpr char16_t kQuranTag = 0x2061;  // FUNCTION APPLICATION, default-ignorable
constexpr char16_t kHadithTag = 0x2062; // INVISIBLE TIMES, default-ignorable

// Reads characters with at(), not constData(): constData() on a null string points at
// QString's shared empty data, a load-time data relocation that would make the shim fail
// to load into xochitl's non-Qt helper processes.
Category categoryOf(QStringView text)
{
    const qsizetype n = text.size();
    // A tag may sit after a leading newline or two.
    for (qsizetype i = 0; i < n && i < 4; ++i) {
        const char16_t c = text.at(i).unicode();
        if (c == kQuranTag)
            return Category::Quran;
        if (c == kHadithTag)
            return Category::Hadith;
    }
    for (qsizetype i = 0; i < n; ++i) {
        const char16_t c = text.at(i).unicode();
        // KFGQPC-only marks: dotless head of khah (sukun), rounded zero, small waw/ya,
        // alef wasla, and the Quranic pause signs.
        if (c == 0x06E1 || c == 0x06DF || c == 0x06E5 || c == 0x06E6 || c == 0x0671
            || (c >= 0x06D6 && c <= 0x06DC))
            return Category::Quran;
    }
    return Category::None;
}

struct Placement {
    bool set;
    int right;
    int left;
};

// The six variation selectors after a tag near the paragraph's start, if they are all there.
Placement placementOf(QStringView text)
{
    const qsizetype n = text.size();
    for (qsizetype t = 0; t < n && t < 4; ++t) {
        const char16_t c = text.at(t).unicode();
        if (c != kQuranTag && c != kHadithTag)
            continue;
        if (n < t + 7)
            return {false, 0, 0};
        int v = 0;
        for (qsizetype k = 1; k <= 6; ++k) {
            const char16_t d = text.at(t + k).unicode();
            if (d < 0xFE00 || d > 0xFE0F)
                return {false, 0, 0};
            v = (v << 4) | (d - 0xFE00);
        }
        return {true, (v >> 12) - 2048, (v & 0xFFF) - 2048};
    }
    return {false, 0, 0};
}

void setMargins(const QTextBlock &block, qreal right, qreal left)
{
    QTextBlockFormat bf;
    bf.setRightMargin(right);
    bf.setLeftMargin(left);
    QTextCursor(block).mergeBlockFormat(bf);
}

bool sameMargins(const QTextBlock &a, const QTextBlock &b)
{
    const QTextBlockFormat fa = a.blockFormat(), fb = b.blockFormat();
    return fa.rightMargin() == fb.rightMargin() && fa.leftMargin() == fb.leftMargin();
}

// Gives every Quran or hadith block in [from, to] the margins its text names, or none. A block
// split off a placed paragraph inherits its margins in the live document; those are cleared
// again, so the empty lines a move adds (or text typed into them) don't sit narrowed until the
// next load.
void placeBlocks(QTextBlock block, int to)
{
    for (; block.isValid() && block.position() <= to; block = block.next()) {
        const QString text = block.text();
        const QTextBlockFormat f = block.blockFormat();
        if (categoryOf(text) != Category::None) {
            const Placement p = placementOf(text);
            if (f.rightMargin() != p.right || f.leftMargin() != p.left)
                setMargins(block, p.right, p.left);
            continue;
        }
        if (f.rightMargin() == 0 && f.leftMargin() == 0)
            continue;
        for (const QTextBlock &n : {block.previous(), block.next()}) {
            if (n.isValid() && placementOf(n.text()).set && sameMargins(block, n)) {
                setMargins(block, 0, 0);
                break;
            }
        }
    }
}

using InsertText = void (*)(QTextCursor *, const QString &);

InsertText realInsertText()
{
    static const InsertText real =
        reinterpret_cast<InsertText>(dlsym(RTLD_NEXT, "_ZN11QTextCursor10insertTextERK7QString"));
    return real;
}

} // namespace

#ifdef AYAHFONT_DEBUG
#include <cstdio>
static int debugCalls = 0;
#endif

extern "C" __attribute__((visibility("default"))) void
ayahfont_insertText(QTextCursor *self, const QString &text) __asm__("_ZN11QTextCursor10insertTextERK7QString");

extern "C" void ayahfont_insertText(QTextCursor *self, const QString &text)
{
    const InsertText real = realInsertText();
    if (!real)
        return;
    real(self, text);
    const qsizetype n = text.size();
    if (n == 0)
        return;

    // One insert can carry many paragraphs (a whole page on load), so each paragraph is
    // categorised and styled on its own. Inserted text maps 1:1 onto document positions,
    // block separators included.
    QTextCursor span(*self);
    const int base = span.position() - static_cast<int>(n);
    const QStringView view(text);
    qsizetype start = 0;
    for (qsizetype i = 0; i <= n; ++i) {
        if (i < n) {
            const char16_t c = view.at(i).unicode();
            if (c != u'\n' && c != 0x2029)
                continue;
        }
        if (i > start) {
            const Category cat = categoryOf(view.sliced(start, i - start));
#ifdef AYAHFONT_DEBUG
            if (debugCalls < 60 && (i - start > 30 || cat != Category::None)) {
                ++debugCalls;
                fprintf(stderr, "[ayahfont] paragraph %d len=%d cat=%d at=%d\n", debugCalls,
                        static_cast<int>(i - start), static_cast<int>(cat), base + static_cast<int>(start));
                fflush(stderr);
            }
#endif
            if (cat != Category::None) {
                QTextCharFormat fmt;
                fmt.setFontFamilies(QStringList{cat == Category::Quran
                    ? QStringLiteral("kfgqpc_hafs_uthmanic_script")
                    : QStringLiteral("Amiri")});
                span.setPosition(base + static_cast<int>(start));
                span.setPosition(base + static_cast<int>(i), QTextCursor::KeepAnchor);
                span.mergeCharFormat(fmt);
            }
        }
        start = i + 1;
    }

    // Placement reads each touched block's whole text, so editing the digits alone re-places it.
    span.setPosition(base);
    placeBlocks(span.block(), base + static_cast<int>(n));
}
