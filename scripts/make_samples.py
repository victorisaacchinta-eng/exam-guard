"""Builds the mock exam paper and its tampered copy in samples/.

The two PDFs differ in one number (g = 9.8 becomes g = 9.6 in question 3),
which is enough to change almost every character of the SHA-256.
ReportLab's invariant mode keeps the output byte-identical between runs,
so the fingerprint stays stable once the original is sealed.

    python3 scripts/make_samples.py
"""

from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUT = Path(__file__).resolve().parent.parent / "samples"

QUESTIONS = [
    ("1", "State Newton's second law of motion and write it in terms of momentum.", 2),
    ("2", "A car speeds up from 18 km/h to 54 km/h in 5 s. Find its acceleration in m/s².", 3),
    ("3", "A stone is dropped from a 45 m tall building. Taking g = {g} m/s², find the time it takes to reach the ground and its speed on impact.", 5),
    ("4", "Define the work done by a constant force. When is the work done by a force zero? Give one example.", 4),
    ("5", "Two resistors of 6 Ω and 3 Ω are connected in parallel across a 12 V battery. Draw the circuit and find the current drawn from the battery.", 5),
    ("6", "Explain why a convex lens can form both real and virtual images. Use ray diagrams.", 6),
    ("7", "A 2 kg block slides on a rough floor with an initial speed of 4 m/s and stops after 8 m. Find the coefficient of kinetic friction.", 5),
]


def draw_text(c, x, y, text, font, size):
    """Draws text, setting any \u00b2 as a raised small 2 (the base fonts lack the glyph)."""
    parts = text.split("\u00b2")
    for i, part in enumerate(parts):
        c.setFont(font, size)
        c.drawString(x, y, part)
        x += c.stringWidth(part, font, size)
        if i < len(parts) - 1:
            c.setFont(font, size * 0.62)
            c.drawString(x + 0.3, y + size * 0.38, "2")
            x += c.stringWidth("2", font, size * 0.62) + 0.6


def wrap(text, width, c, font, size):
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if c.stringWidth(trial, font, size) <= width:
            line = trial
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def build(path, g):
    c = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    c.setTitle("Physics Mid-Semester Examination 2026 (mock)")
    c.setAuthor("Exam Guard demo")
    w, h = A4
    left, right = 20 * mm, w - 20 * mm

    # Roll number boxes, top right, like a real paper.
    c.setFont("Helvetica", 8)
    c.drawRightString(right - 62 * mm, h - 18 * mm, "Roll No.")
    for i in range(10):
        c.rect(right - (10 - i) * 6 * mm, h - 20 * mm, 6 * mm, 6 * mm)

    c.setFont("Helvetica-Bold", 9)
    c.drawString(left, h - 18 * mm, "Paper code: PHY-MS-26")

    c.setFont("Times-Bold", 15)
    c.drawCentredString(w / 2, h - 34 * mm, "PHYSICS MID-SEMESTER EXAMINATION 2026")
    c.setFont("Times-Roman", 10.5)
    c.drawCentredString(w / 2, h - 40 * mm, "Mock paper for the Exam Guard demo. Not an official examination.")
    c.drawString(left, h - 50 * mm, "Time: 90 minutes")
    c.drawRightString(right, h - 50 * mm, "Maximum marks: 30")
    c.line(left, h - 53 * mm, right, h - 53 * mm)

    c.setFont("Times-Italic", 10)
    y = h - 60 * mm
    for line in [
        "Answer all questions. Marks for each question are shown on the right.",
        "Use of a non-programmable calculator is allowed. Draw diagrams where they help.",
    ]:
        c.drawString(left, y, line)
        y -= 5 * mm

    y -= 4 * mm
    body = right - left - 22 * mm
    for num, text, marks in QUESTIONS:
        text = text.format(g=g)
        lines = wrap(text, body, c, "Times-Roman", 11.5)
        c.setFont("Times-Bold", 11.5)
        c.drawString(left, y, f"{num}.")
        for i, line in enumerate(lines):
            draw_text(c, left + 8 * mm, y - i * 6 * mm, line, "Times-Roman", 11.5)
        c.setFont("Times-Bold", 11.5)
        c.drawRightString(right, y, f"[{marks}]")
        y -= (len(lines) * 6 + 7) * mm

    c.line(left, 24 * mm, right, 24 * mm)
    c.setFont("Times-Italic", 9)
    c.drawCentredString(w / 2, 18 * mm, "End of paper")
    c.save()


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    build(OUT / "physics-midsem-2026.pdf", g="9.8")
    build(OUT / "physics-midsem-2026-tampered.pdf", g="9.6")
    print("wrote", *sorted(p.name for p in OUT.glob("*.pdf")))
