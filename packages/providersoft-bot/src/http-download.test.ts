import { describe, expect, it } from 'vitest';
import {
  applyDateFilterToBody,
  assertHttpCsvHasDataRows,
  clientStateNameForDateInput,
  formatTelerikDateValue,
  pickDateInputNamesByLabel,
} from './http-download.js';

describe('assertHttpCsvHasDataRows', () => {
  it('accepts Gender header-only CSV as empty success (0 data rows)', () => {
    const header =
      "Child's Name,Program Id,Date of Birth,Gender:\n";
    expect(
      assertHttpCsvHasDataRows(Buffer.from(header, 'utf8'), 'opened_cases'),
    ).toBe(0);
  });

  it('allows CSV with data rows and returns count', () => {
    const csv =
      "Child's Name,Program Id,Gender:\nSmith,1,M\n";
    expect(
      assertHttpCsvHasDataRows(Buffer.from(csv, 'utf8'), 'opened_cases'),
    ).toBe(1);
  });

  it('rejects HTML/error page bodies as malformed non-CSV', () => {
    expect(() =>
      assertHttpCsvHasDataRows(
        Buffer.from('<!DOCTYPE html><html><body>error</body></html>', 'utf8'),
        'opened_cases',
      ),
    ).toThrow(/non-CSV HTML/);
  });

  it('skips HTML check for caregiver_codes reference export', () => {
    expect(
      assertHttpCsvHasDataRows(Buffer.from('Code\n', 'utf8'), 'caregiver_codes'),
    ).toBe(0);
  });
});

describe('Telerik ClientState helpers', () => {
  it('formats M/D/YYYY like browser HAR validationText', () => {
    expect(formatTelerikDateValue('7/30/2026')).toBe('2026-07-30-00-00-00');
    expect(formatTelerikDateValue('8/13/2026')).toBe('2026-08-13-00-00-00');
  });

  it('maps dateInput $ names to underscore ClientState names', () => {
    expect(
      clientStateNameForDateInput(
        'ctl00$Content$dlREportColumns$ctl33$DLColumControl_32_1$datePicker$dateInput',
      ),
    ).toBe(
      'ctl00_Content_dlREportColumns_ctl33_DLColumControl_32_1_datePicker_dateInput_ClientState',
    );
  });

  it('writes dateInput + ISO datePicker + ClientState onto the form body', () => {
    const body = new URLSearchParams();
    const name =
      'ctl00$Content$dlREportColumns$ctl04$DLColumControl_3_1$datePicker$dateInput';
    applyDateFilterToBody(body, name, '8/13/2026');
    expect(body.get(name)).toBe('8/13/2026');
    expect(
      body.get(
        'ctl00$Content$dlREportColumns$ctl04$DLColumControl_3_1$datePicker',
      ),
    ).toBe('2026-08-13');
    expect(
      body.get(
        'ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_1_datePicker_ClientState',
      ),
    ).toBe(
      JSON.stringify({
        minDateStr: '1753-01-01-00-00-00',
        maxDateStr: '9999-12-31-00-00-00',
      }),
    );    const state = JSON.parse(
      body.get(clientStateNameForDateInput(name))!,
    ) as Record<string, string>;
    expect(state.validationText).toBe('2026-08-13-00-00-00');
    expect(state.valueAsString).toBe('2026-08-13-00-00-00');
    expect(state.lastSetTextBoxValue).toBe('8/13/2026');
  });
});

describe('pickDateInputNamesByLabel', () => {
  it('finds from/to names near the filter label', () => {
    const html = `
      <tr><td>Date of Intake</td>
      <td>
        <input id="ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_1_datePicker_dateInput" name="ctl00$Content$dlREportColumns$ctl04$DLColumControl$3_1$datePicker$dateInput" />
        <input id="ctl00_Content_dlREportColumns_ctl04_DLColumControl_3_2_datePicker_dateInput" name="ctl00$Content$dlREportColumns$ctl04$DLColumControl$3_2$datePicker$dateInput" />
      </td></tr>
      <tr><td>Service Begin Date</td>
      <td>
        <input id="ctl00_Content_dlREportColumns_ctl33_DLColumControl_32_1_datePicker_dateInput" name="ctl00$Content$dlREportColumns$ctl33$DLColumControl$32_1$datePicker$dateInput" />
        <input id="ctl00_Content_dlREportColumns_ctl33_DLColumControl_32_2_datePicker_dateInput" name="ctl00$Content$dlREportColumns$ctl33$DLColumControl$32_2$datePicker$dateInput" />
      </td></tr>
    `;
    const intake = pickDateInputNamesByLabel(html, 'Date of Intake');
    expect(intake.from).toContain('3_1');
    expect(intake.to).toContain('3_2');
    const begin = pickDateInputNamesByLabel(html, 'Service Begin Date');
    expect(begin.from).toContain('32_1');
    expect(begin.to).toContain('32_2');
  });
});
