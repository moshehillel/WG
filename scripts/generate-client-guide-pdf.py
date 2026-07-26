#!/usr/bin/env python3
"""Generate a client-facing PDF guide for White Glove ProviderSoft → HHA automation."""

from __future__ import annotations

import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
LOGO_PATH = REPO_ROOT / "docs" / "assets" / "aa-logo.png"
OUTPUT_PATH = REPO_ROOT / "docs" / "White-Glove-Automation-Guide.pdf"

FOOTER_H = 0.85 * inch
MARGIN = 0.75 * inch


def build_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=26,
            leading=32,
            textColor=colors.HexColor("#0B3D5C"),
            spaceAfter=14,
            alignment=TA_CENTER,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=13,
            leading=18,
            textColor=colors.HexColor("#4A5568"),
            spaceAfter=20,
            alignment=TA_CENTER,
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=24,
            textColor=colors.HexColor("#0B3D5C"),
            spaceBefore=18,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=18,
            textColor=colors.HexColor("#1A5F7A"),
            spaceBefore=14,
            spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=colors.HexColor("#1F2937"),
            spaceAfter=8,
            alignment=TA_LEFT,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=15,
            leftIndent=12,
            textColor=colors.HexColor("#1F2937"),
        ),
        "important": ParagraphStyle(
            "Important",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=16,
            textColor=colors.HexColor("#9B2C2C"),
            spaceAfter=8,
        ),
        "footer_note": ParagraphStyle(
            "FooterNote",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#64748B"),
            alignment=TA_CENTER,
        ),
        "closing": ParagraphStyle(
            "Closing",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=12,
            leading=18,
            textColor=colors.HexColor("#1F2937"),
            spaceAfter=10,
            alignment=TA_CENTER,
        ),
    }


def draw_footer(canvas, doc):
    canvas.saveState()
    w, h = letter
    y = 0.45 * inch
    canvas.setStrokeColor(colors.HexColor("#CBD5E1"))
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, y + 0.55 * inch, w - MARGIN, y + 0.55 * inch)

    if LOGO_PATH.exists():
        logo_w = 1.35 * inch
        logo_h = 0.42 * inch
        canvas.drawImage(
            str(LOGO_PATH),
            (w - logo_w) / 2,
            y - 0.05 * inch,
            width=logo_w,
            height=logo_h,
            preserveAspectRatio=True,
            mask="auto",
        )

    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawCentredString(w / 2, y - 0.22 * inch, "Advanced Automations  •  advancedautomations.net")
    canvas.drawCentredString(w / 2, y - 0.36 * inch, f"Page {doc.page}")
    canvas.restoreState()


def bullet_list(items, styles):
    return ListFlowable(
        [ListItem(Paragraph(item, styles["bullet"])) for item in items],
        bulletType="bullet",
        start="•",
        leftIndent=18,
        bulletFontName="Helvetica",
        bulletFontSize=10,
        spaceBefore=4,
        spaceAfter=8,
    )


def build_story(styles):
    story = []

    story.append(Spacer(1, 0.35 * inch))
    story.append(Paragraph("Welcome, White Glove Team", styles["title"]))
    story.append(
        Paragraph(
            "Your ProviderSoft → HHA automation guide<br/>"
            "Prepared by <b>Advanced Automations</b>",
            styles["subtitle"],
        )
    )
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#CBD5E1")))
    story.append(Spacer(1, 0.2 * inch))

    story.append(
        Paragraph(
            "Thank you for trusting us with this project. This guide explains—in plain language—"
            "what the software does each night, how it keeps your data in sync, and what your "
            "coordinators need to enter correctly in ProviderSoft so everything runs smoothly.",
            styles["body"],
        )
    )

    story.append(Paragraph("What this software does", styles["h1"]))
    story.append(
        Paragraph(
            "Every night, the system quietly downloads selected reports from ProviderSoft, "
            "reads the rows, and updates HHA Exchange to match—without anyone logging in manually.",
            styles["body"],
        )
    )
    story.append(
        bullet_list(
            [
                "<b>New cases &amp; new services</b> — creates or updates the child, contract, and authorization in HHA.",
                "<b>Case closure</b> — when an entire case is finished, all active services in HHA are discharged.",
                "<b>Service discharge</b> — when only one service ends, only that service line is closed in HHA.",
                "<b>Verified sessions (API Report)</b> — matches therapist visits, links mobile clock-ins where required, and approves visits.",
            ],
            styles,
        )
    )
    story.append(
        Paragraph(
            "If something cannot be processed safely, you receive an email alert the same night—"
            "nothing is silently skipped except Early Intervention cases (by design).",
            styles["body"],
        )
    )

    story.append(Paragraph("How it works (simple overview)", styles["h1"]))
    story.append(
        bullet_list(
            [
                "<b>Step 1 — Download:</b> The bot opens ProviderSoft and exports today’s reports (like exporting a spreadsheet).",
                "<b>Step 2 — Read &amp; organize:</b> Each row is checked for required fields and business rules.",
                "<b>Step 3 — Update HHA:</b> Patient, service, discharge, or session actions run in HHA Exchange.",
                "<b>Step 4 — Email summary:</b> You get a summary of successes, skips, and anything that needs attention.",
            ],
            styles,
        )
    )
    story.append(
        Paragraph(
            "<b>When does it run?</b> By default the nightly schedule is off until you approve go-live. "
            "When enabled: case reports run every night around 2:00 AM Eastern; session reports run Tuesday nights "
            "after Monday’s preview check.",
            styles["body"],
        )
    )

    story.append(PageBreak())
    story.append(Paragraph("What must be in each report", styles["h1"]))
    story.append(
        Paragraph(
            "These fields are <b>required</b> for automation to work. If a column is missing or blank, "
            "that row will fail and appear in your alert email.",
            styles["important"],
        )
    )

    reports = [
        (
            "Gluck open (new intakes)",
            "Filter: <b>Date of Intake = today</b>",
            [
                "<b>Program Id</b> — unique case number",
                "<b>Child’s Name</b>",
                "<b>Program Type</b> — must match a known HHA contract/payer",
                "<b>Service Type</b> — must match a known HHA billing code",
                "<b>Service Begin Date</b>",
                "<b>Authorization Number</b>",
                "<b>Date of Intake</b> — must be filled in ProviderSoft so the case appears in tonight’s export",
                "Demographics for new patients: <b>Date of Birth, Address, City, State, Zip</b> (for HHA patient create)",
            ],
        ),
        (
            "New service (existing child, new service line)",
            "Filter: <b>Date of Intake = today</b> (entered today, even if service starts later)",
            [
                "<b>Program Id</b>",
                "<b>Program Type</b>",
                "<b>Service Type</b>",
                "<b>Service Begin Date</b> — actual start of the service in HHA",
                "<b>Authorization Number</b>",
                "Same HHA flow as Gluck open; child already exists in ProviderSoft/HHA",
            ],
        ),
        (
            "Discharge service (one service ends)",
            "Filter: <b>Service Discharge Date = today</b>",
            [
                "<b>Program Id</b>",
                "<b>Service Type</b> — <font color='#9B2C2C'><b>required</b></font>; must match the active line in HHA",
                "<b>Service Begin Date</b> — <font color='#9B2C2C'><b>required</b></font>; must match exactly",
                "<b>Program Type</b> — helps identify the correct line when a child has multiple services",
                "Use this report when the <b>case stays open</b> but one service ends",
            ],
        ),
        (
            "Gluck closure (whole case closed)",
            "Filter: <b>Closure Date = today</b>",
            [
                "<b>Program Id</b>",
                "<b>Closure Date</b>",
                "<b>Program Type</b>",
                "Discharges <b>all</b> active services for that child in HHA",
                "Use only when the entire case is finished—not for single-service discharge",
            ],
        ),
        (
            "API Report (verified sessions)",
            "Filter: <b>Session date = last 7 days through today</b>",
            [
                "<b>Session Id</b>",
                "<b>Program Id</b> / patient reference",
                "<b>Program Type</b>",
                "<b>Service Type</b>",
                "<b>Session Date</b>",
                "<b>Provider Name</b> — must match caregiver codes report",
                "<b>Pay Rate</b> — combined with Service Type for HHA pay code (e.g. OT + 72 → OT72)",
                "<b>Begin Time / End Time</b> — for EVV clock verification",
            ],
        ),
        (
            "Caregiver codes (reference list)",
            "No date filter — full list export",
            [
                "<b>Provider Name</b>",
                "<b>Caregiver Code</b> — HHA caregiver ID",
                "Downloaded with session runs so Provider Name can be matched",
            ],
        ),
    ]

    for title, filter_note, fields in reports:
        story.append(Paragraph(title, styles["h2"]))
        story.append(Paragraph(filter_note, styles["body"]))
        story.append(bullet_list(fields, styles))

    story.append(PageBreak())
    story.append(Paragraph("Coordinator checklist — please remember", styles["h1"]))
    story.append(
        bullet_list(
            [
                "Fill <b>Date of Intake</b> on new cases the same day you enter them—otherwise tonight’s Gluck open export will miss the row.",
                "For <b>discharge service</b>, always fill <b>Service Type + Service Begin Date</b>. Never leave them blank when a child has more than one active service.",
                "Use <b>gluck closure</b> only when the whole case is done. Use <b>discharge service</b> when one service ends and others continue.",
                "<b>Early Intervention</b> cases are never sent to HHA—this is intentional.",
                "If you add a new <b>Program Type</b> or <b>Service Type</b>, tell us before go-live so we can map it in HHA.",
                "Read alert emails the morning after a run—each item includes what to fix in ProviderSoft.",
            ],
            styles,
        )
    )

    story.append(Paragraph("What happens when something goes wrong?", styles["h1"]))
    story.append(
        bullet_list(
            [
                "You receive an email listing each problem row and plain-English guidance.",
                "The system prefers to <b>stop and alert</b> rather than update the wrong patient or wrong service.",
                "After you fix the data in ProviderSoft, the next nightly run will pick it up.",
                "Monday preview (dry-run) flags mapping gaps before Tuesday session processing.",
            ],
            styles,
        )
    )

    story.append(Spacer(1, 0.3 * inch))
    story.append(HRFlowable(width="60%", thickness=1, color=colors.HexColor("#CBD5E1"), hAlign="CENTER"))
    story.append(Spacer(1, 0.25 * inch))
    story.append(Paragraph("We’re here for you", styles["title"]))
    story.append(
        Paragraph(
            "Automation should make your evenings quieter—not add worry. "
            "If a report looks wrong, an alert is confusing, or you’re unsure which report to use, "
            "reach out anytime.",
            styles["closing"],
        )
    )
    story.append(
        Paragraph(
            "<b>Moshe &amp; the Advanced Automations team</b><br/>"
            "moshe@advancedautomations.net<br/>"
            "advancedautomations.net",
            styles["closing"],
        )
    )
    story.append(Spacer(1, 0.15 * inch))
    story.append(
        Paragraph(
            "We built this system for White Glove with care. "
            "Your feedback helps us improve it—and we’re always here when you need us.",
            styles["closing"],
        )
    )

    return story


def main():
    if not LOGO_PATH.exists():
        raise SystemExit(f"Logo not found: {LOGO_PATH}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    styles = build_styles()

    doc = SimpleDocTemplate(
        str(OUTPUT_PATH),
        pagesize=letter,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN + FOOTER_H,
        title="White Glove Automation Guide",
        author="Advanced Automations",
    )

    doc.build(build_story(styles), onFirstPage=draw_footer, onLaterPages=draw_footer)
    print(f"Wrote {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
