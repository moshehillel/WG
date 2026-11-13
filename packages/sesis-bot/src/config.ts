/**
 * SESIS (sesis.nycenet.edu) awarded-case and possible-bid downloads.
 *
 * Preschool vs school age is the Provider Assignment dropdown
 * `ctl00$ddlSelectedUserContext`: 0 = School Age, 1 = Preschool.
 *
 * Local stub (no login):
 *   npm run local:stubs
 *   npm run sesis:stubs
 * Live (repo-root .env: SESIS_USERNAME, SESIS_PASSWORD, optional SESIS_WORKSPACE):
 *   npm run local:download
 *   npm run sesis:download
 *
 * Does not place bids.
 */

export const SESIS_ORIGIN_DEFAULT = "https://sesis.nycenet.edu";
export const SESIS_WORKSPACE_DEFAULT = "NYCONFIG";

/** Capture: option value on ctl00$ddlSelectedUserContext. */
export const SESIS_AGE_GROUPS = {
  school_age: { value: "0", label: "School Age" },
  preschool: { value: "1", label: "Preschool" },
} as const;

export type SesisAgeGroup = keyof typeof SESIS_AGE_GROUPS;

export const CONTEXT_FIELD = "ctl00$ddlSelectedUserContext";
export const CONTEXT_EVENT_TARGET = "ctl00$ddlSelectedUserContext";
/** Opens the bid list. This is not the control that places a bid. */
export const OPEN_BIDS_EVENT_TARGET = "ctl00$SubmitBidsLinkButton";
export const EXPORT_BUTTON_NAME = "ctl00$MainPlaceholder$ExportToExcelButton";
export const EXPORT_BUTTON_VALUE = "Export To Excel";
export const FISCAL_YEAR_FIELD = "ctl00$FiscalYearsDropDownList";
export const BID_STATUS_FIELD = "ctl00$MainPlaceholder$BidStatusDropDownList";
/**
 * Capture exported possible bids with Bid Status "In Progress" (value 3),
 * the option selected on SubmitBid.aspx. Other statuses were not included.
 */
export const POSSIBLE_BIDS_STATUS = "3";

export const SESIS_DOWNLOADS = [
  {
    kind: "awarded_cases_school_age",
    age: "school_age",
    report: "awarded_cases",
    page: "home",
    filename: "awarded-cases-school-age.xlsx",
  },
  {
    kind: "awarded_cases_preschool",
    age: "preschool",
    report: "awarded_cases",
    page: "home",
    filename: "awarded-cases-preschool.xlsx",
  },
  {
    kind: "possible_bids_preschool",
    age: "preschool",
    report: "possible_bids",
    page: "submit_bid",
    filename: "possible-bids-preschool.xlsx",
  },
  {
    kind: "possible_bids_school_age",
    age: "school_age",
    report: "possible_bids",
    page: "submit_bid",
    filename: "possible-bids-school-age.xlsx",
  },
] as const;

export type SesisDownloadKind = (typeof SESIS_DOWNLOADS)[number]["kind"];

export const SESIS_DOWNLOAD_FILENAMES: Record<SesisDownloadKind, string> = {
  awarded_cases_school_age: "awarded-cases-school-age.xlsx",
  awarded_cases_preschool: "awarded-cases-preschool.xlsx",
  possible_bids_preschool: "possible-bids-preschool.xlsx",
  possible_bids_school_age: "possible-bids-school-age.xlsx",
};
