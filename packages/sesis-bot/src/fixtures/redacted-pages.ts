/**
 * Redacted SESIS pages. View-state and login values are fixtures, not from the capture.
 * Age values match the capture: 0 = School Age, 1 = Preschool.
 * Possible-bid status 3 matches the capture's selected "In Progress" option.
 */

export function loginPage(): string {
  return `<!DOCTYPE html><html><body><form action="userlogin.aspx" method="post">
<input type="hidden" name="__VIEWSTATE" value="vs-login" />
<input type="hidden" name="__VIEWSTATEGENERATOR" value="GENLOGIN" />
<input type="hidden" name="__EVENTVALIDATION" value="ev-login" />
<input type="text" name="txtUserID" value="" />
<input type="password" name="txtPassword" value="" />
<input type="submit" name="btnSignIn" value="Sign In" />
</form></body></html>`;
}

export function assignmentPage(opts: {
  viewState: string;
  /** 0 school age, 1 preschool */
  context: "0" | "1";
  bids: boolean;
}): string {
  const school = opts.context === "0" ? " selected" : "";
  const pre = opts.context === "1" ? " selected" : "";
  const bidStatus = opts.bids
    ? `<select name="ctl00$MainPlaceholder$BidStatusDropDownList">
<option value="1">Awarded</option>
<option value="3" selected>In Progress</option>
<option value="4">Not Awarded</option>
</select>`
    : "";
  return `<!DOCTYPE html><html><body><form method="post">
<input type="hidden" name="__VIEWSTATE" value="${opts.viewState}" />
<input type="hidden" name="__VIEWSTATEGENERATOR" value="GENPAGE" />
<input type="hidden" name="__EVENTVALIDATION" value="ev-${opts.viewState}" />
<input type="hidden" name="__EVENTTARGET" value="" />
<input type="hidden" name="__EVENTARGUMENT" value="" />
<select name="ctl00$FiscalYearsDropDownList">
<option value="30">SY-2025-2026</option>
<option value="31" selected>SY-2026-2027</option>
</select>
<select name="ctl00$ddlSelectedUserContext">
<option value="0"${school}>School Age</option>
<option value="1"${pre}>Preschool</option>
</select>
${bidStatus}
<input type="submit" name="ctl00$MainPlaceholder$ExportToExcelButton" value="Export To Excel" />
<input type="submit" name="ctl00$MainPlaceholder$PlaceBidButton" value="Place Bid" />
</form></body></html>`;
}
