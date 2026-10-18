// ayahfont: per-category Arabic fonts for xochitl's typed text.
//
// Preloaded into xochitl after xovi (LD_PRELOAD from the ayah-toolbar service drop-in). It
// interposes QTextLayout::beginLayout(), which xochitl calls (through its PLT) before laying out
// each typed-text paragraph. If the paragraph is Quran or hadith, the layout's font family is
// switched to that category's font; the size and weight xochitl set from the paragraph style are
// kept, so every category gets all four sizes. Other text is untouched.
//
// Categories:
//   Quran   an invisible U+2061 tag near the start (added by the ayah bar), or any mark only the
//           KFGQPC Quran encoding uses (so earlier inserts are recognised too)
//   Hadith  an invisible U+2062 tag near the start (added by the hadith bar)
#include <QtCore/QString>
#include <QtCore/QStringList>
#include <QtGui/QFont>
#include <QtGui/QTextLayout>

#include <dlfcn.h>

namespace {

enum class Category { None, Quran, Hadith };

constexpr char16_t kQuranTag = 0x2061;  // FUNCTION APPLICATION, default-ignorable
constexpr char16_t kHadithTag = 0x2062; // INVISIBLE TIMES, default-ignorable

// Reads characters with at(), not constData(): constData() on a null string points at
// QString's shared empty data, a load-time data relocation that would make the shim fail
// to load into xochitl's non-Qt helper processes, which inherit LD_PRELOAD.
Category categoryOf(const QString &text)
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

using BeginLayout = void (*)(QTextLayout *);

BeginLayout realBeginLayout()
{
    static const BeginLayout real =
        reinterpret_cast<BeginLayout>(dlsym(RTLD_NEXT, "_ZN11QTextLayout11beginLayoutEv"));
    return real;
}

} // namespace

extern "C" __attribute__((visibility("default"))) void
ayahfont_beginLayout(QTextLayout *self) __asm__("_ZN11QTextLayout11beginLayoutEv");

#ifdef AYAHFONT_DEBUG
#include <cstdio>
static int debugCalls = 0;
#endif

extern "C" void ayahfont_beginLayout(QTextLayout *self)
{
#ifdef AYAHFONT_DEBUG
    if (debugCalls < 40) {
        ++debugCalls;
        fprintf(stderr, "[ayahfont] call %d self=%p real=%p len=%d\n", debugCalls,
                static_cast<void *>(self), reinterpret_cast<void *>(realBeginLayout()),
                static_cast<int>(self->text().size()));
        fflush(stderr);
    }
#endif
    const Category cat = categoryOf(self->text());
    if (cat != Category::None) {
        const QString family = cat == Category::Quran
            ? QStringLiteral("kfgqpc_hafs_uthmanic_script")
            : QStringLiteral("Amiri");
        QFont f = self->font();
        if (f.families().value(0) != family) {
            f.setFamilies(QStringList{family});
            self->setFont(f);
        }
    }
    if (const BeginLayout real = realBeginLayout())
        real(self);
}
