/* Bids. Uses the Bids API when config.js sets BIDS_API_URL. No SMS and no SESIS place-bid. */

const COORDINATOR_NAME = "Moshe";

const schools = {
  "31R192": {
    name: "PS 192",
    address: "500 18th Ave, Brooklyn",
    area: "Borough Park",
    building: "Main",
    program: "school-age",
  },
  "31R152": {
    name: "PS 152",
    address: "1800 49th St, Brooklyn",
    area: "Midwood",
    building: "Main",
    program: "school-age",
  },
  "31R205": {
    name: "PS 205",
    address: "6701 20th Ave, Brooklyn",
    area: "Flatbush",
    building: "Annex",
    program: "school-age",
  },
  "31R180": {
    name: "PS 180",
    address: "5601 16th Ave, Brooklyn",
    area: "Midwood",
    building: "Main",
    program: "school-age",
  },
  PRE441: {
    name: "Bnos Square Preschool",
    address: "1234 50th St, Brooklyn",
    area: "Borough Park",
    building: "Building A",
    program: "preschool",
  },
  PRE220: {
    name: "Yaldei Playgroup",
    address: "88 Avenue L, Brooklyn",
    area: "Flatbush",
    building: "Building 1",
    program: "preschool",
  },
  PRE088: {
    name: "Little Steps",
    address: "410 Bedford Ave, Brooklyn",
    area: "Williamsburg",
    building: "Site 2",
    program: "preschool",
  },
};

const people = {
  rivka: {
    id: "rivka",
    name: "Rivka Klein",
    email: "rivka.klein@example.test",
    discipline: "OT",
    activity: "active",
    location: "Borough Park",
    desiredHours: 2,
    programs: ["preschool", "school-age"],
    fullyBooked: false,
    sampleMiles: 1.2,
  },
  chana: {
    id: "chana",
    name: "Chana Weiss",
    email: "chana.weiss@example.test",
    discipline: "OT",
    activity: "active",
    location: "Flatbush",
    desiredHours: 2,
    programs: ["preschool", "school-age"],
    fullyBooked: false,
    sampleMiles: 4,
  },
  miriam: {
    id: "miriam",
    name: "Miriam Adler",
    email: "miriam.adler@example.test",
    discipline: "SLP",
    activity: "active",
    location: "Midwood",
    desiredHours: 2,
    programs: ["school-age"],
    fullyBooked: false,
  },
  yocheved: {
    id: "yocheved",
    name: "Yocheved Stein",
    email: "yocheved.stein@example.test",
    discipline: "OT",
    activity: "active",
    location: "Borough Park",
    desiredHours: 2,
    programs: ["school-age"],
    fullyBooked: false,
  },
  leah: {
    id: "leah",
    name: "Leah Gross",
    email: "leah.gross@example.test",
    discipline: "OT",
    activity: "inactive",
    location: "Midwood",
    desiredHours: 2,
    programs: ["preschool", "school-age"],
    sampleMiles: 0.6,
  },
  sara: {
    id: "sara",
    name: "Sara Friedman",
    email: "sara.friedman@example.test",
    discipline: "SLP",
    activity: "inactive",
    location: "Midwood",
    desiredHours: 2,
    programs: ["school-age"],
    sampleMiles: 2.4,
  },
  dina: {
    id: "dina",
    name: "Dina Goldberg",
    email: "dina.goldberg@example.test",
    discipline: "OT",
    activity: "inactive",
    location: "Borough Park",
    desiredHours: 1,
    programs: ["preschool"],
    sampleMiles: 3.1,
  },
  standin: {
    id: "standin",
    name: "Demo Stand-in",
    discipline: "",
    activity: "stand-in",
    note: "Not a real staff member and not in the portal. No HHAeXchange id. Moshe attaches a bid here after a call, until the real person is known.",
  },
};

let cases = [
  {
    id: "C-2201",
    child: "M. K.",
    schoolCode: "31R192",
    program: "school-age",
    discipline: "OT",
    hoursPerWeek: 2,
    service: "OT, 30 min, 2x week",
    onAwardedReport: true,
  },
  {
    id: "C-8801",
    child: "A. L.",
    schoolCode: "31R192",
    program: "school-age",
    discipline: "OT",
    hoursPerWeek: 2,
    service: "OT, 30 min, 2x week",
    takenBy: "yocheved",
  },
  {
    id: "C-3301",
    child: "R. S.",
    schoolCode: "31R192",
    program: "school-age",
    discipline: "OT",
    hoursPerWeek: 2,
    service: "OT, 30 min, 2x week",
    race: true,
  },
  {
    id: "C-4402",
    child: "T. B.",
    schoolCode: "PRE441",
    program: "preschool",
    discipline: "OT",
    hoursPerWeek: 2,
    service: "OT, 30 min, 2x week",
  },
  {
    id: "C-4408",
    child: "N. F.",
    schoolCode: "PRE441",
    program: "preschool",
    discipline: "OT",
    hoursPerWeek: 1,
    service: "OT, 30 min, 1x week",
  },
  {
    id: "C-1520",
    child: "H. D.",
    schoolCode: "31R152",
    program: "school-age",
    discipline: "OT",
    hoursPerWeek: 2,
    service: "OT, 30 min, 2x week",
  },
  {
    id: "C-2055",
    child: "S. P.",
    schoolCode: "PRE220",
    program: "preschool",
    discipline: "OT",
    hoursPerWeek: 2,
    service: "OT, 30 min, 2x week",
    onAwardedReport: true,
  },
  {
    id: "C-5100",
    child: "E. G.",
    schoolCode: "31R180",
    program: "school-age",
    discipline: "SLP",
    hoursPerWeek: 2,
    service: "SLP, 30 min, 2x week",
    takenBy: "miriam",
    awarded: true,
  },
  {
    id: "C-5108",
    child: "L. W.",
    schoolCode: "31R180",
    program: "school-age",
    discipline: "SLP",
    hoursPerWeek: 2,
    service: "SLP, 30 min, 2x week",
    expiringSample: true,
  },
];

const bids = [
  {
    caseId: "C-8801",
    personId: "yocheved",
    fillsAvailability: false,
    remainingHours: 2,
    enteredBy: "provider",
    note: "Selected in the portal",
  },
  {
    caseId: "C-5100",
    personId: "miriam",
    fillsAvailability: false,
    remainingHours: 2,
    enteredBy: "provider",
    note: "Selected in the portal",
  },
];

const touches = [
  { caseId: "C-1520", personId: "chana", kind: "opened", at: "2 days ago" },
  { caseId: "C-4402", personId: "yocheved", kind: "passed", at: "2 days ago" },
  { caseId: "C-5108", personId: "miriam", kind: "never", at: "on the list for 2 days" },
];

let imports = {
  preschoolAvailable: { file: "Available cases — Preschool.xlsx", at: "Today 7:05 AM", runs: 1 },
  schoolAvailable: { file: "Available cases — School age.xlsx", at: "Today 7:06 AM", runs: 1 },
  preschoolAwarded: { file: "Awarded cases — Preschool.xlsx", at: "Today 7:08 AM", runs: 1 },
  schoolAwarded: { file: "Awarded cases — School age.xlsx", at: "Today 7:09 AM", runs: 1 },
};

let notices = [
  {
    audience: "coordinator",
    text: "Awarded-report match: Miriam Adler was awarded C-5100 at PS 180 (school age, SLP). Proceed with the next steps.",
  },
];

let unfilled = {
  id: "UA-17",
  child: "J. C.",
  schoolCode: "31R205",
  program: "school-age",
  discipline: "OT",
  service: "OT, 30 min, 2x week",
  hoursPerWeek: 2,
  day: 1,
  responder: "",
  screening: [],
  followNote: "",
  decision: null,
};

let unfilledCases = [];
let trackers = [];
let reminders = [];
let districts = [];
let districtNeeds = [];
let districtAwards = [];
let districtClockDays = 0;
let caseGroups = [];
let importMeta = null;
let awardedImportMeta = null;
let openBoeAwards = [];
let districtEscalations = [];
let recruiterQueue = [];
let queuedMessages = [];
let queuedCount = 0;
let smsConfigured = false;
let placeBidLive = false;
let mailFrom = "";
let expiringInterest = [];
let dayPreview = null;
let role = "provider";
let providerId = "rivka";
let view = "cases";
let selectedId = null;
let programFilter = "all";
let flash = "";
let flashKind = "";
let providerQuery = "";
const offerHistory = {};

const $ = (id) => document.getElementById(id);

function person(id) {
  return people[id];
}

function school(code, row) {
  const known = schools[code];
  if (known) return known;
  const source = row || cases.find((item) => item.schoolCode === code) || unfilledCases.find((item) => item.schoolCode === code) || {};
  const address = source.address || "";
  return {
    name: source.schoolName || String(code || "School"),
    building: source.building || "",
    address,
    area: source.area || areaFromAddress(address),
  };
}

function findCase(id) {
  return cases.find((row) => row.id === id) || (unfilled && unfilled.id === id ? unfilled : null);
}

function programLabel(value) {
  return value === "preschool" ? "Preschool" : "School age";
}

function hoursLabel(hours) {
  return `${hours} hr${hours === 1 ? "" : "s"}/week`;
}

function me() {
  return people[providerId];
}

function setFlash(message, kind) {
  flash = message;
  flashKind = kind || "ok";
}

function setStatus(message, kind) {
  const el = $("status");
  if (!el) return;
  el.textContent = message || "";
  el.className = kind || "";
}

function clearFlash() {
  flash = "";
  flashKind = "";
}

function importBanner() {
  const second = imports.preschoolAvailable.runs > 1;
  const where = usingApi() ? "Bids database" : "demo database";
  return `<p class="notice"><span class="demo-flag">Demo import</span><br />
    Preschool available file: ${imports.preschoolAvailable.at} · run ${imports.preschoolAvailable.runs} today.<br />
    School-age available file: ${imports.schoolAvailable.at} · run ${imports.schoolAvailable.runs} today.
    ${second ? "<br />Second import today is loaded. Unchanged rows were not sent out again." : ""}
  </p>
  <p class="muted">Cases below are already organized in the ${where}. The school name, address, and building come from the school code.</p>`;
}

function areaFromAddress(address) {
  const text = String(address || "").toLowerCase();
  const areas = ["Borough Park", "Midwood", "Flatbush", "Williamsburg"];
  return areas.find((area) => text.includes(area.toLowerCase())) || "";
}

function homeArea(therapist) {
  return areaFromAddress(therapist.address) || therapist.location || "";
}

function profileReady(therapist) {
  if (!therapist) return false;
  if (typeof therapist.profileComplete === "boolean") return therapist.profileComplete;
  const languages = Array.isArray(therapist.languages) ? therapist.languages.filter(Boolean) : [];
  const programs = Array.isArray(therapist.programs) ? therapist.programs : [];
  const hours = Number(therapist.desiredHours);
  return String(therapist.address || "").trim().length >= 5
    && languages.length > 0
    && (therapist.gender === "male" || therapist.gender === "female")
    && ["OT", "PT", "SLP"].includes(therapist.discipline)
    && Number.isFinite(hours) && hours >= 1 && hours <= 20
    && programs.some((value) => value === "preschool" || value === "school-age");
}

function genderAllows(therapist, row) {
  const audience = row.audience || "either";
  if (audience === "cheder") return therapist.gender === "male";
  if (audience === "girls") return therapist.gender === "female";
  return true;
}

function languageAllows(therapist, row) {
  const need = String(row.language || "").trim().toLowerCase();
  if (!need) return true;
  return (therapist.languages || []).some((value) => String(value).trim().toLowerCase() === need);
}

function matchOf(row, therapist) {
  const place = school(row.schoolCode, row);
  const home = homeArea(therapist);
  const schoolArea = row.area || place.area || "";
  const farther = Boolean(home && schoolArea && home !== schoolArea);
  const short = Number(row.hoursPerWeek) < Number(therapist.desiredHours);
  const address = String(therapist.address || "").trim();
  if (!farther && !short) return { kind: "exact", home, address, schoolArea };
  return { kind: "partial", farther, short, home, address, schoolArea };
}

function hoursLeft(therapist) {
  const awarded = bids.filter((bid) => {
    if (bid.personId !== therapist.id || bid.remainingHours == null) return false;
    const row = findCase(bid.caseId);
    return row && row.awarded && row.takenBy === therapist.id;
  });
  if (!awarded.length) return null;
  return Math.min(...awarded.map((bid) => bid.remainingHours));
}

function fitsHoursLeft(row, therapist) {
  const left = hoursLeft(therapist);
  if (left == null) return true;
  return row.hoursPerWeek <= left;
}

function visibleCases(therapist) {
  if (!profileReady(therapist)) return [];
  const programs = therapist.programs || [];
  return cases.filter(
    (row) =>
      row.discipline === therapist.discipline &&
      programs.includes(row.program) &&
      genderAllows(therapist, row) &&
      languageAllows(therapist, row) &&
      districtVisible(therapist, row) &&
      (programFilter === "all" || row.program === programFilter) &&
      fitsHoursLeft(row, therapist) &&
      !(row.awarded && row.takenBy === therapist.id),
  );
}

function groupByBuilding(rows) {
  const map = new Map();
  for (const row of rows) {
    const place = school(row.schoolCode, row);
    const key = `${row.schoolCode}|${place.building || place.address || row.adminDbn || ""}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return [...map.values()];
}

function caseStatus(row) {
  if (row.awarded) return pill("ok", `Awarded · ${person(row.takenBy).name}`);
  if (row.takenBy) return pill("warn", `Selected · ${person(row.takenBy).name}`);
  if (row.race) return pill("info", "Open · another therapist is selecting now");
  return pill("ok", "Open");
}

function pill(kind, label) {
  return `<span class="pill pill-${kind}">${label}</span>`;
}

function districtVisible(therapist, row) {
  if (row.source !== "district email") return true;
  if (therapist.activity === "inactive" && !row.inactivePreviewAt) return false;
  if (therapist.activity !== "active" && therapist.activity !== "inactive") return false;
  const hours = Number(therapist.desiredHours);
  if (Number(row.hoursPerWeek) > hours) return false;
  const area = String(row.area || "").trim();
  if (area && homeArea(therapist) !== area) return false;
  return true;
}

function holdMessage(row) {
  if (row.awarded) {
    if (row.source === "district email") return `${person(row.takenBy).name} is awarded this district need.`;
    return `${person(row.takenBy).name} was awarded this case from the awarded-case report. Another bid cannot be saved.`;
  }
  if (row.takenBy) {
    return `${person(row.takenBy).name} already selected this case. Two therapists cannot select the same child. Your bid will not be saved.`;
  }
  return "";
}

function providerNav() {
  if (!profileReady(me())) return [["preferences", "Your profile"]];
  return [
    ["cases", "Cases"],
    ["bids", "My bids"],
    ["preferences", "Profile"],
  ];
}

function coordinatorNav() {
  return [
    ["home", "Home"],
    ["providers", "Providers"],
    ["cases", "Cases"],
    ["tracker", "Awarded tracker"],
    ["districts", "Districts"],
    ["unfilled", "Unfilled awards"],
    ["followup", "Two-day follow-up"],
    ["expiring", "Expiring bids"],
  ];
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function signInProviders() {
  return Object.values(people).filter((who) => who.id !== "standin" && who.activity !== "stand-in");
}

function pendingFullBid(personId) {
  return bids.find((bid) => bid.personId === personId && bid.enteredBy === "provider" && bid.remainingHours == null);
}

function lockInfo(therapist) {
  if (!therapist) return null;
  for (const bid of bids) {
    if (bid.personId !== therapist.id || bid.remainingHours !== 0) continue;
    const row = findCase(bid.caseId);
    if (row && row.awarded && row.takenBy === therapist.id) {
      return { caseId: row.id, child: row.child, school: school(row.schoolCode).name };
    }
  }
  return null;
}

const STORAGE_KEY = "wg-sesis-demo-v1";

function usingApi() {
  return typeof window.BIDS_API_URL === "string" && /^https:\/\//.test(window.BIDS_API_URL);
}

const auth = { idToken: "", accessToken: "", email: "", role: "", name: "" };

function cognitoMode() {
  return usingApi() && typeof window.BIDS_USER_POOL_ID === "string" && window.BIDS_USER_POOL_ID.includes("_") && typeof window.BIDS_CLIENT_ID === "string" && window.BIDS_CLIENT_ID.length > 8;
}

function cognitoRegion() {
  return String(window.BIDS_USER_POOL_ID || "").split("_")[0] || "us-east-1";
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

function tokenStillGood(token) {
  const payload = token ? decodeJwtPayload(token) : null;
  return Boolean(payload && payload.exp && payload.exp * 1000 > Date.now() + 30000);
}

function cognitoType(data) {
  return String(data?.__type || "").split("#").pop();
}

function loginErrorMessage(data) {
  const type = cognitoType(data);
  const plain = {
    NotAuthorizedException: "Incorrect email or password.",
    UserNotFoundException: "No account exists for that email. Contact the office for an invitation.",
    UserNotConfirmedException: "This account is not confirmed yet. Contact the office for assistance.",
    PasswordResetRequiredException: "Your password must be reset. Use Forgot password below, or contact the office for assistance.",
    InvalidPasswordException: "That password does not meet requirements. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.",
    InvalidParameterException: "Verify the email address and try again.",
    TooManyRequestsException: "Too many attempts. Wait a minute and try again.",
    LimitExceededException: "Too many attempts. Wait a minute and try again.",
    CodeMismatchException: "Invalid confirmation code. Please try again.",
    ExpiredCodeException: "That code has expired. Request a new code with Forgot password.",
  };
  if (plain[type]) return plain[type];
  if (data?.message) return String(data.message);
  return "Sign-in was unsuccessful. Please try again.";
}

async function cognitoCall(target, body) {
  const url = `https://cognito-idp.${cognitoRegion()}.amazonaws.com/`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Unable to reach Cognito. If you use NetFree, allowlist cognito-idp.us-east-1.amazonaws.com, then try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(loginErrorMessage(data));
  return data;
}

function applyToken(idToken, accessToken) {
  const payload = decodeJwtPayload(idToken) || {};
  const groups = Array.isArray(payload["cognito:groups"]) ? payload["cognito:groups"] : [];
  auth.idToken = idToken;
  auth.accessToken = accessToken || "";
  auth.email = String(payload.email || payload["cognito:username"] || "").toLowerCase();
  auth.name = String(payload.name || auth.email);
  auth.role = groups.includes("Admin") || groups.includes("admin") ? "admin" : "therapist";
  localStorage.setItem("bidsIdToken", idToken);
  if (accessToken) localStorage.setItem("bidsAccessToken", accessToken);
  else localStorage.removeItem("bidsAccessToken");
}

function bindSession(me) {
  if (!me) return;
  auth.role = me.role === "admin" ? "admin" : "therapist";
  auth.email = me.email || auth.email;
  auth.name = me.name || auth.name;
  role = auth.role === "admin" ? "coordinator" : "provider";
  if (auth.role === "therapist" && me.id && people[me.id]) providerId = me.id;
}

async function apiSend(method, path, body) {
  const base = window.BIDS_API_URL.replace(/\/$/, "");
  const headers = { accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  if (auth.idToken) headers.authorization = `Bearer ${auth.idToken}`;
  try {
    const res = await fetch(base + path, {
      method,
      cache: "no-store",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    data.ok = res.ok && data.ok !== false;
    data.status = res.status;
    if (res.status === 401 && path !== "/state") signOut("Your session has ended. Please sign in again.");
    return data;
  } catch {
    return { ok: false, error: "The Bids database could not be reached." };
  }
}

function loginError(msg) {
  const box = document.getElementById("loginErr");
  if (!box) return;
  box.textContent = msg || "";
  box.hidden = !msg;
}

function hideAppChrome() {
  document.body.classList.add("is-auth");
  $("nav").innerHTML = "";
  $("whoami").textContent = "";
  $("providerPick").hidden = true;
  $("rolePick").hidden = true;
  $("signOut").hidden = true;
}

function showAppChrome() {
  document.body.classList.remove("is-auth");
  $("signOut").hidden = false;
  $("providerPick").hidden = true;
  $("rolePick").hidden = true;
}

function signOut(message) {
  auth.idToken = "";
  auth.accessToken = "";
  auth.email = "";
  auth.role = "";
  auth.name = "";
  localStorage.removeItem("bidsIdToken");
  localStorage.removeItem("bidsAccessToken");
  showLogin(message || "");
}

function showLogin(message) {
  hideAppChrome();
  setStatus("", "");
  $("view").innerHTML = `
    <div class="card login-card">
      <h2>Sign in</h2>
      <p>Use the email and temporary password from your White Glove invitation.</p>
      <div id="loginErr" class="err-box" ${message ? "" : "hidden"}>${esc(message || "")}</div>
      <label>Email <input id="loginEmail" type="email" autocomplete="username" placeholder="you@example.com" /></label>
      <label>Password <input id="loginPassword" type="password" autocomplete="current-password" /></label>
      <button class="btn-primary big" id="loginBtn" type="button">Sign in</button>
      <p class="login-footer-link"><button type="button" class="linkish" id="forgotPasswordBtn">Forgot password?</button></p>
    </div>`;
  const submit = async () => {
    const btn = $("loginBtn");
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    loginError("");
    if (!email || !password) {
      loginError("Enter your email and password.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      const out = await cognitoCall("InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: window.BIDS_CLIENT_ID,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
      await handleAuthResponse(out, email);
    } catch (err) {
      loginError(err.message);
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  };
  $("loginBtn").onclick = submit;
  $("loginPassword").onkeydown = (event) => {
    if (event.key === "Enter") submit();
  };
  $("forgotPasswordBtn").onclick = () => showForgotPassword($("loginEmail").value.trim());
  $("loginEmail").focus();
}

async function completeAuthSuccess(authResult) {
  const idToken = authResult?.IdToken;
  if (!idToken) throw new Error("Sign-in was unsuccessful. Please try again.");
  applyToken(idToken, authResult.AccessToken || "");
  await enterApp();
}

async function handleAuthResponse(out, email) {
  const challenge = out?.ChallengeName;
  if (!challenge) {
    await completeAuthSuccess(out.AuthenticationResult || {});
    return;
  }
  if (challenge === "NEW_PASSWORD_REQUIRED") {
    showNewPassword(email, out.Session);
    return;
  }
  if (challenge === "SOFTWARE_TOKEN_MFA" || challenge === "SMS_MFA" || challenge === "EMAIL_OTP") {
    showMfaChallenge(email, out.Session, challenge);
    return;
  }
  throw new Error(`Unsupported sign-in step (${challenge}). Contact the office for assistance.`);
}

function showNewPassword(email, session) {
  hideAppChrome();
  $("view").innerHTML = `
    <div class="card login-card">
      <h2>Choose a new password</h2>
      <p>First sign-in: choose your own password. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>New password <input id="newPassword" type="password" autocomplete="new-password" /></label>
      <label>Confirm password <input id="newPassword2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="newPassBtn" type="button">Save password and sign in</button>
    </div>`;
  const submit = async () => {
    const btn = $("newPassBtn");
    const p1 = $("newPassword").value;
    const p2 = $("newPassword2").value;
    loginError("");
    if (!p1) {
      loginError("Enter a new password.");
      return;
    }
    if (p1 !== p2) {
      loginError("The passwords do not match.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const out = await cognitoCall("RespondToAuthChallenge", {
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        ClientId: window.BIDS_CLIENT_ID,
        Session: session,
        ChallengeResponses: { USERNAME: email, NEW_PASSWORD: p1 },
      });
      await handleAuthResponse(out, email);
    } catch (err) {
      loginError(err.message);
      btn.disabled = false;
      btn.textContent = "Save password and sign in";
    }
  };
  $("newPassBtn").onclick = submit;
}

function showMfaChallenge(email, session, challengeName) {
  hideAppChrome();
  const emailOtp = challengeName === "EMAIL_OTP";
  const blurb = emailOtp ? "Enter the code emailed to you." : "Enter the code from your authenticator app.";
  $("view").innerHTML = `
    <div class="card login-card">
      <h2>Verification code</h2>
      <p>${blurb}</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>Code <input id="mfaCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" /></label>
      <button class="btn-primary big" id="mfaBtn" type="button">Verify</button>
    </div>`;
  $("mfaBtn").onclick = async () => {
    const code = $("mfaCode").value.trim().replace(/\s+/g, "");
    loginError("");
    if (!code) {
      loginError("Enter the code.");
      return;
    }
    const responses = { USERNAME: email };
    if (challengeName === "SMS_MFA") responses.SMS_MFA_CODE = code;
    else if (emailOtp) responses.EMAIL_OTP_CODE = code;
    else responses.SOFTWARE_TOKEN_MFA_CODE = code;
    try {
      const out = await cognitoCall("RespondToAuthChallenge", {
        ChallengeName: challengeName,
        ClientId: window.BIDS_CLIENT_ID,
        Session: session,
        ChallengeResponses: responses,
      });
      await handleAuthResponse(out, email);
    } catch (err) {
      loginError(err.message);
    }
  };
}

function showForgotPassword(prefillEmail) {
  hideAppChrome();
  $("view").innerHTML = `
    <div class="card login-card">
      <h2>Forgot password</h2>
      <p>We will email a confirmation code. Then choose a new password.</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>Email <input id="forgotEmail" type="email" autocomplete="username" value="${esc(prefillEmail || "")}" /></label>
      <button class="btn-primary big" id="forgotSendBtn" type="button">Send reset code</button>
      <p><button type="button" class="btn" id="forgotBackBtn">Back to sign in</button></p>
    </div>`;
  $("forgotBackBtn").onclick = () => showLogin("");
  $("forgotSendBtn").onclick = async () => {
    const btn = $("forgotSendBtn");
    const email = $("forgotEmail").value.trim();
    loginError("");
    if (!email) {
      loginError("Enter your email address.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await cognitoCall("ForgotPassword", { ClientId: window.BIDS_CLIENT_ID, Username: email });
      showConfirmForgotPassword(email);
    } catch (err) {
      loginError(err.message);
      btn.disabled = false;
      btn.textContent = "Send reset code";
    }
  };
}

function showConfirmForgotPassword(email) {
  hideAppChrome();
  $("view").innerHTML = `
    <div class="card login-card">
      <h2>Enter confirmation code</h2>
      <p>Check <strong>${esc(email)}</strong> for a confirmation code, then choose a new password (at least 8 characters with an uppercase letter, a lowercase letter, and a number).</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>Confirmation code <input id="forgotCode" type="text" autocomplete="one-time-code" inputmode="numeric" /></label>
      <label>New password <input id="forgotNew" type="password" autocomplete="new-password" /></label>
      <label>Confirm new password <input id="forgotNew2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="forgotConfirmBtn" type="button">Save new password</button>
      <p><button type="button" class="linkish" id="forgotResendBtn">Resend code</button></p>
      <p><button type="button" class="btn" id="forgotBackBtn">Back to sign in</button></p>
    </div>`;
  $("forgotBackBtn").onclick = () => showLogin("");
  $("forgotResendBtn").onclick = () => showForgotPassword(email);
  $("forgotConfirmBtn").onclick = async () => {
    const btn = $("forgotConfirmBtn");
    const code = $("forgotCode").value.trim();
    const p1 = $("forgotNew").value;
    const p2 = $("forgotNew2").value;
    loginError("");
    if (!code || !p1 || !p2) {
      loginError("Enter the confirmation code and both password fields.");
      return;
    }
    if (p1 !== p2) {
      loginError("The passwords do not match.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await cognitoCall("ConfirmForgotPassword", {
        ClientId: window.BIDS_CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
        Password: p1,
      });
      setStatus("Password updated. Sign in with your new password.", "ok");
      showLogin("");
    } catch (err) {
      loginError(err.message);
      btn.disabled = false;
      btn.textContent = "Save new password";
    }
  };
}

async function enterApp() {
  showAppChrome();
  $("status").textContent = "Loading Bids…";
  const res = await apiSend("GET", "/state");
  if (res.status === 401) {
    signOut("Your session has ended. Please sign in again.");
    return;
  }
  if (res.people) applyServer(res);
  if (res.me) bindSession(res.me);
  else role = auth.role === "admin" ? "coordinator" : "provider";
  if (!res.ok) setFlash(res.error || "Could not load the Bids database.", "warn");
  else setStatus("", "");
  restoreChrome();
  const providerViews = ["cases", "bids", "preferences", "detail"];
  const adminViews = ["home", "providers", "provider", "cases", "tracker", "districts", "unfilled", "followup", "expiring", "detail"];
  if (role === "provider" && !profileReady(me())) view = "preferences";
  else if (role === "provider" && !providerViews.includes(view)) view = "cases";
  if (role === "coordinator" && !adminViews.includes(view)) view = "home";
  render();
}

function applyServer(data) {
  if (!data || !data.people) return;
  for (const key of Object.keys(people)) delete people[key];
  Object.assign(people, data.people);
  if (Array.isArray(data.cases)) cases.splice(0, cases.length, ...data.cases);
  if (Array.isArray(data.bids)) {
    bids.splice(0, bids.length, ...data.bids);
    for (const bid of bids) {
      if (bid.remainingHours == null && typeof bid.fillsAvailability === "boolean") {
        bid.remainingHours = bid.fillsAvailability ? 0 : 1;
      }
    }
  }
  if (data.unfilled) unfilled = data.unfilled;
  if (Array.isArray(data.unfilledCases)) unfilledCases = data.unfilledCases;
  if (Array.isArray(data.notices)) notices.splice(0, notices.length, ...data.notices);
  if (data.preview) dayPreview = data.preview;
  if (Array.isArray(data.trackers)) trackers = data.trackers;
  if (Array.isArray(data.reminders)) reminders = data.reminders;
  if (Array.isArray(data.districts)) districts = data.districts;
  if (Array.isArray(data.districtNeeds)) districtNeeds = data.districtNeeds;
  if (Array.isArray(data.districtAwards)) districtAwards = data.districtAwards;
  if (data.districtClockDays != null) districtClockDays = Number(data.districtClockDays) || 0;
  if (Array.isArray(data.groups)) caseGroups = data.groups;
  importMeta = data.importMeta || null;
  awardedImportMeta = data.awardedImportMeta || null;
  openBoeAwards = Array.isArray(data.openBoeAwards) ? data.openBoeAwards : [];
  districtEscalations = Array.isArray(data.districtEscalations) ? data.districtEscalations : [];
  recruiterQueue = Array.isArray(data.recruiterQueue) ? data.recruiterQueue : [];
  queuedMessages = Array.isArray(data.queuedMessages) ? data.queuedMessages : [];
  queuedCount = data.queuedCount != null ? Number(data.queuedCount) || 0 : queuedMessages.length;
  smsConfigured = Boolean(data.smsConfigured);
  placeBidLive = Boolean(data.placeBidLive);
  mailFrom = data.mailFrom || "";
}

function restoreChrome() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!data) return;
  if (!cognitoMode()) {
    if (data.role === "provider" || data.role === "coordinator") role = data.role;
    if (data.providerId && people[data.providerId]) providerId = data.providerId;
  } else if (auth.role === "therapist" && data.providerId && people[data.providerId] && people[data.providerId].email === auth.email) {
    providerId = data.providerId;
  }
    if (data.view) view = data.view;
    if (data.selectedId) selectedId = data.selectedId;
    if (data.programFilter) programFilter = data.programFilter;
    if (data.imports) imports = data.imports;
    if (Array.isArray(data.touches)) touches.splice(0, touches.length, ...data.touches);
    if (Array.isArray(data.expiringInterest)) expiringInterest.splice(0, expiringInterest.length, ...data.expiringInterest);
  } catch {
    /* keep the server data */
  }
}

async function pushUnfilled() {
  if (!usingApi()) return true;
  const res = await apiSend("PUT", "/unfilled", {
    id: unfilled.id,
    day: unfilled.day,
    screening: unfilled.screening.slice(),
    followNote: unfilled.followNote || "",
    decision: unfilled.decision,
  });
  if (res.people) applyServer(res);
  if (!res.ok) {
    setFlash(res.error || "Follow-up was not saved.", "warn");
    return false;
  }
  return true;
}

function persist() {
  const chrome = {
    role,
    providerId,
    view,
    selectedId,
    programFilter,
    imports,
    touches,
    expiringInterest,
  };
  if (usingApi()) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ api: true, ...chrome }));
    return;
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      people,
      cases,
      bids,
      notices,
      unfilled,
      ...chrome,
    }),
  );
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !data.people || !Array.isArray(data.cases) || !Array.isArray(data.bids)) return;
    for (const key of Object.keys(people)) delete people[key];
    Object.assign(people, data.people);
    cases.splice(0, cases.length, ...data.cases);
    bids.splice(0, bids.length, ...data.bids);
    touches.splice(0, touches.length, ...(data.touches || []));
    if (data.imports) imports = data.imports;
    if (Array.isArray(data.notices)) notices.splice(0, notices.length, ...data.notices);
    if (data.unfilled) unfilled = data.unfilled;
    if (Array.isArray(data.expiringInterest)) expiringInterest.splice(0, expiringInterest.length, ...data.expiringInterest);
    if (data.role === "provider" || data.role === "coordinator") role = data.role;
    for (const bid of bids) {
      if (bid.remainingHours == null && typeof bid.fillsAvailability === "boolean") {
        bid.remainingHours = bid.fillsAvailability ? 0 : 1;
      }
    }
    if (data.providerId && people[data.providerId]) providerId = data.providerId;
    if (data.view) view = data.view;
    if (data.selectedId) selectedId = data.selectedId;
    if (data.programFilter) programFilter = data.programFilter;
  } catch {
    /* keep the seed data */
  }
}

function renderNav() {
  const items = role === "provider" ? providerNav() : coordinatorNav();
  $("nav").innerHTML = items
    .map(
      ([id, label]) =>
        `<button type="button" class="nav${view === id ? " on" : ""}" data-view="${id}">${label}</button>`,
    )
    .join("");
  const pick = $("provider");
  const signedIn = cognitoMode();
  pick.hidden = signedIn || role !== "provider";
  $("providerPick").hidden = signedIn || role !== "provider";
  $("rolePick").hidden = signedIn;
  $("signOut").hidden = !signedIn;
  if (role === "provider") {
    const options = signInProviders();
    if (!signedIn && (!people[providerId] || providerId === "standin")) providerId = options[0]?.id || "rivka";
    if (signedIn && auth.email) {
      const mine = Object.values(people).find((who) => (who.email || "").toLowerCase() === auth.email);
      if (mine) providerId = mine.id;
    }
    pick.innerHTML = options
      .map((who) => `<option value="${esc(who.id)}">${esc(who.name)}</option>`)
      .join("");
    if (people[providerId]) pick.value = providerId;
    const therapist = me();
    const booked = lockInfo(therapist) ? " · fully booked" : "";
    const profile = profileReady(therapist) ? "" : " · profile needed";
    $("whoami").textContent = `${therapist.name} · ${therapist.discipline || "no discipline yet"}${profile}${booked}`;
  } else {
    $("whoami").textContent = signedIn ? `${auth.name || auth.email || "Admin"} · Admin` : `${COORDINATOR_NAME} · Coordinator`;
  }
}

function go(next, caseId) {
  view = next;
  selectedId = caseId || null;
  render();
}

function caseTable(rows) {
  const body = rows
    .map((row) => {
      const place = school(row.schoolCode);
      return `<tr>
        <td><strong>${row.id}</strong><br /><span class="muted">${row.source === "district email" ? "District email" : `Child ${row.child}`}</span></td>
        <td>${programLabel(row.program)}<br /><span class="muted">${hoursLabel(row.hoursPerWeek)}</span></td>
        <td>${row.service}</td>
        <td>${caseStatus(row)}<br /><span class="muted">${place.area}</span></td>
        <td><button type="button" class="btn" data-open="${row.id}">Open</button></td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table>
    <thead><tr><th>Case</th><th>Program</th><th>Service</th><th>Status</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function schoolBlocks(rows) {
  if (!rows.length) return `<p class="muted">No cases in this group.</p>`;
  return groupByBuilding(rows)
    .map((group) => {
      const place = school(group[0].schoolCode, group[0]);
      return `<div class="school-block">
        <h3>${esc(place.name)} · ${esc(place.building || group[0].buildingCode || "")}</h3>
        <p class="muted">${esc(group[0].source || "case")} · ${esc(group[0].schoolCode)} → ${esc(place.address || "address blank")}</p>
        ${caseTable(group)}
      </div>`;
    })
    .join("");
}

function reasonLabel(info) {
  const parts = [];
  if (info.farther) {
    const saved = info.address ? `saved address ${info.address}` : "no street address yet";
    const asked = info.home ? `she is in ${info.home}` : "her area is not set";
    parts.push(`farther than she asked — ${saved}; ${asked}; this school is in ${info.schoolArea}`);
  }
  if (info.short) parts.push("fewer hours than she wants");
  return parts.join("; ");
}

function filterButtons() {
  const options = [
    ["all", "Preschool and school age"],
    ["preschool", "Preschool"],
    ["school-age", "School age"],
  ];
  return `<div class="filters">${options
    .map(
      ([id, label]) =>
        `<button type="button" class="nav${programFilter === id ? " on" : ""}" data-program="${id}">${label}</button>`,
    )
    .join("")}</div>`;
}

function providerCases() {
  const therapist = me();
  const locked = lockInfo(therapist);
  if (locked) {
    return `<article class="card">
      <h2>Other opportunities are hidden</h2>
      <p>You were awarded ${locked.caseId} for child ${locked.child} at ${locked.school}, and your hours left went to zero. Other cases stay hidden.</p>
      <p class="muted">${COORDINATOR_NAME} can still see the full database and the reason you are locked.</p>
    </article>`;
  }
  if (!String(therapist.address || "").trim()) {
    return `<article class="card">
      <h2>Add your street address</h2>
      <p>Cases are matched from the address on your preferences. Exact matches are the same area as that address. Partial matches are farther than you asked, or fewer hours.</p>
      <p><button type="button" class="btn-primary" data-view="preferences">Open preferences</button></p>
    </article>`;
  }
  const rows = visibleCases(therapist);
  const exact = rows.filter((row) => matchOf(row, therapist).kind === "exact");
  const partial = rows.filter((row) => matchOf(row, therapist).kind === "partial");
  const partialBlocks = groupByBuilding(partial)
    .map((group) => {
      const place = school(group[0].schoolCode);
      const labeled = group
        .map((row) => {
          const info = matchOf(row, therapist);
          return { row, why: reasonLabel(info) };
        });
      return `<div class="school-block">
        <h3>${place.name} · ${place.building}</h3>
        <p class="muted">School code ${group[0].schoolCode} → ${place.address}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Case</th><th>Program</th><th>Why this is partial</th><th>Status</th><th></th></tr></thead>
          <tbody>${labeled
            .map(
              ({ row, why }) => `<tr>
                <td><strong>${row.id}</strong><br /><span class="muted">${row.source === "district email" ? "District email" : `Child ${row.child}`}</span></td>
                <td>${programLabel(row.program)}<br /><span class="muted">${hoursLabel(row.hoursPerWeek)}</span></td>
                <td>${why}</td>
                <td>${caseStatus(row)}</td>
                <td><button type="button" class="btn" data-open="${row.id}">Open</button></td>
              </tr>`,
            )
            .join("")}</tbody>
        </table></div>
      </div>`;
    })
    .join("");
  const left = hoursLeft(therapist);
  const leftLine =
    left == null
      ? `Desired hours stay at ${therapist.desiredHours} per week.`
      : `Hours left after the award: ${left}. Desired hours stay at ${therapist.desiredHours} per week. A case with more hours than she has left is hidden.`;
  return `<article class="card">
    <h2>Available cases</h2>
    ${importBanner()}
    <p>Signed in as <strong>${esc(therapist.name)}</strong>. Address ${esc(therapist.address)}. Distance uses the area named in that address against the school street address. ${leftLine} Exact matches are listed first. Incomplete profiles never see cases.</p>
    ${filterButtons()}
    <p class="group-label">Exact matches</p>
    <p class="muted">Same area as the street address she saved, and the case has at least the hours asked for.</p>
    ${schoolBlocks(exact)}
    <p class="group-label">Partial matches</p>
    <p class="muted">Farther than she asked, or fewer hours than she wants.</p>
    ${partialBlocks || `<p class="muted">No partial matches in this program filter.</p>`}
  </article>`;
}

function providerDetail(row) {
  const held = holdMessage(row);
  const own = bids.find((bid) => bid.caseId === row.id && bid.personId === providerId);
  const place = school(row.schoolCode);
  let action = "";
  if (lockInfo(me()) && !own) {
    action = `<p class="notice notice-warn">You are fully booked, so this case is closed for a new bid.</p>`;
  } else if (held && !(own && row.takenBy === providerId)) {
    action = `<p class="notice notice-warn"><strong>Already taken.</strong> ${held}</p>`;
  } else if (row.source === "district email" && !row.awarded) {
    action = `<form id="districtInterestForm">
      <p>This is a private-district need. Marking interest puts you on the recruiter queue for a follow-up call. It does not lock the need.</p>
      <div class="actions"><button class="btn-primary" type="submit">I'm interested</button></div>
    </form>`;
  } else if (own && own.fillsAvailability == null) {
    action = fullQuestion(own);
  } else if (own) {
    action = `<p class="notice notice-ok"><strong>Your selection is saved</strong> for child ${row.child}. ${own.remainingHours === 0 ? "Hours left: 0. Other cases stay visible until this bid is awarded." : `Hours left: ${own.remainingHours}. Desired hours stay at ${me().desiredHours}.`}</p>`;
  } else if (row.race) {
    action = `<p class="notice">Another therapist is selecting this child at the same time. If they commit first, your bid is refused.</p>
      ${bidForm(row)}`;
  } else {
    action = bidForm(row);
  }
  return `<article class="card">
    <h2>${row.id} · child ${row.child}</h2>
    <p><button type="button" class="btn" data-view="cases">Back to cases</button></p>
    <div class="summary">
      <div class="summary-card"><span class="summary-label">School code</span><span class="summary-value" style="font-size:1.05rem">${row.schoolCode}</span></div>
      <div class="summary-card"><span class="summary-label">School</span><span class="summary-value" style="font-size:1.05rem">${place.name}</span></div>
      <div class="summary-card"><span class="summary-label">Building</span><span class="summary-value" style="font-size:1.05rem">${place.building}</span></div>
    </div>
    <p>${place.address} · ${place.area} · ${programLabel(row.program)} · ${row.service}</p>
    <p class="muted">This bid is for this child only. A second therapist cannot take the same child.</p>
    ${action}
  </article>`;
}

function bidForm() {
  return `<form id="bidForm">
    <label>Note
      <input name="note" maxlength="160" placeholder="I can start next week" />
    </label>
    <div class="actions"><button class="btn-primary" type="submit">Select this case</button></div>
  </form>`;
}

function fullQuestion(bid) {
  const row = findCase(bid.caseId);
  return `<form id="fullForm" class="notice">
    <p><strong>Would this award make you full?</strong></p>
    <p>Your bid on ${esc(row.id)} for child ${esc(row.child)} is saved. Answer before you continue. Desired hours stay at ${esc(me().desiredHours)} per week.</p>
    <label><input type="radio" name="fills" value="yes" required /> Yes. This award would make me full. Hours left become 0.</label>
    <label><input type="radio" name="fills" value="no" /> No. I still have hours left.</label>
    <label>If you still have hours, how many are left
      <input name="hoursLeft" type="number" min="1" max="40" placeholder="Hours still left" />
    </label>
    <div class="actions"><button class="btn-primary" type="submit">Save answer</button></div>
  </form>`;
}

function providerBids() {
  const mine = bids.filter((bid) => bid.personId === providerId);
  const body = mine
    .map((bid) => {
      const row = findCase(bid.caseId);
      const state = row.awarded ? pill("ok", "Awarded — you and Moshe were notified") : pill("info", "Selected, waiting on the awarded report");
      return `<tr>
        <td>${row.id}<br /><span class="muted">Child ${row.child} · ${school(row.schoolCode).name}</span></td>
        <td>${programLabel(row.program)}</td>
        <td>${bid.remainingHours == null ? "Answer needed" : `${bid.remainingHours} hrs left`}</td>
        <td>${state}</td>
      </tr>`;
    })
    .join("");
  return `<article class="card">
    <h2>My bids</h2>
    ${
      mine.length
        ? `<div class="table-wrap"><table><thead><tr><th>Case</th><th>Program</th><th>Availability</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div>`
        : `<p>You have not selected a case yet.</p>`
    }
  </article>`;
}

function providerPreferences() {
  const therapist = me();
  const areas = ["Borough Park", "Midwood", "Flatbush", "Williamsburg"];
  const languages = ["Yiddish", "English", "Hebrew", "Spanish", "Russian"];
  const hers = therapist.languages || [];
  const programs = therapist.programs || [];
  const extra = hers.find((value) => !languages.includes(value)) || "";
  const ready = profileReady(therapist);
  return `<article class="card">
    <h2>${ready ? "Your profile" : "Finish your profile"}</h2>
    <p>${esc(therapist.name)} fills this in herself. Cases stay hidden, and nothing is offered, until the street address, languages, gender, discipline, desired hours, and preschool and/or school age are all saved.</p>
    <form id="prefForm">
      <label>Street address
        <input name="address" required maxlength="160" value="${esc(therapist.address || "")}" placeholder="1234 50th St, Borough Park, Brooklyn" />
      </label>
      <p class="muted">Distance uses the area named in the address: Borough Park, Midwood, Flatbush, or Williamsburg.</p>
      <label>Location if the address does not name one
        <select name="location"><option value="">Choose if needed</option>${areas.map((area) => `<option${area === therapist.location ? " selected" : ""}>${area}</option>`).join("")}</select>
      </label>
      <p class="muted">Languages she speaks. Choose more than one when that is true.</p>
      <div class="checks">
        ${languages.map((language) => `<label><input type="checkbox" name="language" value="${language}" ${hers.includes(language) ? "checked" : ""} /> ${language}</label>`).join("")}
      </div>
      <label>Another language
        <input name="languageExtra" maxlength="40" value="${esc(extra)}" placeholder="Optional" />
      </label>
      <p class="muted">Gender is used for a cheder or a girls' school.</p>
      <div class="checks">
        <label><input type="radio" name="gender" value="female" ${therapist.gender === "female" ? "checked" : ""} required /> Female</label>
        <label><input type="radio" name="gender" value="male" ${therapist.gender === "male" ? "checked" : ""} /> Male</label>
      </div>
      <div class="row">
        <label>Discipline
          <select name="discipline" required>
            <option value="" ${therapist.discipline ? "" : "selected"}>Choose OT, PT, or SLP</option>
            ${["OT", "PT", "SLP"].map((value) => `<option${value === therapist.discipline ? " selected" : ""}>${value}</option>`).join("")}
          </select>
        </label>
        <label>Desired hours per week
          <input name="desiredHours" type="number" min="1" max="20" value="${therapist.desiredHours ?? ""}" required />
        </label>
      </div>
      <p class="muted">Preschool and/or school age</p>
      <div class="checks">
        <label><input type="checkbox" name="program" value="preschool" ${programs.includes("preschool") ? "checked" : ""} /> Preschool</label>
        <label><input type="checkbox" name="program" value="school-age" ${programs.includes("school-age") ? "checked" : ""} /> School age</label>
      </div>
      <label>Availability for the schedule builder
        <textarea name="availability" rows="2" maxlength="500" placeholder="Mon-Fri 8:00-15:00">${esc(therapist.availability || "")}</textarea>
      </label>
      <p class="muted">Availability is optional. It is not required before cases are shown.</p>
      <div class="actions"><button class="btn-primary" type="submit">Save profile</button></div>
    </form>
  </article>`;
}

function noticeList(audience) {
  const mine = notices.filter((item) => item.audience === audience || (audience === "provider" && item.audience === providerId));
  if (!mine.length) return "";
  return mine.map((item) => `<p class="notice notice-ok">${item.text}</p>`).join("");
}

function importCards() {
  const rows = [
    ["Preschool available", imports.preschoolAvailable],
    ["School-age available", imports.schoolAvailable],
    ["Preschool awarded", imports.preschoolAwarded],
    ["School-age awarded", imports.schoolAwarded],
  ];
  return `<div class="summary">${rows
    .map(
      ([label, file]) => `<div class="summary-card">
        <span class="summary-label">${label}</span>
        <span class="summary-value" style="font-size:0.95rem">${file.at}</span>
        <span class="muted">${file.file}<br />${file.runs} run${file.runs === 1 ? "" : "s"} today</span>
      </div>`,
    )
    .join("")}</div>`;
}

function offerWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso || "");
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function channelLabel(channel) {
  if (channel === "sms") return "Text preview";
  if (channel === "email") return "Email";
  return "Portal";
}

function adminProviders() {
  const needle = providerQuery.trim().toLowerCase();
  const rows = signInProviders()
    .filter((who) => {
      if (!needle) return true;
      return `${who.name} ${who.email || ""} ${who.discipline} ${who.activity}`.toLowerCase().includes(needle);
    })
    .map((who) => {
      const locked = lockInfo(who);
      const waiting = pendingFullBid(who.id);
      const status = locked
        ? pill("err", `Locked · ${locked.caseId}`)
        : waiting
          ? pill("warn", "Answer needed")
          : profileReady(who)
            ? pill("ok", "Profile complete")
            : pill("warn", "Profile incomplete");
      return `<tr>
        <td><strong>${esc(who.name)}</strong><br /><span class="muted">${esc(who.email || "No login yet")}</span></td>
        <td>${esc(who.discipline || "—")}</td>
        <td>${esc(who.activity)}</td>
        <td>${status}</td>
        <td><button type="button" class="btn" data-provider="${esc(who.id)}">Open</button></td>
      </tr>`;
    })
    .join("");
  return `<article class="card">
    <h2>Providers</h2>
    <p>An invite collects only the name and email needed for the Cognito invitation. She fills in her own profile before any case is offered or shown.</p>
    <p class="muted">Inactive providers stay in this list. Awarding, declining, or closing a case does not remove the provider.</p>
    <label>Find a provider
      <input id="providerSearch" value="${esc(providerQuery)}" placeholder="Name, email, or inactive" />
    </label>
    <div class="table-wrap"><table>
      <thead><tr><th>Provider</th><th>Discipline</th><th>Status</th><th>Profile</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </article>
  <article class="card">
    <h2>Invite a therapist</h2>
    <form id="addProviderForm">
      <div class="row">
        <label>Name<input name="name" required maxlength="80" placeholder="Ada Berg" /></label>
        <label>Login email<input name="email" type="email" required maxlength="120" placeholder="ada.berg@example.test" /></label>
      </div>
      <div class="actions"><button class="btn-primary" type="submit">Send invite</button></div>
    </form>
  </article>`;
}

function adminProvider(who) {
  const locked = lockInfo(who);
  const hers = bids.filter((bid) => bid.personId === who.id);
  const bidRows = hers
    .map((bid) => {
      const row = findCase(bid.caseId);
      const answer =
        bid.remainingHours == null
          ? "Not answered yet"
          : bid.remainingHours === 0
            ? "Full · 0 hours left"
            : `${bid.remainingHours} hours left`;
      return `<tr>
        <td>${esc(row.id)}<br /><span class="muted">Child ${esc(row.child)}</span></td>
        <td>${row.awarded ? pill("ok", "Awarded") : pill("info", "Selected")}</td>
        <td>${answer}</td>
      </tr>`;
    })
    .join("");
  let lockNote = `<p class="notice">She is not locked. Other opportunities stay visible.</p>`;
  if (locked) {
    lockNote = `<p class="notice notice-warn"><strong>Locked.</strong> ${esc(who.name)} was awarded ${esc(locked.caseId)} for child ${esc(locked.child)} at ${esc(locked.school)}, and her hours left are 0. Other opportunities are hidden from her.</p>`;
  } else if (hers.some((bid) => bid.remainingHours === 0 && !findCase(bid.caseId)?.awarded)) {
    lockNote = `<p class="notice">She said this award would make her full, so hours left are 0. Other cases stay visible until that bid is awarded.</p>`;
  } else if (hers.some((bid) => bid.remainingHours > 0)) {
    const open = hers.find((bid) => bid.remainingHours > 0);
    lockNote = `<p class="notice notice-ok">Hours left: ${open.remainingHours}. Desired hours stay at ${esc(who.desiredHours)}. She still sees cases that fit.</p>`;
  }
  return `<article class="card">
    <h2>${esc(who.name)}</h2>
    <p><button type="button" class="btn" data-view="providers">Back to providers</button></p>
    <div class="summary">
      <div class="summary-card"><span class="summary-label">Login</span><span class="summary-value" style="font-size:1rem">${esc(who.email || "—")}</span></div>
      <div class="summary-card"><span class="summary-label">Discipline</span><span class="summary-value" style="font-size:1.05rem">${esc(who.discipline)}</span></div>
      <div class="summary-card"><span class="summary-label">Status</span><span class="summary-value" style="font-size:1.05rem">${esc(who.activity)}</span></div>
    </div>
    ${profileSummary(who)}
    ${lockNote}
    ${
      bidRows
        ? `<div class="table-wrap"><table><thead><tr><th>Bid</th><th>Report</th><th>Full?</th></tr></thead><tbody>${bidRows}</tbody></table></div>`
        : `<p class="muted">No bids yet.</p>`
    }
    ${offerHistoryBlock(who)}
  </article>`;
}

function profileSummary(who) {
  const ready = profileReady(who);
  const languages = (who.languages || []).join(", ") || "—";
  const programs = (who.programs || []).map(programLabel).join(" and ") || "—";
  return `<h2 style="margin-top:1.2rem">Profile she entered</h2>
    <p>${ready ? pill("ok", "Profile complete") : pill("warn", "Profile incomplete")}</p>
    <p>Street address ${esc(who.address || "—")}. Languages ${esc(languages)}. Gender ${esc(who.gender || "—")}. Discipline ${esc(who.discipline || "—")}. Desired hours ${who.desiredHours == null || who.desiredHours === "" ? "—" : esc(who.desiredHours)}. Programs ${esc(programs)}.</p>
    <p class="muted">She fills this in herself. An admin does not type it for her.</p>`;
}

function offerHistoryBlock(who) {
  const offers = offerHistory[who.id] || [];
  const rows = offers
    .map((offer) => {
      const snap = offer.snapshot || {};
      const program = snap.program === "preschool" ? "Preschool" : snap.program === "school-age" ? "School age" : esc(snap.program || "");
      return `<tr>
        <td>${esc(offerWhen(offer.sentAt))}</td>
        <td>${esc(channelLabel(offer.channel))}</td>
        <td>${esc(snap.school || offer.opportunityId || "")}<br /><span class="muted">${esc(snap.building || "")}</span></td>
        <td>${program}</td>
        <td>${esc(snap.service || "")}</td>
        <td>${offer.sent ? "Sent" : "Shown"}</td>
      </tr>`;
    })
    .join("");
  const choices = [...cases, ...unfilledCases];
  const seen = new Set();
  const options = choices
    .filter((row) => {
      if (!row || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row) => `<option value="${esc(row.id)}">${esc(row.id)} · ${esc(school(row.schoolCode).name)} · ${programLabel(row.program)}</option>`)
    .join("");
  return `<h2 style="margin-top:1.2rem">We offered you this</h2>
    <p>Staff can answer ${esc(who.name)} with the opportunities already offered to her. This history stays after a case is awarded, declined, or closed.</p>
    ${
      rows
        ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Channel</th><th>School</th><th>Program</th><th>Service</th><th>Sent or shown</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="muted">Nothing has been offered to her yet.</p>`
    }
    <form id="offerForm">
      <div class="row">
        <label>Opportunity
          <select name="opportunityId">${options}</select>
        </label>
        <label>Channel
          <select name="channel">
            <option value="portal">Portal</option>
            <option value="sms">Text preview</option>
            <option value="email">Email</option>
          </select>
        </label>
      </div>
      <label><input type="checkbox" name="sent" value="yes" /> This was actually sent</label>
      <div class="actions"><button class="btn-primary" type="submit">Record this outreach</button></div>
    </form>`;
}

function reminderBanner() {
  if (!reminders.length) return "";
  return reminders
    .map((item) => `<p class="notice notice-warn"><strong>Start reminder.</strong> ${esc(item.providerName)} on ${esc(item.caseId)}. ${esc(item.text)}</p>`)
    .join("");
}

function importStatusBanner() {
  if (!importMeta || !importMeta.lastAt) {
    return `<p class="notice">No available-bids import yet. Run SESIS import to load today's open bids.</p>`;
  }
  return `<p class="notice notice-ok"><strong>Last available import</strong> ${esc(offerWhen(importMeta.lastAt))} · source ${esc(importMeta.source || "sesis")} · ${esc(importMeta.caseCount ?? 0)} cases · ${esc(importMeta.withAddress ?? 0)} with street address · ${esc(importMeta.blankAddress ?? 0)} blank address. Nothing was bid in SESIS.</p>`;
}

function awardedImportBanner() {
  if (!awardedImportMeta || !awardedImportMeta.lastAt) {
    return `<p class="notice">No awarded import yet. Run awarded import after available bids (or wait for the twice-daily job).</p>`;
  }
  return `<p class="notice notice-ok"><strong>Last awarded import</strong> ${esc(offerWhen(awardedImportMeta.lastAt))} · source ${esc(awardedImportMeta.source || "sesis")} · ${esc(awardedImportMeta.awardsWritten ?? 0)} tracker rows · ${esc(awardedImportMeta.confirmed ?? 0)} confirmed · ${esc(awardedImportMeta.pending ?? 0)} pending provider.</p>`;
}

function homeQueueSummary() {
  const boe = openBoeAwards.slice(0, 8).map((item) => `<li>${esc(item.caseId)} · ${esc(item.statusLabel || item.status)} · ${esc(item.providerName || "no provider")} · ${esc(item.schoolName || "")}</li>`).join("");
  const escalations = districtEscalations.slice(0, 8).map((item) => `<li>${esc(item.name)} · escalated · ${esc(item.contactEmail || "")}</li>`).join("");
  const recruiters = recruiterQueue.slice(0, 8).map((item) => `<li>${esc(item.name || item.providerId)} · ${esc(item.schoolName || item.caseId || "")}</li>`).join("");
  const queued = queuedMessages.slice(0, 10).map((item) => `<li>${esc(item.channel || "email")} · ${esc(item.to || "—")} · ${esc(item.subject || item.kind || item.id)}</li>`).join("");
  return `<div class="school-block">
      <h3>Open BOE awards needing action</h3>
      ${boe ? `<ul>${boe}</ul>` : `<p class="muted">None open.</p>`}
    </div>
    <div class="school-block">
      <h3>District escalations</h3>
      ${escalations ? `<ul>${escalations}</ul>` : `<p class="muted">None escalated.</p>`}
    </div>
    <div class="school-block">
      <h3>Recruiter queue</h3>
      ${recruiters ? `<ul>${recruiters}</ul>` : `<p class="muted">Queue empty.</p>`}
    </div>
    <div class="school-block">
      <h3>Unsent queued messages (${esc(queuedCount)})</h3>
      ${queued ? `<ul>${queued}</ul>` : `<p class="muted">Nothing queued.</p>`}
    </div>`;
}

function coordinatorHome() {
  return `<article class="card">
    <h2>Coordinator home</h2>
    ${reminderBanner()}
    ${importStatusBanner()}
    ${awardedImportBanner()}
    <p>SMS configured: <strong>${smsConfigured ? "yes" : "no — SMS not configured"}</strong>. Place-bid mode: <strong>${placeBidLive ? "LIVE" : "dry-run"}</strong>. Mail from ${esc(mailFrom || "alerts@advancedautomations.net")}.</p>
    <p>Available then awarded imports feed cases and the BOE tracker. Therapists with a complete profile see matcher results only. Offer rows stay append-only.</p>
    <div class="actions">
      <button type="button" class="btn-primary" id="runSesisImport">Run SESIS import now</button>
      <button type="button" class="btn" id="runAwardedImport">Run awarded import</button>
      <button type="button" class="btn" id="runFixtureImport">Load fixture import</button>
      <button type="button" class="btn-primary" id="sendQueued">Send queued</button>
    </div>
    ${homeQueueSummary()}
    ${importCards()}
    <h2 style="margin-top:1rem">Award notifications</h2>
    ${noticeList("coordinator") || `<p class="muted">No award match yet.</p>`}
  </article>`;
}

function paGroupBlocks() {
  const rows = caseGroups.filter((group) => programFilter === "all" || group.program === programFilter);
  if (!rows.length) return `<p class="muted">No PA-style groups yet. Run a SESIS import.</p>`;
  return rows
    .map((group) => `<div class="school-block">
      <h3>${esc(group.schoolName || group.adminDbn || "School")} · ${esc(group.discipline)}</h3>
      <p class="muted">Due ${esc(group.responseDueBy || "—")} · ${esc(group.address || "address blank")} · ${esc(group.language || "no language")} · DBN ${esc(group.adminDbn || "—")} · Bldg ${esc(group.buildingCode || "—")} · ${programLabel(group.program)}</p>
      <p>${esc(group.childCount)} children · ${esc(group.individualSessions)} individual · ${esc(group.groupSessions)} group · ${hoursLabel(group.hoursTotal)}</p>
    </div>`)
    .join("");
}

function coordinatorCases() {
  const rows = cases.filter((row) => programFilter === "all" || row.program === programFilter);
  return `<article class="card">
    <h2>All cases in the database</h2>
    ${importStatusBanner()}
    ${filterButtons()}
    <h2>PA-style groups</h2>
    <p class="muted">Grouped by response due date, school address, language, discipline, Admin DBN, Phys Site Bldg Code, and program. Bidding stays child-level.</p>
    ${paGroupBlocks()}
    <h2 style="margin-top:1rem">Child-level cases</h2>
    ${schoolBlocks(rows)}
  </article>
  <article class="card">
    <h2>DOE email list</h2>
    <p>Paste opportunities that did not come from SESIS. One row per line: school, discipline, program, hours, address or DBN, then optional girls or cheder, then an optional language.</p>
    <form id="doeForm">
      <label>Rows
        <textarea name="text" rows="5" placeholder="Bnos Yakov | OT | preschool | 2 | 12 50th St, Borough Park | girls | Yiddish"></textarea>
      </label>
      <div class="actions"><button class="btn-primary" type="submit">Save DOE opportunities</button></div>
    </form>
  </article>`;
}

function coordinatorDetail(row) {
  const place = school(row.schoolCode);
  const held = holdMessage(row);
  const standinBid = bids.find((bid) => bid.caseId === row.id && bid.personId === "standin");
  const current = bids.filter((bid) => bid.caseId === row.id);
  const bidRows = current
    .map((bid) => {
      const who = person(bid.personId);
      const how =
        bid.enteredBy === "coordinator"
          ? pill("standin", "Entered by Moshe after a call")
          : pill("info", "Selected in the portal");
      return `<tr><td><strong>${who.name}</strong>${who.role === "stand-in" || who.id === "standin" ? `<br /><span class="muted">${who.note}</span>` : ""}</td><td>${how}<br /><span class="muted">${bid.note || ""}</span></td></tr>`;
    })
    .join("");
  return `<article class="card">
    <h2>${row.id} · child ${row.child}</h2>
    <p><button type="button" class="btn" data-view="cases">Back to cases</button></p>
    <p>School code ${row.schoolCode} → ${place.name}, ${place.building}, ${place.address}. ${programLabel(row.program)} · ${row.service}</p>
    ${row.awarded ? `<p class="notice notice-ok"><strong>Matched from the awarded-case report.</strong> ${person(row.takenBy).name} and ${COORDINATOR_NAME} were both notified.</p>` : ""}
    ${held && !row.awarded ? `<p class="notice notice-warn">${held}</p>` : ""}
    ${
      bidRows
        ? `<div class="table-wrap"><table><thead><tr><th>Person</th><th>How the bid got here</th></tr></thead><tbody>${bidRows}</tbody></table></div>`
        : `<p>No selection saved on this child yet.</p>`
    }
    ${row.takenBy && !row.awarded ? `<div class="actions"><button type="button" class="btn-primary" data-award="${row.id}">Award this bid</button></div>` : ""}
    <form id="ruleForm">
      <div class="row">
        <label>School rule
          <select name="audience">
            <option value="either"${row.audience === "cheder" || row.audience === "girls" ? "" : " selected"}>Either</option>
            <option value="cheder"${row.audience === "cheder" ? " selected" : ""}>Cheder, male only</option>
            <option value="girls"${row.audience === "girls" ? " selected" : ""}>Girls' school, female only</option>
          </select>
        </label>
        <label>Language, if the case names one
          <input name="language" maxlength="40" value="${esc(row.language || "")}" placeholder="Yiddish" />
        </label>
      </div>
      <input type="hidden" name="program" value="${esc(row.program)}" />
      <div class="actions"><button class="btn" type="submit">Save school rule</button></div>
    </form>
  </article>
  <article class="card">
    <h2>Bid after a call</h2>
    <p class="notice notice-warn"><strong>Demo Stand-in</strong> is a placeholder, not a real staff member, and has no HHAeXchange id.</p>
    ${
      standinBid
        ? `<p class="notice notice-ok">You already entered this bid for <strong>Demo Stand-in</strong> after a call. Note: ${standinBid.note || "—"}</p>`
        : held
          ? `<p class="muted">This child already has a selection, so a second bid is not saved.</p>`
          : `<form id="standinForm">
              <label>Stand-in person<input value="Demo Stand-in" disabled /></label>
              <label>What they agreed to on the call
                <input name="note" maxlength="160" required placeholder="Can start Monday" />
              </label>
              <div class="actions"><button class="btn-primary" type="submit">Save bid for Demo Stand-in</button></div>
            </form>`
    }
  </article>`;
}

function opportunityText(row) {
  const place = school(row.schoolCode);
  return `White Glove: ${place.name}, ${programLabel(row.program)}, ${row.service}, ${hoursLabel(row.hoursPerWeek)}. Open the portal to respond. Reply STOP to opt out.`;
}

function dayPanel() {
  const row = unfilled;
  const place = school(row.schoolCode);
  const active = dayPreview && Array.isArray(dayPreview.recipients)
    ? dayPreview.recipients
    : Object.values(people).filter((who) => who.activity === "active" && who.role !== "admin" && profileReady(who));
  const inactive = Object.values(people).filter((who) => who.activity === "inactive");
  const takenNote = row.takenBy
    ? `<p class="notice notice-warn"><strong>Already taken.</strong> ${esc(person(row.takenBy).name)} holds the one bid on this child. A second bid is not saved.</p>`
    : "";
  let body = "";
  if (row.day === 1) {
    body = `<p>Coordinators are alerted. This preview is only for active providers whose saved profile matches this opportunity: discipline, program, gender rule, and language when the case names one. A therapist still finishing her profile is not offered and does not get an offer row. Nothing is sent.</p>
      <div class="sms">${esc(dayPreview && dayPreview.message ? dayPreview.message : opportunityText(row))}</div>
      ${dayPreview && dayPreview.message ? `<p class="muted">Preview loaded from the Bids database. No text is sent.</p>` : ""}
      <div class="table-wrap"><table><thead><tr><th>Active provider</th><th>Discipline</th><th>Status</th></tr></thead>
        <tbody>${active.map((who) => `<tr><td>${esc(who.name)}</td><td>${esc(who.discipline)}</td><td>${esc(who.activity)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">${active.length} active providers. Inactive providers are on days 2–3.</p>
      ${takenNote}
      ${
        row.takenBy
          ? ""
          : `<form id="responderForm">
              <label>Responding provider
                <select name="responder">${active.map((who) => `<option value="${who.id}">${esc(who.name)}</option>`).join("")}</select>
              </label>
              <div class="actions"><button class="btn-primary" type="submit">Select this provider as the bid</button></div>
            </form>`
      }`;
  } else if (row.day === 2 || row.day === 3) {
    body = `<p>Day ${row.day} uses the day 2–3 window. The opportunity goes to inactive providers whose saved profile matches. They have two days to respond. A response goes to screening. Selecting one screened provider becomes the single bid and locks this child. Offer rows are stored as shown. No text is sent.</p>
      ${takenNote}
      <div class="table-wrap"><table><thead><tr><th>Inactive provider</th><th>Screening</th><th>Bid</th></tr></thead>
        <tbody>${inactive
          .map((who) => {
            const marked = row.screening.includes(who.id);
            const unfinished = profileReady(who) ? "" : `<br /><span class="muted">Profile incomplete, not offered</span>`;
            return `<tr><td>${esc(who.name)}${unfinished}<br /><span class="muted">${esc(who.discipline)}</span></td><td>${
              marked ? pill("info", "In screening") : `<button type="button" class="btn" data-screen="${who.id}">Mark responded</button>`
            }</td><td>${
              row.takenBy
                ? "—"
                : marked
                  ? `<button type="button" class="btn-primary" data-lock="${who.id}">Select as the bid</button>`
                  : `<span class="muted">Respond first</span>`
            }</td></tr>`;
          })
          .join("")}</tbody></table></div>`;
  } else if (row.day === 4) {
    body = `<p>This unfilled award is escalated to ${COORDINATOR_NAME} for follow-up.</p>
      <form id="followForm">
        <label>Follow-up note
          <textarea name="note" rows="3">${row.followNote}</textarea>
        </label>
        <div class="actions"><button class="btn-primary" type="submit">Save follow-up</button></div>
      </form>`;
  } else {
    const notice = row.cseNotice;
    const rejected = row.status === "rejected" || (row.decision && row.decision.automatic);
    body = rejected
      ? `<p>Five days passed with no provider. Bids rejected this opportunity by itself. The opportunity and the offer history stay.</p>
        <p class="notice notice-warn"><strong>CSE notice stored, not sent.</strong> ${esc((notice && notice.reason) || "No provider found within five days.")}</p>
        <div class="sms">${esc((notice && notice.body) || "No provider found within five days.")}</div>`
      : `<p>If this awarded opportunity still has no provider on day 5, Bids rejects it by itself and stores the CSE notice. The reason is “No provider found within five days.” Nothing is emailed.</p>`;
  }
  const log = [
    row.takenBy ? `Bid locked: ${person(row.takenBy).name} is the one bid on this child.` : "",
    row.screening.length ? `Days 2–3 screening: ${row.screening.map((id) => person(id).name).join(", ")}.` : "",
    row.followNote ? `Day 4: ${row.followNote}` : "",
    row.status === "rejected" || (row.decision && row.decision.reason) ? `Day 5: ${esc(row.decision && row.decision.reason ? row.decision.reason : "No provider found within five days.")}` : "",
  ].filter(Boolean);
  return `<article class="card">
    <h2>Unfilled awarded opportunity</h2>
    <p>${row.id} · child ${row.child} · ${place.name}, ${place.building} · ${programLabel(row.program)} · school code ${row.schoolCode}. ${
      row.decision
        ? row.decision.action === "reject"
          ? "This award is marked rejected in the demo."
          : "This opportunity stays open."
        : "The agency has this award and it is still unfilled."
    }</p>
    <div class="timeline">
      ${[1, 2, 3, 4, 5].map((day) => `<button type="button" class="nav${row.day === day ? " on" : ""}" data-day="${day}">Day ${day}</button>`).join("")}
    </div>
    <h2>Day ${row.day}</h2>
    ${body}
    ${log.length ? `<h2 style="margin-top:1rem">What has already happened</h2>${log.map((line) => `<p class="notice">${line}</p>`).join("")}` : ""}
  </article>
  <article class="card">
    <h2>A preschool award on the same timeline</h2>
    <p>UA-22 · child P. N. · Little Steps, Site 2 · Preschool · school code PRE088. It is sitting on day 2 of the same day 1–5 timeline so both programs are on this screen.</p>
  </article>`;
}

function quietPeople() {
  const rows = [];
  for (const touch of touches) {
    const row = findCase(touch.caseId);
    if (!row || row.awarded || touch.at === "just now") continue;
    const bid = bids.find((item) => item.caseId === touch.caseId && item.personId === touch.personId);
    if (bid) continue;
    rows.push({ touch, row, who: person(touch.personId) });
  }
  return rows;
}

function followupView() {
  const rows = quietPeople();
  const body = rows
    .map(({ touch, row, who }) => {
      const kind =
        touch.kind === "passed"
          ? pill("warn", "Passed")
          : touch.kind === "opened"
            ? pill("info", "Opened, no bid")
            : pill("err", "Never opened");
      return `<tr>
        <td><strong>${who.name}</strong><br /><span class="muted">${who.discipline} · ${who.activity}</span></td>
        <td>${row.id} · child ${row.child}<br /><span class="muted">${school(row.schoolCode).name} · ${programLabel(row.program)}</span></td>
        <td>${kind}<br /><span class="muted">${touch.at}</span></td>
        <td><button type="button" class="btn" data-open="${row.id}">Open case</button></td>
      </tr>`;
    })
    .join("");
  return `<article class="card">
    <h2>No response for 2 days</h2>
    <p>One list for a call. It separates never opened, opened without a bid, and passed.</p>
    ${
      body
        ? `<div class="table-wrap"><table><thead><tr><th>Therapist</th><th>Case</th><th>What happened</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
        : `<p class="notice notice-ok">Nobody is quiet for 2 days.</p>`
    }
  </article>`;
}

function expiringView() {
  const row = cases.find((item) => item.expiringSample);
  const place = school(row.schoolCode);
  const candidates = Object.values(people).filter((who) => who.sampleMiles != null && who.id !== "standin");
  const body = candidates
    .map(
      (who) => `<tr>
        <td>${esc(who.name)}<br /><span class="muted">${esc(who.activity)} · ${esc(who.discipline)}</span></td>
        <td>${who.sampleMiles.toFixed(1)} mi sample</td>
      </tr>`,
    )
    .join("");
  const held = row.takenBy;
  return `<article class="card">
    <h2>Bids approaching expiration</h2>
    <p class="notice notice-warn"><strong>Not confirmed yet.</strong> How an expiring bid is identified is still open. This row is only a sample so the follow-up screen has something to show.</p>
    <p class="notice notice-warn"><strong>Radius not confirmed yet.</strong> The miles below are sample demo distances. They are not the designated radius.</p>
    <p>${row.id} · child ${row.child} · ${place.name} · ${programLabel(row.program)}. One bid locks this child. A second bid is not saved.</p>
    <div class="table-wrap"><table><thead><tr><th>Therapist</th><th>Sample distance</th></tr></thead><tbody>${body}</tbody></table></div>
    ${held ? `<p class="notice notice-warn"><strong>Already taken.</strong> ${esc(person(held).name)} holds this child.</p>` : ""}
  </article>
  <article class="card">
    <h2>Submit a bid after the call</h2>
    <p class="notice notice-warn"><strong>Demo Stand-in</strong> is not a real staff member and has no HHAeXchange id. The bid is marked as entered by ${COORDINATOR_NAME} after a call.</p>
    ${
      held
        ? `<p class="muted">This child already has a bid, so another one is not saved.</p>`
        : `<form id="expiringStandin">
            <label>Note from the call<input name="note" required maxlength="160" placeholder="Can cover this child" /></label>
            <div class="actions"><button class="btn-primary" type="submit">Save bid for Demo Stand-in</button></div>
          </form>`
    }
  </article>`;
}

function trackerView() {
  const rows = trackers
    .map((item) => `<tr>
      <td>${esc(item.schoolName || "—")}<br /><span class="muted">${esc(item.caseload || "")}</span></td>
      <td>${esc(item.discipline || "—")}</td>
      <td>${esc(item.providerName || "—")}</td>
      <td>${item.transmittals == null ? "—" : esc(item.transmittals)}</td>
      <td>${esc(item.awardDate || "—")}</td>
      <td>${esc(item.statusLabel || item.status || "—")}</td>
      <td><button type="button" class="btn" data-tracker="${esc(item.caseId)}">Open</button></td>
    </tr>`)
    .join("");
  const open = trackers.find((item) => item.caseId === selectedId);
  return `<article class="card">
    <h2>Awarded-case tracker</h2>
    ${reminderBanner()}
    <p>Awarded rows stay here. Rejecting a school match or a provider decline does not delete the opportunity or the provider.</p>
    <form id="awardedImportForm">
      <div class="actions">
        <button class="btn-primary" type="submit" name="mode" value="live">Run awarded import</button>
        <button class="btn" type="submit" name="mode" value="fixture">Load awarded fixture</button>
      </div>
    </form>
    ${
      rows
        ? `<div class="table-wrap"><table><thead><tr><th>School and caseload</th><th>Discipline</th><th>Provider</th><th>Transmittals</th><th>Award date</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<p class="muted">No awarded rows yet.</p>`
    }
  </article>
  ${open ? trackerDetail(open) : ""}`;
}

function draftLine(label, draft) {
  if (!draft) return `<p class="muted">${esc(label)}: not stored yet.</p>`;
  return `<p class="notice"><strong>${esc(label)}, not sent.</strong> ${esc(draft.body || draft.reason || "")}</p>`;
}

function trackerDetail(item) {
  const steps = (item.steps || [])
    .map((step) => {
      if (step.owner === "system") {
        return `<li>${esc(step.label)} — ${step.done ? "done by the system" : `waiting${step.missing ? `: ${esc(step.missing)}` : ""}`}. ${esc(step.detail || "")}</li>`;
      }
      return `<li>${esc(step.label)} — ${step.done ? "marked done" : "open"}
        <button type="button" class="btn" data-check="${esc(item.caseId)}" data-step="${esc(step.id)}" data-done="${step.done ? "no" : "yes"}">${step.done ? "Mark open" : "Mark done"}</button></li>`;
    })
    .join("");
  const schedule = item.schedule || {};
  const missing = Array.isArray(schedule.missing) ? schedule.missing.join(", ") : schedule.missing;
  const scheduleBody = missing
    ? `<p class="notice">Still needed: ${esc(missing)}. No times were invented.</p>`
    : `<p class="notice notice-ok">Proposed: ${esc((schedule.proposal || []).join("; ") || "none")}</p>
       ${(schedule.conflicts || []).length ? `<p class="notice notice-warn">Conflicts: ${esc(schedule.conflicts.join("; "))}</p>` : ""}`;
  const nearby = (item.nearby || [])
    .map((who) => `<li>${esc(who.name)} · ${esc(who.discipline || "")} · ${esc(who.address || who.location || "")}</li>`)
    .join("");
  const statusButtons = [
    ["awarded-pending-provider", "Pending provider"],
    ["awarded-confirmed-provider", "Confirmed provider"],
    ["coordinating-start", "Coordinating start"],
    ["active-on-gila", "Active on Gila"],
    ["cancelled-bids-rejected", "Cancel / reject"],
  ].map(([value, label]) => `<button type="button" class="btn" data-award-status="${esc(item.caseId)}" data-status="${value}">${esc(label)}</button>`).join("");
  const placeBidNote = item.sesisPlaceBid
    ? `<p class="notice">${item.sesisPlaceBid.dryRun ? "Place-bid dry-run" : "Place-bid"} · ${esc(item.sesisPlaceBid.status || "")} · ${esc(item.sesisPlaceBid.message || "")}</p>`
    : `<p class="muted">SESIS place-bid has not been run for this case. Default is dry-run until live flag is set.</p>`;
  return `<article class="card">
    <h2>${esc(item.caseId)} · ${esc(item.providerName || "No provider")}</h2>
    <p>${esc(item.schoolName || "")} · ${esc(item.statusLabel || item.status || "")}${item.schoolRejected ? " · school rejected, reopened" : ""}${item.providerResponse === "declined" ? " · provider declined" : ""}</p>
    ${item.startReminder?.remind ? `<p class="notice notice-warn">${esc(item.startReminder.text)}</p>` : ""}
    <div class="actions">${statusButtons}</div>
    ${placeBidNote}
    <div class="actions"><button type="button" class="btn" data-place-sesis="${esc(item.caseId)}">Place bid in SESIS (${placeBidLive ? "LIVE" : "dry-run"})</button></div>
    <h2>Onboarding</h2>
    <ol>${steps}</ol>
    ${draftLine("Heather Dustas", item.drafts && item.drafts.heather)}
    ${draftLine("K. James", item.drafts && item.drafts.james)}
    ${draftLine("CSE", item.drafts && item.drafts.cse)}
    ${draftLine("Gila", item.drafts && item.drafts.gila)}
    <p class="muted">SESIS account, badge, eWeb, and payroll are stored requests. The account was not opened, the badge was not printed, eWeb was not written, and HHA was not called.</p>
    <h2>Schedule</h2>
    ${scheduleBody}
    <form id="scheduleForm">
      <input type="hidden" name="caseId" value="${esc(item.caseId)}" />
      <label>Mandates<textarea name="mandates" rows="2">${esc(item.mandates || "")}</textarea></label>
      <label>Student schedules<textarea name="studentSchedules" rows="2">${esc(item.studentSchedules || "")}</textarea></label>
      <label>School hours<textarea name="schoolHours" rows="2">${esc(item.schoolHours || "")}</textarea></label>
      <label>Students, one per line<textarea name="students" rows="2">${esc((item.students || []).join("\n"))}</textarea></label>
      <label>LS pay rate<input name="lsRate" maxlength="20" value="${esc(item.lsRate || "")}" /></label>
      <div class="actions"><button class="btn-primary" type="submit">Save schedule inputs</button></div>
    </form>
    <form id="photoForm">
      <input type="hidden" name="caseId" value="${esc(item.caseId)}" />
      <label>Provider photo for the badge request<input name="photo" type="file" accept="image/*" /></label>
      <p class="muted">${item.photo && item.photo.stored ? `Photo stored: ${esc(item.photo.fileName)}. It was not printed.` : "No photo stored yet."}</p>
      <div class="actions"><button class="btn" type="submit">Store photo</button></div>
    </form>
    <div class="actions">
      <button type="button" class="btn" data-started="${esc(item.caseId)}">She has started</button>
      <button type="button" class="btn" data-school-reject="${esc(item.caseId)}">School rejected her</button>
      <button type="button" class="btn" data-decline="${esc(item.caseId)}">Provider declined</button>
      <button type="button" class="btn-primary" data-outreach="${esc(item.caseId)}">Record text previews for nearby therapists</button>
    </div>
    ${nearby ? `<h2>Nearby therapists</h2><ul>${nearby}</ul>` : `<p class="muted">Nearby therapists appear after a decline or a school rejection, and only when their profiles are complete.</p>`}
  </article>`;
}

function messageLine(message) {
  if (!message) return "";
  return `<p class="notice"><strong>Ready to send, not sent.</strong> ${esc(message.subject || message.kind || "")}<br />${esc(message.body || "")}</p>`;
}

function districtsView() {
  const open = districts.find((item) => item.id === selectedId) || null;
  const rows = districts
    .map((item) => {
      const outreach = item.outreach;
      const status = outreach ? outreach.status : "not started";
      return `<tr>
        <td><strong>${esc(item.name)}</strong><br /><span class="muted">${esc(item.contactEmail)}</span></td>
        <td>${item.servicedBefore ? "Serviced before" : "New district"}</td>
        <td>${esc(status)}</td>
        <td><button type="button" class="btn" data-district="${esc(item.id)}">Open</button></td>
      </tr>`;
    })
    .join("");
  const needs = districtNeeds
    .map((need) => {
      const queue = (need.recruiterQueue || [])
        .map((who) => `<li>${esc(who.name)} · recruiter queue <button type="button" class="btn" data-district-award="${esc(need.id)}" data-award-provider="${esc(who.providerId)}">Award</button></li>`)
        .join("");
      const award = districtAwards.find((item) => item.caseId === need.id);
      return `<article class="card">
        <h2>${esc(need.schoolName)} · ${esc(need.discipline)} · ${programLabel(need.program)}</h2>
        <p>${esc(need.address)} · ${hoursLabel(need.hoursPerWeek)}${need.language ? ` · ${esc(need.language)}` : ""}</p>
        ${need.inactivePreviewAt ? `<p class="muted">Inactive text preview queued ${esc(offerWhen(need.inactivePreviewAt))}. Nothing was sent.</p>` : `<p class="muted">Active matching profiles get a queued email. Inactive profiles are text-previewed after one day with no interest.</p>`}
        ${need.interestEscalatedAt ? `<p class="notice notice-warn">${esc(need.interestEscalation && need.interestEscalation.text ? need.interestEscalation.text : "Escalated to the coordinator. No interest.")}</p>` : ""}
        ${queue ? `<h3>Recruiter queue</h3><ul>${queue}</ul>` : `<p class="muted">No one is on the recruiter queue yet.</p>`}
        ${award ? districtAwardBlock(award) : ""}
      </article>`;
    })
    .join("");
  return `<article class="card">
    <h2>Private school districts</h2>
    <p>This list replaces the Smartsheet. Messages stay queued and ready to send. Nothing is emailed or texted.</p>
    <p class="notice">District clock is ${districtClockDays} day${districtClockDays === 1 ? "" : "s"} ahead, for testing deadlines.</p>
    <div class="actions">
      <button type="button" class="btn" id="advanceDistrictDay">Advance one day</button>
      <button type="button" class="btn" id="districtFixture">Load sample district</button>
    </div>
    ${rows ? `<div class="table-wrap"><table><thead><tr><th>District</th><th>History</th><th>Outreach</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="muted">No districts yet.</p>`}
    <h2>Add a contract</h2>
    <form id="districtForm">
      <div class="row">
        <label>District name<input name="name" required maxlength="80" /></label>
        <label>Contact email<input name="contactEmail" type="email" required maxlength="120" /></label>
      </div>
      <label><input type="checkbox" name="servicedBefore" value="yes" /> White Glove has serviced this district before</label>
      <div class="actions"><button class="btn-primary" type="submit">Save district</button></div>
    </form>
  </article>
  ${open ? districtDetail(open) : ""}
  ${needs}`;
}

function districtDetail(item) {
  const outreach = item.outreach;
  const dates = outreach && outreach.status === "escalated"
    ? `<p class="notice notice-warn"><strong>Escalated to the coordinator.</strong> Needs ask ${esc(offerWhen(outreach.askedAt))}. Follow-up 1 ${esc(offerWhen(outreach.followup1At))}. Follow-up 2 ${esc(offerWhen(outreach.followup2At))}.</p>`
    : "";
  const questions = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const labels = {
    A: "Documentation system",
    B: "If Frontline, therapist login",
    C: "IEP access for the coordinator and the therapist",
    D: "Copy of the PO",
    E: "Treatment sessions only, or also additional services, and which ones",
    F: "Building contact",
    G: "Student list and a check that no IEP is missing",
    H: "Progress-report due dates",
  };
  return `<article class="card">
    <h2>${esc(item.name)}</h2>
    <p>${esc(item.contactEmail)} · ${item.servicedBefore ? "Serviced before" : "Never serviced"}</p>
    <div class="actions">
      <button type="button" class="btn-primary" data-ask="${esc(item.id)}">Queue needs email</button>
      <button type="button" class="btn" data-reply="${esc(item.id)}">Record a reply</button>
    </div>
    ${dates}
    ${(outreach && outreach.messages || []).map(messageLine).join("")}
    ${messageLine(item.questionsEmail)}
    ${item.servicedBefore ? "" : `<p class="muted">A new district gets one queued email with questions A through H. Answers stay on this record.</p>`}
    <form id="districtAnswerForm">
      <input type="hidden" name="districtId" value="${esc(item.id)}" />
      ${questions.map((key) => `<label>${key}. ${labels[key]}<textarea name="${key}" rows="2">${esc((item.questions && item.questions[key]) || "")}</textarea></label>`).join("")}
      <div class="actions"><button class="btn-primary" type="submit">Save answers</button></div>
    </form>
    <h2>Record an incoming need</h2>
    <form id="districtNeedForm">
      <input type="hidden" name="districtId" value="${esc(item.id)}" />
      <div class="row">
        <label>School<input name="school" required maxlength="80" /></label>
        <label>Address or district<input name="address" required maxlength="160" placeholder="12 50th St, Borough Park" /></label>
      </div>
      <div class="row">
        <label>Discipline<select name="discipline"><option>OT</option><option>PT</option><option>SLP</option></select></label>
        <label>Program<select name="program"><option value="school-age">School age</option><option value="preschool">Preschool</option></select></label>
        <label>Hours<input name="hours" type="number" min="1" max="40" value="2" required /></label>
      </div>
      <div class="row">
        <label>Language, if stated<input name="language" maxlength="40" placeholder="Yiddish" /></label>
        <label>School rule<select name="audience"><option value="either">Either</option><option value="cheder">Cheder, male only</option><option value="girls">Girls' school, female only</option></select></label>
      </div>
      <div class="actions"><button class="btn-primary" type="submit">Save need</button></div>
    </form>
  </article>`;
}

function districtAwardBlock(award) {
  const connection = award.connection || {};
  const schedule = connection.schedule || {};
  const missing = Array.isArray(schedule.missing) ? schedule.missing.join(", ") : schedule.missing;
  const scheduleBody = missing
    ? `<p class="notice">Still needed: ${esc(missing)}. No times were invented.</p>`
    : `<p class="notice notice-ok">Proposed: ${esc((schedule.proposal || []).join("; ") || "none")}</p>`;
  const link = connection.connected
    ? `<p class="notice notice-ok">${esc(award.providerName)} is connected to ${esc(connection.contact)} for schedule and start date.</p>`
    : `<p class="notice">Still needed before the schedule connection: ${esc([connection.missingContact, connection.missingStudents].filter(Boolean).join(" and ") || "building contact and student list")}.</p>`;
  return `<h3>Awarded therapist</h3>
    <p>${esc(award.providerName)} · start ${esc(award.startDate || "not set")}</p>
    ${link}
    ${scheduleBody}
    ${award.tmsFileOpenRequest ? `<p class="notice">${esc(award.tmsFileOpenRequest.note)}</p>` : ""}
    ${award.tmsMirror ? `<p class="notice">${esc(award.tmsMirror.note)} Rate ${esc(award.tmsMirror.lsRate || "not set")}.</p>` : ""}
    ${messageLine(award.payroll)}
    ${messageLine(award.billu)}
    <form id="districtStartForm">
      <input type="hidden" name="caseId" value="${esc(award.caseId)}" />
      <label>Start date<input name="startDate" type="date" value="${esc(award.startDate || "")}" required /></label>
      <label>Building contact<textarea name="buildingContact" rows="2">${esc(award.buildingContact || "")}</textarea></label>
      <label>Students, one per line<textarea name="students" rows="2">${esc((award.students || []).join("\n"))}</textarea></label>
      <label>Mandates<textarea name="mandates" rows="2">${esc(award.mandates || "")}</textarea></label>
      <label>Student schedules<textarea name="studentSchedules" rows="2">${esc(award.studentSchedules || "")}</textarea></label>
      <label>School hours<textarea name="schoolHours" rows="2">${esc(award.schoolHours || "")}</textarea></label>
      <label>LS pay rate<input name="lsRate" maxlength="20" value="${esc(award.lsRate || "")}" /></label>
      <div class="actions"><button class="btn-primary" type="submit">Save start date</button></div>
    </form>`;
}

function render() {
  renderNav();
  const root = $("view");
  if (role === "provider" && !profileReady(me())) {
    view = "preferences";
    root.innerHTML = providerPreferences();
    const status = $("status");
    status.textContent = flash;
    status.className = flash ? flashKind : "";
    persist();
    return;
  }
  const pending = role === "provider" ? pendingFullBid(providerId) : null;
  if (pending) {
    root.innerHTML = `<article class="card"><h2>Answer required</h2>${fullQuestion(pending)}</article>`;
  } else {
    const row = selectedId ? findCase(selectedId) : null;
    if (role === "provider") {
      if (view === "detail" && row) root.innerHTML = providerDetail(row);
      else if (view === "bids") root.innerHTML = providerBids();
      else if (view === "preferences") root.innerHTML = providerPreferences();
      else {
        view = "cases";
        root.innerHTML = `${noticeList("provider")}${providerCases()}`;
      }
    } else if (view === "providers") root.innerHTML = adminProviders();
    else if (view === "provider" && selectedId && people[selectedId] && people[selectedId].id !== "standin") root.innerHTML = adminProvider(people[selectedId]);
    else if (view === "detail" && row) root.innerHTML = coordinatorDetail(row);
    else if (view === "tracker") root.innerHTML = trackerView();
    else if (view === "districts") root.innerHTML = districtsView();
    else if (view === "unfilled") root.innerHTML = dayPanel();
    else if (view === "followup") root.innerHTML = followupView();
    else if (view === "expiring") root.innerHTML = expiringView();
    else if (view === "cases") root.innerHTML = coordinatorCases();
    else {
      view = "home";
      root.innerHTML = coordinatorHome();
    }
  }
  const status = $("status");
  status.textContent = flash;
  status.className = flash ? flashKind : "";
  persist();
}

async function postAction(method, path, body, okText) {
  if (!usingApi()) {
    setFlash("Sign in so this is saved in the Bids database.", "warn");
    return false;
  }
  const res = await apiSend(method, path, body);
  if (res.people) applyServer(res);
  if (!res.ok) {
    setFlash(res.error || "That was not saved.", "warn");
    return false;
  }
  setFlash(res.message || okText, "ok");
  return true;
}

async function awardCase(row) {
  if (!row || !row.takenBy || row.awarded) return false;
  if (usingApi()) {
    const res = await apiSend("POST", "/awards", { caseId: row.id });
    if (res.people) applyServer(res);
    if (!res.ok) {
      setFlash(res.error || "Award was not saved.", "warn");
      return false;
    }
    return true;
  }
  row.awarded = true;
  const who = person(row.takenBy);
  const bid = bids.find((item) => item.caseId === row.id && item.personId === row.takenBy);
  const full = bid && bid.remainingHours === 0;
  const left = bid && bid.remainingHours != null ? bid.remainingHours : null;
  notices.unshift({
    audience: "coordinator",
    text: `Awarded: ${who.name} was awarded ${row.id} at ${school(row.schoolCode).name} (${programLabel(row.program)}). Proceed with the next steps.${full ? " Hours left are 0, so other opportunities are hidden." : left != null ? ` Hours left: ${left}. Cases that fit stay visible.` : ""}`,
  });
  notices.unshift({
    audience: row.takenBy,
    text: `Your selection ${row.id} is awarded. You and ${COORDINATOR_NAME} can proceed with the next steps.`,
  });
  return true;
}

async function saveSelection(row, personId, note, enteredBy) {
  if (!row) return false;
  if (usingApi()) {
    let targetId = personId;
    let targetNote = note;
    let targetEntered = enteredBy;
    let lostRace = false;
    if (!cognitoMode() && row.race && !row.takenBy && !row.awarded) {
      targetId = personId === "rivka" ? "chana" : personId === "chana" ? "rivka" : "rivka";
      targetNote = "Selected at the same moment";
      targetEntered = "provider";
      lostRace = true;
    }
    const res = await apiSend("POST", "/bids", {
      caseId: row.id,
      personId: targetId,
      note: targetNote,
      enteredBy: targetEntered,
    });
    if (res.people) applyServer(res);
    if (!res.ok) {
      setFlash(res.error || holdMessage(row) || "Your bid was not saved.", "warn");
      render();
      return false;
    }
    if (lostRace) {
      setFlash(`${person(targetId).name} selected this case at the same moment. Your bid was not saved.`, "warn");
      render();
      return false;
    }
    return true;
  }
  if (row.takenBy || row.awarded) {
    setFlash(holdMessage(row), "warn");
    render();
    return false;
  }
  if (row.race) {
    const other = personId === "rivka" ? "chana" : personId === "chana" ? "rivka" : "rivka";
    row.race = false;
    row.takenBy = other;
    setFlash(`${person(other).name} selected this case at the same moment. Your bid was not saved.`, "warn");
    render();
    return false;
  }
  row.takenBy = personId;
  bids.push({
    caseId: row.id,
    personId,
    fillsAvailability: null,
    remainingHours: null,
    enteredBy,
    note,
  });
  return true;
}

async function onClick(event) {
  const programBtn = event.target.closest("[data-program]");
  if (programBtn) {
    programFilter = programBtn.dataset.program;
    render();
    return;
  }
  const dayBtn = event.target.closest("[data-day]");
  if (dayBtn) {
    unfilled.day = Number(dayBtn.dataset.day);
    if (!(await pushUnfilled())) {
      render();
      return;
    }
    render();
    return;
  }
  const openDistrict = event.target.closest("[data-district]");
  if (openDistrict) {
    go("districts", openDistrict.dataset.district);
    return;
  }
  const askBtn = event.target.closest("[data-ask]");
  if (askBtn) {
    await postAction("POST", "/districts/ask", { districtId: askBtn.dataset.ask }, "Needs email queued. It was not sent.");
    view = "districts";
    selectedId = askBtn.dataset.ask;
    render();
    return;
  }
  const replyBtn = event.target.closest("[data-reply]");
  if (replyBtn) {
    await postAction("POST", "/districts/reply", { districtId: replyBtn.dataset.reply }, "Reply recorded.");
    view = "districts";
    selectedId = replyBtn.dataset.reply;
    render();
    return;
  }
  const districtAward = event.target.closest("[data-district-award]");
  if (districtAward) {
    await postAction("POST", "/districts/award", {
      caseId: districtAward.dataset.districtAward,
      providerId: districtAward.dataset.awardProvider,
    }, "District need awarded.");
    view = "districts";
    render();
    return;
  }
  if (event.target.id === "advanceDistrictDay") {
    await postAction("POST", "/districts/advance-day", {}, "Advanced one day. Nothing was sent.");
    view = "districts";
    render();
    return;
  }
  if (event.target.id === "districtFixture") {
    await postAction("POST", "/districts/fixture", {}, "Sample district saved.");
    view = "districts";
    selectedId = "sample-district";
    render();
    return;
  }
  const openProvider = event.target.closest("[data-provider]");
  if (openProvider) {
    const id = openProvider.dataset.provider;
    if (usingApi()) {
      const res = await apiSend("GET", `/offers?providerId=${encodeURIComponent(id)}`);
      if (res.offers) offerHistory[id] = res.offers;
      if (!res.ok) setFlash(res.error || "Offer history could not be loaded.", "warn");
    }
    go("provider", id);
    return;
  }
  const navBtn = event.target.closest("[data-view]");
  if (navBtn && navBtn.dataset.view) {
    go(navBtn.dataset.view);
    return;
  }
  const open = event.target.closest("[data-open]");
  if (open) {
    const row = findCase(open.dataset.open);
    if (role === "provider" && !bids.find((bid) => bid.caseId === row.id && bid.personId === providerId)) {
      const touch = touches.find((item) => item.caseId === row.id && item.personId === providerId);
      if (!touch) touches.push({ caseId: row.id, personId: providerId, kind: "opened", at: "just now" });
    }
    go("detail", open.dataset.open);
    return;
  }
  const screenBtn = event.target.closest("[data-screen]");
  if (screenBtn) {
    if (!unfilled.screening.includes(screenBtn.dataset.screen)) unfilled.screening.push(screenBtn.dataset.screen);
    if (!(await pushUnfilled())) {
      render();
      return;
    }
    setFlash(`${person(screenBtn.dataset.screen).name} responded and is in screening. Selecting one person becomes the bid.`, "ok");
    render();
    return;
  }
  const lockBtn = event.target.closest("[data-lock]");
  if (lockBtn) {
    if (unfilled.takenBy) {
      setFlash(`Already taken. ${person(unfilled.takenBy).name} holds this child. Nothing was saved.`, "warn");
      render();
      return;
    }
    if (await saveSelection(unfilled, lockBtn.dataset.lock, "Selected from screening", "coordinator")) {
      unfilled.responder = lockBtn.dataset.lock;
      setFlash(`${person(unfilled.responder).name} is the one bid on this child.`, "ok");
      render();
    }
    return;
  }
  const awardBtn = event.target.closest("[data-award]");
  if (awardBtn) {
    const row = findCase(awardBtn.dataset.award);
    if (await awardCase(row)) {
      setFlash(`Awarded ${row.id} to ${person(row.takenBy).name}.`, "ok");
      render();
    }
    return;
  }
  const trackerBtn = event.target.closest("[data-tracker]");
  if (trackerBtn) {
    go("tracker", trackerBtn.dataset.tracker);
    return;
  }
  const checkBtn = event.target.closest("[data-check]");
  if (checkBtn) {
    await postAction("POST", "/awards/checklist", {
      caseId: checkBtn.dataset.check,
      step: checkBtn.dataset.step,
      done: checkBtn.dataset.done !== "no",
    }, "Checklist updated.");
    view = "tracker";
    selectedId = checkBtn.dataset.check;
    render();
    return;
  }
  const startedBtn = event.target.closest("[data-started]");
  if (startedBtn) {
    await postAction("POST", "/awards/started", { caseId: startedBtn.dataset.started }, "Start time saved. This does not reject the case.");
    view = "tracker";
    selectedId = startedBtn.dataset.started;
    render();
    return;
  }
  const schoolRejectBtn = event.target.closest("[data-school-reject]");
  if (schoolRejectBtn) {
    await postAction("POST", "/awards/school-reject", { caseId: schoolRejectBtn.dataset.schoolReject }, "The school rejection is saved. The case is open again today. Offer history stays.");
    view = "tracker";
    selectedId = schoolRejectBtn.dataset.schoolReject;
    render();
    return;
  }
  const declineBtn = event.target.closest("[data-decline]");
  if (declineBtn) {
    await postAction("POST", "/awards/decline", { caseId: declineBtn.dataset.decline }, "The decline is saved. Nearby therapists with a complete profile are listed. Nothing was texted.");
    view = "tracker";
    selectedId = declineBtn.dataset.decline;
    render();
    return;
  }
  const outreachBtn = event.target.closest("[data-outreach]");
  if (outreachBtn) {
    await postAction("POST", "/awards/outreach", { caseId: outreachBtn.dataset.outreach }, "Text previews are stored. Nothing was sent.");
    view = "tracker";
    selectedId = outreachBtn.dataset.outreach;
    render();
    return;
  }
  if (event.target.id === "runSesisImport") {
    await postAction("POST", "/import/sesis", { mode: "live", only: "both" }, "SESIS import finished.");
    view = "home";
    render();
    return;
  }
  if (event.target.id === "runAwardedImport") {
    await postAction("POST", "/import/awarded", { mode: "live" }, "Awarded import finished.");
    view = "home";
    render();
    return;
  }
  if (event.target.id === "sendQueued") {
    await postAction("POST", "/messages/send", {}, "Queued messages sent where SES allowed.");
    view = "home";
    render();
    return;
  }
  if (event.target.id === "runFixtureImport") {
    await postAction("POST", "/import/sesis", { mode: "fixture", only: "both" }, "Fixture import saved.");
    view = "home";
    render();
    return;
  }
  const statusBtn = event.target.closest("[data-award-status]");
  if (statusBtn) {
    await postAction("POST", "/awards/status", {
      caseId: statusBtn.dataset.awardStatus,
      status: statusBtn.dataset.status,
    }, "Award status updated.");
    view = "tracker";
    selectedId = statusBtn.dataset.awardStatus;
    render();
    return;
  }
  const placeBtn = event.target.closest("[data-place-sesis]");
  if (placeBtn) {
    await postAction("POST", "/bids/place-sesis", { caseId: placeBtn.dataset.placeSesis }, "SESIS place-bid finished (dry-run unless live flag is on).");
    view = "tracker";
    selectedId = placeBtn.dataset.placeSesis;
    render();
    return;
  }
  if (event.target.id === "secondImport") {
    imports.preschoolAvailable.runs = 2;
    imports.preschoolAvailable.at = "Today 1:15 PM";
    imports.schoolAvailable.runs = 2;
    imports.schoolAvailable.at = "Today 1:16 PM";
    imports.preschoolAwarded.runs = 2;
    imports.preschoolAwarded.at = "Today 1:17 PM";
    imports.schoolAwarded.runs = 2;
    imports.schoolAwarded.at = "Today 1:18 PM";
    if (!findCase("C-4419")) {
      const added = {
        id: "C-4419",
        child: "B. R.",
        schoolCode: "PRE441",
        program: "preschool",
        discipline: "OT",
        hoursPerWeek: 2,
        service: "OT, 30 min, 2x week",
      };
      if (usingApi()) {
        const res = await apiSend("POST", "/cases", added);
        if (res.people) applyServer(res);
        if (!res.ok) {
          setFlash(res.error || "The new case was not saved.", "warn");
          render();
          return;
        }
      } else {
        cases.push(added);
      }
    }
    setFlash("Second import today: preschool available file added C-4419. School-age available file had no new rows, so nobody was alerted again.", "ok");
    render();
    return;
  }
  if (event.target.id === "matchReports") {
    let matched = 0;
    for (const row of cases) {
      if (!row.onAwardedReport || row.awarded || !row.takenBy) continue;
      if (await awardCase(row)) matched += 1;
    }
    setFlash(
      matched
        ? `Matched ${matched} awarded report row${matched === 1 ? "" : "s"} to the database.`
        : "No new awarded-report rows matched a saved selection.",
      matched ? "ok" : "warn",
    );
    render();
  }
}

async function onSubmit(event) {
  const form = event.target;
  if (form.id === "offerForm") {
    event.preventDefault();
    const data = new FormData(form);
    const res = await apiSend("POST", "/offers", {
      providerId: selectedId,
      opportunityId: String(data.get("opportunityId") || ""),
      channel: String(data.get("channel") || "portal"),
      sent: data.get("sent") === "yes",
    });
    if (res.offers) offerHistory[selectedId] = res.offers;
    if (!res.ok) {
      setFlash(res.error || "That outreach was not saved.", "warn");
      render();
      return;
    }
    setFlash(res.message || "The outreach is saved on her offer history.", "ok");
    render();
    return;
  }
  if (form.id === "bidForm") {
    event.preventDefault();
    const row = findCase(selectedId);
    const note = String(new FormData(form).get("note") || "").trim();
    if (await saveSelection(row, providerId, note, "provider")) {
      setFlash(`Bid saved on ${row.id}. Say whether this award would make you full.`, "ok");
      view = "detail";
      render();
    }
    return;
  }
  if (form.id === "fullForm") {
    event.preventDefault();
    const bid = pendingFullBid(providerId);
    if (!bid) return;
    const data = new FormData(form);
    const full = data.get("fills") === "yes";
    const left = Number(data.get("hoursLeft"));
    if (!full && (!Number.isFinite(left) || left <= 0)) {
      setFlash("Enter the hours she still has.", "warn");
      render();
      return;
    }
    if (usingApi()) {
      const res = await apiSend("POST", "/bids/availability", {
        caseId: bid.caseId,
        personId: providerId,
        fills: full,
        hoursLeft: left,
      });
      if (res.people) applyServer(res);
      if (!res.ok) {
        setFlash(res.error || "Hours left were not saved.", "warn");
        render();
        return;
      }
    } else {
      bid.remainingHours = full ? 0 : left;
      bid.fillsAvailability = full;
    }
    setFlash(
      full
        ? "Hours left are 0. Other cases stay visible until this bid is awarded."
        : `Hours left saved as ${left}. Desired hours stay at ${me().desiredHours}. After the award, cases that fit those hours stay visible.`,
      "ok",
    );
    go("cases");
    return;
  }
  if (form.id === "addProviderForm") {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim().toLowerCase();
    if (!name || !email) {
      setFlash("Name and login email are required.", "warn");
      render();
      return;
    }
    if (signInProviders().some((who) => (who.email || "").toLowerCase() === email)) {
      setFlash("That login is already on a provider.", "warn");
      render();
      return;
    }
    const stem = email.split("@")[0].replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "provider";
    let id = stem;
    let n = 2;
    while (people[id]) {
      id = `${stem}-${n}`;
      n += 1;
    }
    if (usingApi()) {
      const res = await apiSend("POST", "/invites", { name, email });
      if (res.people) applyServer(res);
      if (!res.ok) {
        setFlash(res.error || "That invitation was not sent.", "warn");
        render();
        return;
      }
      setFlash(res.message || `${name} was invited. She sets her own password from the email, then signs in.`, "ok");
      go("providers");
      return;
    }
    people[id] = {
      id,
      name,
      email,
      discipline: "",
      activity: "active",
      location: "",
      address: "",
      desiredHours: null,
      programs: [],
      languages: [],
      gender: "",
      availability: "",
      profileComplete: false,
      fullyBooked: false,
    };
    setFlash(`${name} is added. She can sign in from the provider list and set her preferences.`, "ok");
    go("provider", id);
    return;
  }
  if (form.id === "standinForm" || form.id === "expiringStandin") {
    event.preventDefault();
    const caseId = form.id === "expiringStandin" ? cases.find((item) => item.expiringSample).id : selectedId;
    const row = findCase(caseId);
    const note = String(new FormData(form).get("note") || "").trim();
    if (await saveSelection(row, "standin", note, "coordinator")) {
      setFlash(`Bid saved for Demo Stand-in on ${row.id}. It is labeled as entered by you after a call.`, "ok");
      if (form.id === "expiringStandin") view = "expiring";
      render();
    }
    return;
  }
  if (form.id === "prefForm") {
    event.preventDefault();
    const data = new FormData(form);
    const therapist = me();
    const location = String(data.get("location") || "");
    const address = String(data.get("address") || "").trim();
    const desiredHours = Number(data.get("desiredHours"));
    const programs = data.getAll("program").map(String);
    const languages = data.getAll("language").map(String);
    const extra = String(data.get("languageExtra") || "").trim();
    if (extra) languages.push(extra);
    const gender = String(data.get("gender") || "");
    const discipline = String(data.get("discipline") || "");
    const availability = String(data.get("availability") || "").trim();
    if (!programs.length) {
      setFlash("Choose preschool and/or school age.", "warn");
      render();
      return;
    }
    if (usingApi()) {
      const res = await apiSend("PUT", "/preferences", {
        providerId,
        location,
        address,
        desiredHours,
        programs,
        languages,
        gender,
        discipline,
        availability,
      });
      if (res.people) applyServer(res);
      if (!res.ok) {
        setFlash(res.error || "Profile was not saved.", "warn");
        render();
        return;
      }
    } else {
      therapist.location = location;
      therapist.address = address;
      therapist.desiredHours = desiredHours;
      therapist.programs = programs;
      therapist.languages = languages;
      therapist.gender = gender;
      therapist.discipline = discipline;
      therapist.availability = availability;
      therapist.profileComplete = profileReady({ ...therapist, profileComplete: undefined });
    }
    if (!profileReady(me())) {
      setFlash("Save every required field before cases are offered.", "warn");
      view = "preferences";
      render();
      return;
    }
    setFlash("Profile saved. Cases now match the address, languages, gender, discipline, hours, and program she entered.", "ok");
    go("cases");
    return;
  }
  if (form.id === "districtInterestForm") {
    event.preventDefault();
    await postAction("POST", "/districts/interest", { caseId: selectedId, providerId }, "You are on the recruiter queue.");
    render();
    return;
  }
  if (form.id === "districtForm") {
    event.preventDefault();
    const data = new FormData(form);
    await postAction("POST", "/districts", {
      name: String(data.get("name") || ""),
      contactEmail: String(data.get("contactEmail") || ""),
      servicedBefore: data.get("servicedBefore") === "yes",
    }, "District saved.");
    view = "districts";
    render();
    return;
  }
  if (form.id === "districtAnswerForm") {
    event.preventDefault();
    const data = new FormData(form);
    const answers = {};
    for (const key of ["A", "B", "C", "D", "E", "F", "G", "H"]) answers[key] = String(data.get(key) || "");
    const districtId = String(data.get("districtId") || "");
    await postAction("POST", "/districts/answers", { districtId, answers }, "Answers saved.");
    view = "districts";
    selectedId = districtId;
    render();
    return;
  }
  if (form.id === "districtNeedForm") {
    event.preventDefault();
    const data = new FormData(form);
    const districtId = String(data.get("districtId") || "");
    await postAction("POST", "/districts/needs", {
      districtId,
      school: String(data.get("school") || ""),
      address: String(data.get("address") || ""),
      discipline: String(data.get("discipline") || ""),
      program: String(data.get("program") || ""),
      hours: Number(data.get("hours")),
      language: String(data.get("language") || ""),
      audience: String(data.get("audience") || "either"),
    }, "Need saved.");
    view = "districts";
    selectedId = districtId;
    render();
    return;
  }
  if (form.id === "districtStartForm") {
    event.preventDefault();
    const data = new FormData(form);
    await postAction("POST", "/districts/start", {
      caseId: String(data.get("caseId") || ""),
      startDate: String(data.get("startDate") || ""),
      buildingContact: String(data.get("buildingContact") || ""),
      students: String(data.get("students") || ""),
      mandates: String(data.get("mandates") || ""),
      studentSchedules: String(data.get("studentSchedules") || ""),
      schoolHours: String(data.get("schoolHours") || ""),
      lsRate: String(data.get("lsRate") || ""),
    }, "Start date saved. Queued records were not sent.");
    view = "districts";
    render();
    return;
  }
  if (form.id === "doeForm") {
    event.preventDefault();
    await postAction("POST", "/doe", { text: String(new FormData(form).get("text") || "") }, "DOE opportunities saved.");
    view = "cases";
    render();
    return;
  }
  if (form.id === "awardedImportForm") {
    event.preventDefault();
    const mode = event.submitter?.value === "live" ? "live" : "fixture";
    await postAction("POST", "/import/awarded", { mode }, mode === "live" ? "Awarded import finished." : "Awarded fixture saved.");
    view = "tracker";
    render();
    return;
  }
  if (form.id === "ruleForm") {
    event.preventDefault();
    const data = new FormData(form);
    await postAction("POST", "/cases/rule", {
      caseId: selectedId,
      program: String(data.get("program") || ""),
      audience: String(data.get("audience") || "either"),
      language: String(data.get("language") || ""),
    }, "School rule saved.");
    view = "detail";
    render();
    return;
  }
  if (form.id === "scheduleForm") {
    event.preventDefault();
    const data = new FormData(form);
    const caseId = String(data.get("caseId") || "");
    await postAction("POST", "/awards/schedule", {
      caseId,
      mandates: String(data.get("mandates") || ""),
      studentSchedules: String(data.get("studentSchedules") || ""),
      schoolHours: String(data.get("schoolHours") || ""),
      students: String(data.get("students") || ""),
      lsRate: String(data.get("lsRate") || ""),
    }, "Schedule inputs saved.");
    view = "tracker";
    selectedId = caseId;
    render();
    return;
  }
  if (form.id === "photoForm") {
    event.preventDefault();
    const data = new FormData(form);
    const caseId = String(data.get("caseId") || "");
    const file = form.photo && form.photo.files ? form.photo.files[0] : null;
    if (!file) {
      setFlash("Choose a photo file.", "warn");
      render();
      return;
    }
    const encoded = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
    await postAction("POST", "/awards/photo", {
      caseId,
      fileName: file.name,
      contentType: file.type,
      data: encoded,
    }, "Photo stored with the award. It was not printed.");
    view = "tracker";
    selectedId = caseId;
    render();
    return;
  }
  if (form.id === "responderForm") {
    event.preventDefault();
    const id = String(new FormData(form).get("responder"));
    if (unfilled.takenBy) {
      setFlash(`Already taken. ${person(unfilled.takenBy).name} holds this child. Nothing was saved.`, "warn");
      render();
      return;
    }
    if (await saveSelection(unfilled, id, "Day 1 response", "coordinator")) {
      unfilled.responder = id;
      setFlash(`${person(id).name} is the one bid on ${unfilled.id}. A second bid will not be saved.`, "ok");
      render();
    }
    return;
  }
  if (form.id === "followForm") {
    event.preventDefault();
    unfilled.followNote = String(new FormData(form).get("note") || "").trim();
    if (!(await pushUnfilled())) {
      render();
      return;
    }
    setFlash("Day 4 follow-up saved.", "ok");
    render();
    return;
  }
  if (form.id === "day5Form") {
    event.preventDefault();
    const data = new FormData(form);
    const action = event.submitter ? event.submitter.value : "keep";
    unfilled.decision = { action, reason: String(data.get("reason") || "").trim() };
    if (!(await pushUnfilled())) {
      render();
      return;
    }
    setFlash(action === "keep" ? "The opportunity stays open." : "The award is marked rejected in this demo.", "ok");
    render();
  }
}

function onRole(event) {
  role = event.target.value;
  view = role === "provider" ? "cases" : "home";
  selectedId = null;
  clearFlash();
  render();
}

function onProvider(event) {
  providerId = event.target.value;
  view = "cases";
  selectedId = null;
  clearFlash();
  render();
}

document.addEventListener("click", onClick);
document.addEventListener("submit", onSubmit);
document.addEventListener("input", (event) => {
  if (event.target.id !== "providerSearch") return;
  providerQuery = event.target.value;
  const start = event.target.selectionStart;
  render();
  const box = $("providerSearch");
  if (!box) return;
  box.focus();
  if (typeof start === "number") box.setSelectionRange(start, start);
});
$("role").addEventListener("change", onRole);
$("provider").addEventListener("change", onProvider);

async function boot() {
  if (cognitoMode()) {
    const saved = localStorage.getItem("bidsIdToken") || "";
    if (!tokenStillGood(saved)) {
      showLogin("");
      return;
    }
    applyToken(saved, localStorage.getItem("bidsAccessToken") || "");
    await enterApp();
    return;
  }
  if (usingApi()) {
    $("status").textContent = "Loading Bids…";
    const res = await apiSend("GET", "/state");
    if (res.people) applyServer(res);
    if (!res.ok) setFlash(res.error || "Could not load the Bids database.", "warn");
    restoreChrome();
  } else {
    loadState();
  }
  render();
}

$("signOut").addEventListener("click", () => signOut(""));

boot();
