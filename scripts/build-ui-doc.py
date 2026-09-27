"""Builds docs/UI Documentation.pdf from docs/UI_DOCUMENTATION.md.

Usage:  python scripts/build-ui-doc.py      (needs: pip install reportlab)

Edit the Markdown, run this, commit both files.
"""
import os, re
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, KeepTogether, ListFlowable, ListItem, PageBreak,
    PageTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "UI_DOCUMENTATION.md")
OUT = os.path.join(ROOT, "docs", "UI Documentation.pdf")
LOGO = os.path.join(ROOT, "public", "brand", "fern-logo-light.png")

# Arial carries the arrows, dashes and middle dots the text uses; Helvetica does
# not. Fall back to Helvetica where the Windows fonts are not available.
FONTS = r"C:/Windows/Fonts"
try:
    pdfmetrics.registerFont(TTFont("Body", os.path.join(FONTS, "arial.ttf")))
    pdfmetrics.registerFont(TTFont("Body-Bold", os.path.join(FONTS, "arialbd.ttf")))
    pdfmetrics.registerFont(TTFont("Body-Italic", os.path.join(FONTS, "ariali.ttf")))
    pdfmetrics.registerFont(TTFont("Body-BoldItalic", os.path.join(FONTS, "arialbi.ttf")))
    pdfmetrics.registerFont(TTFont("Mono", os.path.join(FONTS, "consola.ttf")))
    from reportlab.pdfbase.pdfmetrics import registerFontFamily
    registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body-Italic", boldItalic="Body-BoldItalic")
except Exception:  # noqa: BLE001
    from reportlab.pdfbase.pdfmetrics import registerFontFamily
    from reportlab.lib.fonts import addMapping
    for name, base_font in [("Body", "Helvetica"), ("Body-Bold", "Helvetica-Bold"), ("Body-Italic", "Helvetica-Oblique"), ("Body-BoldItalic", "Helvetica-BoldOblique"), ("Mono", "Courier")]:
        addMapping(name, 0, 0, base_font)
    registerFontFamily("Body", normal="Helvetica", bold="Helvetica-Bold", italic="Helvetica-Oblique", boldItalic="Helvetica-BoldOblique")

BRAND = colors.HexColor("#1b5cf5")
INK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#475569")
LINE = colors.HexColor("#e2e8f0")
HEAD_BG = colors.HexColor("#f1f5f9")

base = getSampleStyleSheet()
styles = {
    "body": ParagraphStyle("body", parent=base["Normal"], fontName="Body", fontSize=10, leading=14.5, textColor=INK, spaceAfter=6),
    "small": ParagraphStyle("small", parent=base["Normal"], fontName="Body", fontSize=8.5, leading=11.5, textColor=INK),
    "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName="Body-Bold", fontSize=20, leading=24, textColor=INK, spaceBefore=6, spaceAfter=10),
    "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName="Body-Bold", fontSize=15, leading=19, textColor=BRAND, spaceBefore=18, spaceAfter=8),
    "h3": ParagraphStyle("h3", parent=base["Heading3"], fontName="Body-Bold", fontSize=11.5, leading=15, textColor=INK, spaceBefore=12, spaceAfter=4),
    "meta": ParagraphStyle("meta", parent=base["Normal"], fontName="Body", fontSize=10, leading=14, textColor=MUTED, spaceAfter=10),
    "cover_title": ParagraphStyle("cover_title", parent=base["Title"], fontName="Body-Bold", fontSize=30, leading=36, textColor=INK, alignment=TA_LEFT, spaceAfter=8),
    "cover_sub": ParagraphStyle("cover_sub", parent=base["Normal"], fontName="Body", fontSize=13, leading=18, textColor=MUTED, spaceAfter=6),
    "toc_h": ParagraphStyle("toc_h", parent=base["Heading1"], fontName="Body-Bold", fontSize=16, leading=20, textColor=INK, spaceAfter=10),
    "toc1": ParagraphStyle("toc1", fontName="Body-Bold", fontSize=10.5, leading=16, textColor=INK, leftIndent=0),
    "toc2": ParagraphStyle("toc2", fontName="Body", fontSize=9.5, leading=14, textColor=MUTED, leftIndent=14),
    "bullet": ParagraphStyle("bullet", parent=base["Normal"], fontName="Body", fontSize=10, leading=14.5, textColor=INK, spaceAfter=3),
}

def inline(text: str) -> str:
    """Markdown inline -> reportlab paragraph markup."""
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = text.replace("⌘", "Cmd").replace("→", "&#8594;")
    text = re.sub(r"`([^`]+)`", r'<font face="Mono" size="9">\1</font>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<i>\1</i>", text)
    return text

class Heading(Paragraph):
    """A heading that registers itself with the table of contents."""
    def __init__(self, text, style, level):
        super().__init__(text, style)
        self.level = level
        self.plain = re.sub(r"<[^>]+>", "", text)

class Doc(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Heading):
            key = f"h{id(flowable)}"
            self.canv.bookmarkPage(key)
            self.notify("TOCEntry", (flowable.level, flowable.plain, self.page, key))

def parse_table(lines):
    rows = []
    for line in lines:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append(cells)
    # drop the alignment row
    body = [r for i, r in enumerate(rows) if not (i == 1 and all(re.fullmatch(r":?-{2,}:?", c) for c in r))]
    return body

def make_table(rows, width):
    ncols = max(len(r) for r in rows)
    rows = [r + [""] * (ncols - len(r)) for r in rows]
    if ncols == 2:
        widths = [width * 0.30, width * 0.70]
    elif ncols == 3:
        widths = [width * 0.24, width * 0.30, width * 0.46]
    else:
        first = width * 0.30
        widths = [first] + [(width - first) / (ncols - 1)] * (ncols - 1)
    data = []
    for i, r in enumerate(rows):
        style = ParagraphStyle("cell", parent=styles["small"], fontName="Body-Bold" if i == 0 else "Body")
        data.append([Paragraph(inline(c), style) for c in r])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEAD_BG),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, colors.HexColor("#cbd5e1")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table

def build_story(md: str, width: float):
    story = []
    lines = md.split("\n")
    i = 0
    title_done = False
    paragraph = []
    bullets = []
    numbered = []

    def flush_paragraph():
        nonlocal paragraph
        if paragraph:
            story.append(Paragraph(inline(" ".join(paragraph)), styles["body"]))
            paragraph = []

    def flush_lists():
        nonlocal bullets, numbered
        if bullets:
            story.append(ListFlowable(
                [ListItem(Paragraph(inline(b), styles["bullet"]), leftIndent=12, value="circle") for b in bullets],
                bulletType="bullet", start="\u2022", leftIndent=14, bulletFontName="Body", bulletFontSize=9, spaceAfter=6))
            bullets = []
        if numbered:
            story.append(ListFlowable(
                [ListItem(Paragraph(inline(b), styles["bullet"]), leftIndent=14) for b in numbered],
                bulletType="1", leftIndent=16, bulletFontName="Body", bulletFontSize=9.5, spaceAfter=6))
            numbered = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("|"):
            flush_paragraph(); flush_lists()
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i]); i += 1
            story.append(make_table(parse_table(block), width))
            story.append(Spacer(1, 8))
            continue

        if stripped == "---":
            flush_paragraph(); flush_lists()
            i += 1
            continue

        m = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if m:
            flush_paragraph(); flush_lists()
            level = len(m.group(1))
            text = inline(m.group(2))
            if level == 1 and not title_done:
                title_done = True
                i += 1
                continue  # the cover carries the title
            if level == 2:
                story.append(PageBreak() if any(isinstance(f, Heading) and f.level == 0 for f in story) else Spacer(1, 0))
                story.append(Heading(text, styles["h2"], 0))
            elif level == 3:
                story.append(Heading(text, styles["h3"], 1))
            else:
                story.append(Heading(text, styles["h1"], 0))
            i += 1
            continue

        if re.match(r"^- ", stripped):
            flush_paragraph()
            if numbered: flush_lists()
            bullets.append(stripped[2:])
            i += 1
            continue

        nm = re.match(r"^\d+\.\s+(.*)$", stripped)
        if nm:
            flush_paragraph()
            if bullets: flush_lists()
            numbered.append(nm.group(1))
            i += 1
            continue

        if stripped == "":
            flush_paragraph(); flush_lists()
            i += 1
            continue

        # The version line right under the title becomes the cover subtitle.
        if not story and stripped.startswith("**Version"):
            i += 1
            continue

        paragraph.append(stripped)
        i += 1

    flush_paragraph(); flush_lists()
    return story

def on_page(canvas, doc):
    if doc.page == 1:
        return
    canvas.saveState()
    canvas.setFont("Body", 8.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(2 * cm, 1.2 * cm, "FERN · User Interface Documentation · v2.0 · September 2026")
    canvas.drawRightString(A4[0] - 2 * cm, 1.2 * cm, f"Page {doc.page}")
    canvas.setStrokeColor(LINE)
    canvas.line(2 * cm, 1.6 * cm, A4[0] - 2 * cm, 1.6 * cm)
    canvas.restoreState()

def main():
    md = open(SRC, encoding="utf-8").read()
    doc = Doc(OUT, pagesize=A4, leftMargin=2 * cm, rightMargin=2 * cm, topMargin=2 * cm, bottomMargin=2.2 * cm,
              title="FERN User Interface Documentation", author="FERN", subject="Screens, roles and behaviour of the FERN referral platform")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=on_page)])

    # Cover
    story = []
    story.append(Spacer(1, 4 * cm))
    story.append(Image(LOGO, width=7 * cm, height=7 * cm * 200 / 490, hAlign="LEFT"))
    story.append(Spacer(1, 1.5 * cm))
    story.append(Paragraph("User Interface Documentation", styles["cover_title"]))
    story.append(Paragraph("Hospital emergency readiness and inter-hospital referral platform", styles["cover_sub"]))
    story.append(Spacer(1, 0.6 * cm))
    story.append(Paragraph("Version 2.0 · 27 September 2026", styles["cover_sub"]))
    story.append(Paragraph("https://hospital-ref.vercel.app", styles["cover_sub"]))
    story.append(Spacer(1, 5 * cm))
    story.append(Paragraph(
        "Written for the staff who use FERN every shift, the administrators who run it for a facility or for the "
        "network, and the team that maintains it. Database, security and API contracts are documented separately "
        "in docs/DATA_MODEL.md, docs/SECURITY.md and docs/API.md.",
        styles["meta"]))
    story.append(PageBreak())

    # Contents
    toc = TableOfContents()
    toc.levelStyles = [styles["toc1"], styles["toc2"]]
    toc.dotsMinLevel = 0
    story.append(Paragraph("Contents", styles["toc_h"]))
    story.append(toc)
    story.append(PageBreak())

    story.extend(build_story(md, doc.width))
    doc.multiBuild(story)
    print("written", OUT, os.path.getsize(OUT) // 1024, "KB")

if __name__ == "__main__":
    main()
