#!/usr/bin/env python3
"""Generate a client-facing PDF guide for White Glove ProviderSoft → HHA automation."""

from __future__ import annotations

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
    Table,
    TableStyle,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
LOGO_PATH = REPO_ROOT / "docs" / "assets" / "aa-logo.png"
OUTPUT_PATH = REPO_ROOT / "docs" / "White-Glove-Automation-Guide.pdf"

FOOTER_H = 0.9 * inch
MARGIN = 0.7 * inch
PAGE_W, PAGE_H = letter

NAVY = colors.HexColor("#0B3D5C")
TEAL = colors.HexColor("#1A5F7A")
ACCENT = colors.HexColor("#2563EB")
LIGHT_BG = colors.HexColor("#E8F4F8")
LIGHT_BORDER = colors.HexColor("#CBD5E1")
TEXT = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#64748B")
WARN = colors.HexColor("#9B2C2C")
WHITE = colors.white


def build_styles():
    base = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=30,
            leading=36,
            textColor=WHITE,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "cover_sub": ParagraphStyle(
            "CoverSub",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=14,
            leading=20,
            textColor=colors.HexColor("#E2E8F0"),
            alignment=TA_CENTER,
            spaceAfter=6,
        ),
        "title": ParagraphStyle(
            "Title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=28,
            textColor=NAVY,
            spaceAfter=10,
            alignment=TA_LEFT,
        ),
        "subtitle": ParagraphStyle(
            "Subtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=12,
            leading=17,
            textColor=MUTED,
            spaceAfter=14,
            alignment=TA_LEFT,
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=22,
            textColor=NAVY,
            spaceBefore=16,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=16,
            textColor=TEAL,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            textColor=TEXT,
            spaceAfter=8,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=14,
            leftIndent=10,
            textColor=TEXT,
        ),
        "table_cell": ParagraphStyle(
            "TableCell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            textColor=TEXT,
        ),
        "table_header": ParagraphStyle(
            "TableHeader",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=13,
            textColor=WHITE,
        ),
        "callout": ParagraphStyle(
            "Callout",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.5,
            leading=15,
            textColor=NAVY,
        ),
        "step_num": ParagraphStyle(
            "StepNum",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=15,
            textColor=ACCENT,
        ),
        "closing": ParagraphStyle(
            "Closing",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=TEXT,
            spaceAfter=8,
            alignment=TA_CENTER,
        ),
    }


def draw_cover_background(canvas, _doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 3.1 * inch, PAGE_W, 3.1 * inch, fill=1, stroke=0)
    canvas.setFillColor(ACCENT)
    canvas.rect(0, PAGE_H - 3.25 * inch, PAGE_W, 0.12 * inch, fill=1, stroke=0)
    canvas.restoreState()


def draw_footer(canvas, doc):
    canvas.saveState()
    y = 0.42 * inch
    canvas.setStrokeColor(LIGHT_BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, y + 0.58 * inch, PAGE_W - MARGIN, y + 0.58 * inch)

    if LOGO_PATH.exists():
        logo_w = 1.3 * inch
        logo_h = 0.4 * inch
        canvas.drawImage(
            str(LOGO_PATH),
            (PAGE_W - logo_w) / 2,
            y - 0.02 * inch,
            width=logo_w,
            height=logo_h,
            preserveAspectRatio=True,
            mask="auto",
        )

    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(PAGE_W / 2, y - 0.2 * inch, "Advanced Automations  •  advancedautomations.net")
    canvas.drawCentredString(PAGE_W / 2, y - 0.34 * inch, f"White Glove Automation Guide  •  Page {doc.page}")
    canvas.restoreState()


def bullet_list(items, styles):
    return ListFlowable(
        [ListItem(Paragraph(item, styles["bullet"])) for item in items],
        bulletType="bullet",
        start="•",
        leftIndent=16,
        bulletFontName="Helvetica",
        bulletFontSize=9,
        spaceBefore=2,
        spaceAfter=6,
    )


def callout_box(text, styles, bg=LIGHT_BG):
    tbl = Table([[Paragraph(text, styles["callout"])]], colWidths=[6.9 * inch])
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("BOX", (0, 0), (-1, -1), 0.5, ACCENT),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return tbl


def styled_table(rows, col_widths, styles):
    wrapped = []
    for r_idx, row in enumerate(rows):
        wrapped_row = []
        for c_idx, cell in enumerate(row):
            style = styles["table_header"] if r_idx == 0 else styles["table_cell"]
            wrapped_row.append(Paragraph(str(cell), style))
        wrapped.append(wrapped_row)

    tbl = Table(wrapped, colWidths=col_widths, repeatRows=1)
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.25, LIGHT_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    for i in range(1, len(rows)):
        if i % 2 == 0:
            cmds.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F8FAFC")))
    tbl.setStyle(TableStyle(cmds))
    return tbl


def step_block(number, title, body, styles):
    parts = [
        Paragraph(f'<font color="#2563EB"><b>Step {number}</b></font> — {title}', styles["h2"]),
        Paragraph(body, styles["body"]),
    ]
    return parts


def build_story(styles):
    story = []

    # ── Cover ──
    story.append(Spacer(1, 2.35 * inch))
    story.append(Paragraph("White Glove Care", styles["cover_title"]))
    story.append(Paragraph("ProviderSoft → HHA Automation Guide", styles["cover_sub"]))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph("Prepared by Advanced Automations", styles["cover_sub"]))
    story.append(Spacer(1, 0.55 * inch))
    story.append(
        Paragraph(
            "A plain-language guide for coordinators and managers — "
            "what runs automatically, when, and what you need to enter correctly in ProviderSoft.",
            styles["body"],
        )
    )
    story.append(PageBreak())

    # ── Welcome ──
    story.append(Paragraph("Welcome", styles["title"]))
    story.append(
        Paragraph(
            "This software connects ProviderSoft to HHA Exchange so your team does not have to "
            "re-enter cases, services, discharges, and therapist visits by hand.",
            styles["subtitle"],
        )
    )
    story.append(
        callout_box(
            "<b>In one sentence:</b> Every night the system downloads your ProviderSoft reports, "
            "reads each row, updates HHA to match, and emails you if anything needs attention.",
            styles,
        )
    )
    story.append(Spacer(1, 0.12 * inch))
    story.append(
        bullet_list(
            [
                "<b>New intakes &amp; new services</b> → create/update patient, contract, and authorization in HHA",
                "<b>Case closure</b> → discharge all active services when the whole case is done",
                "<b>Service discharge</b> → close only one service line when others stay active",
                "<b>Verified sessions (API Report)</b> → match visits, link mobile clocks (EVV), approve sessions",
            ],
            styles,
        )
    )

    # ── How a run works ──
    story.append(Paragraph("How one automated run works", styles["h1"]))
    story.append(
        Paragraph(
            "Each run follows the same four steps. Think of it like a careful assistant who exports "
            "your reports, checks every line, updates HHA, and sends you a summary.",
            styles["body"],
        )
    )
    for num, title, body in [
        (
            "1",
            "Download reports from ProviderSoft",
            "The bot logs into ProviderSoft (like a person would), opens each saved report, "
            "sets the date filter, and exports a spreadsheet. For case reports the filter uses "
            "<b>today’s date</b> (Eastern time) because the run happens around <b>11:00 PM</b> — "
            "the same day coordinators enter Date of Intake, before midnight.",
        ),
        (
            "2",
            "Read &amp; validate each row",
            "The system reads every row and checks required fields (Program Id, Service Type, "
            "Date of Intake, etc.). Early Intervention cases are skipped by design. "
            "Missing or unknown codes trigger an alert — the system will not guess.",
        ),
        (
            "3",
            "Update HHA Exchange",
            "For each valid row, the system finds the patient in HHA, creates or updates contracts, "
            "authorizations, discharges, or session visits. New Program Types and Service Types are "
            "looked up in HHA the first time they appear, then saved so future runs are faster.",
        ),
        (
            "4",
            "Email summary",
            "You receive an email listing successes, skips, and any rows that failed — with "
            "plain-English guidance on what to fix in ProviderSoft.",
        ),
    ]:
        story.extend(step_block(num, title, body, styles))

    story.append(Spacer(1, 0.08 * inch))
    story.append(
        callout_box(
            "<b>Date of Intake rule:</b> Enter the case today → set Date of Intake = <b>today</b> → "
            "that same night’s 11 PM run picks it up (filter = today).",
            styles,
        )
    )

    story.append(PageBreak())

    # ── Weekly schedule ──
    story.append(Paragraph("Weekly schedule (when enabled)", styles["h1"]))
    story.append(
        Paragraph(
            "After go-live approval, these are the planned run times (all ~11:00 PM Eastern). "
            "Schedules are currently off during setup — runs are manual until you enable them.",
            styles["body"],
        )
    )
    story.append(Spacer(1, 0.08 * inch))
    story.append(
        styled_table(
            [
                ["When", "Reports", "Writes to HHA?", "Purpose"],
                [
                    "Every night",
                    "Gluck open, new service, gluck closure, discharge service",
                    "Yes — live",
                    "Sync cases &amp; services entered today",
                ],
                [
                    "Monday night",
                    "All case reports + caregiver codes (+ API Report if sessions enabled)",
                    "<b>No</b> — preview only",
                    "Monday Preview — see next page",
                ],
                [
                    "Tuesday night",
                    "API Report + caregiver codes",
                    "Yes — live",
                    "Process verified sessions after Monday fixes",
                ],
            ],
            [1.05 * inch, 2.35 * inch, 1.05 * inch, 2.0 * inch],
            styles,
        )
    )

    # ── Monday Preview — dedicated section ──
    story.append(Spacer(1, 0.18 * inch))
    story.append(Paragraph("Monday Preview — what it is and why it matters", styles["h1"]))
    story.append(
        callout_box(
            "<b>Monday Preview is a dry-run.</b> It downloads and checks your reports but "
            "<b>does not write anything to HHA</b>. It is your early-warning system before "
            "Tuesday’s live session processing.",
            styles,
            bg=colors.HexColor("#EFF6FF"),
        )
    )
    story.append(Spacer(1, 0.1 * inch))
    story.append(Paragraph("What Monday Preview does", styles["h2"]))
    story.append(
        bullet_list(
            [
                "Downloads the same reports as a normal run (cases, new services, caregiver list, and optionally API Report)",
                "Reads every row and checks whether Program Type, Service Type, pay codes, and caregiver names can be resolved",
                "Queries HHA <b>only when a code is not already known</b> — first miss looks up HHA and saves the mapping for later",
                "Sends an <b>email alert</b> listing anything that would fail on a live run",
                "<b>Never creates patients, contracts, discharges, or approved visits</b> in HHA",
            ],
            styles,
        )
    )
    story.append(Paragraph("What you should do Tuesday morning", styles["h2"]))
    story.append(
        bullet_list(
            [
                "Open the Monday Preview email (if you received one)",
                "Fix any flagged items in ProviderSoft — usually a misspelled Service Type, missing Provider Name, or new code not yet in HHA",
                "Ensure new HHA billing codes use the <b>exact same name</b> in ProviderSoft",
                "Tuesday night’s live session run will then process the API Report successfully",
            ],
            styles,
        )
    )
    story.append(Paragraph("What Monday Preview checks", styles["h2"]))
    story.append(
        styled_table(
            [
                ["Check", "What it means if it fails"],
                [
                    "Program Type → HHA contract",
                    "Payer/program name in ProviderSoft does not match any HHA contract — fix spelling or add contract in HHA",
                ],
                [
                    "Service Type → HHA billing code",
                    "Service name does not match HHA — fix spelling or create billing code in HHA admin",
                ],
                [
                    "Provider Name → caregiver",
                    "Therapist name not found — update caregiver codes report or fix name spelling",
                ],
                [
                    "Pay Rate + Service Type → pay code",
                    "Combination like OT72 not found in HHA — verify pay code exists",
                ],
                [
                    "Required fields blank",
                    "Missing Date of Birth, Authorization Number, etc. on open reports",
                ],
            ],
            [2.2 * inch, 4.3 * inch],
            styles,
        )
    )
    story.append(Spacer(1, 0.1 * inch))
    story.append(
        Paragraph(
            "<font color='#9B2C2C'><b>Important:</b></font> If Monday Preview shows no issues, "
            "Tuesday’s session run should proceed smoothly. If you skip reviewing Monday’s email, "
            "Tuesday may fail on the same rows.",
            styles["body"],
        )
    )

    story.append(PageBreak())

    # ── Reports reference ──
    story.append(Paragraph("Reports — required fields &amp; date filters", styles["h1"]))
    story.append(
        Paragraph(
            "Each saved report in ProviderSoft must include the columns below. "
            "Blank required fields = row fails + email alert.",
            styles["body"],
        )
    )

    report_rows = [
        ["Report", "Date filter (nightly)", "Key required fields"],
        [
            "Gluck open",
            "Date of Intake = today",
            "Program Id, Child Name, Program Type, Service Type, Service Begin Date, Authorization #, Date of Intake, DOB/Address",
        ],
        [
            "New service",
            "Date of Intake = today",
            "Program Id, Program Type, Service Type, Service Begin Date, Authorization #",
        ],
        [
            "Discharge service",
            "Service Discharge Date = today",
            "Program Id, <b>Service Type</b>, <b>Service Begin Date</b> (both required)",
        ],
        [
            "Gluck closure",
            "Closure Date = today",
            "Program Id, Closure Date, Program Type (discharges ALL services)",
        ],
        [
            "API Report",
            "Session date: last 7 days",
            "Session Id, Program Id, Service Type, Session Date, Provider Name, Pay Rate, Begin/End Time",
        ],
        [
            "Caregiver codes",
            "No date filter",
            "Provider Name, Caregiver Code (reference list for sessions)",
        ],
    ]
    story.append(styled_table(report_rows, [1.35 * inch, 1.65 * inch, 3.5 * inch], styles))

    story.append(Spacer(1, 0.14 * inch))
    story.append(Paragraph("Which report when?", styles["h2"]))
    story.append(
        styled_table(
            [
                ["Situation", "Use this report"],
                ["Brand-new child intake", "Gluck open"],
                ["Existing child, new service line", "New service"],
                ["One service ends, case stays open", "Discharge service"],
                ["Entire case finished", "Gluck closure"],
                ["Therapist visits to verify/approve", "API Report (Tuesday live)"],
            ],
            [3.0 * inch, 3.5 * inch],
            styles,
        )
    )

    story.append(PageBreak())

    # ── Coordinator responsibilities ──
    story.append(Paragraph("Coordinator responsibilities", styles["h1"]))
    story.append(
        bullet_list(
            [
                "Fill <b>Date of Intake</b> the same calendar day you enter a case or new service",
                "Keep <b>Program Type</b> and <b>Service Type</b> spelled exactly like HHA admin names",
                "On discharge service rows, always fill <b>Service Type + Service Begin Date</b>",
                "Use <b>gluck closure</b> only when the whole case is done; use <b>discharge service</b> for one line ending",
                "Review <b>Monday Preview email</b> before Tuesday session processing",
                "Read alert emails the morning after any run and fix flagged rows in ProviderSoft",
            ],
            styles,
        )
    )

    story.append(Paragraph("Risks to avoid", styles["h1"]))
    story.append(
        styled_table(
            [
                ["Risk", "Prevention"],
                [
                    "Case not synced",
                    "Fill Date of Intake same day you enter the case",
                ],
                [
                    "Wrong service discharged",
                    "Always fill Service Type + Begin Date on discharge service rows",
                ],
                [
                    "New code fails",
                    "Match HHA name exactly in ProviderSoft; Monday Preview catches it early",
                ],
                [
                    "Session not approved",
                    "Provider Name must match; caregiver must clock in on HHA mobile app (EVV)",
                ],
                [
                    "Duplicate patient names in HHA",
                    "Ensure Program Id is linked in HHA — system will alert, not guess",
                ],
            ],
            [2.4 * inch, 4.1 * inch],
            styles,
        )
    )

    story.append(Spacer(1, 0.2 * inch))
    story.append(HRFlowable(width="100%", thickness=1, color=LIGHT_BORDER))
    story.append(Spacer(1, 0.18 * inch))
    story.append(Paragraph("We’re here for you", styles["title"]))
    story.append(
        Paragraph(
            "Automation should make your evenings quieter — not add worry. "
            "If a report looks wrong, an alert is confusing, or you’re unsure which report to use, "
            "reach out anytime. We built this for White Glove with care.",
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

    return story


def on_cover_page(canvas, doc):
    draw_cover_background(canvas, doc)
    draw_footer(canvas, doc)


def on_body_page(canvas, doc):
    if doc.page > 1:
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#F8FAFC"))
        canvas.rect(0, PAGE_H - 0.55 * inch, PAGE_W, 0.55 * inch, fill=1, stroke=0)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, PAGE_H - 0.38 * inch, "White Glove  •  ProviderSoft → HHA Automation")
        canvas.restoreState()
    draw_footer(canvas, doc)


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

    doc.build(
        build_story(styles),
        onFirstPage=on_cover_page,
        onLaterPages=on_body_page,
    )
    print(f"Wrote {OUTPUT_PATH} ({OUTPUT_PATH.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
