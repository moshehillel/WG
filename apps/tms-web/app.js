const CFG = (typeof window !== 'undefined' && window.TMS_CONFIG) || {};
const API = (localStorage.getItem('tmsApi') || CFG.apiUrl || 'http://127.0.0.1:8787').replace(/\/$/, '');
const USER_POOL_ID = CFG.userPoolId || '';
const CLIENT_ID = CFG.clientId || '';
// Real sign-in only when the build gives us a Cognito app client id.
// Without it (local dev) the role dropdown + dev headers keep working.
const COGNITO_MODE = Boolean(CLIENT_ID);

const state = {
  role: 'therapist',
  email: '',
  idToken: localStorage.getItem('tmsIdToken') || '',
  accessToken: localStorage.getItem('tmsAccessToken') || '',
  weekId: '',
  weekStart: mondayIso(),
  last: null,
  mandateDraft: null,
  caseloadPreview: null,
  caseloadImport: null,
  reportFrom: '',
  reportTo: '',
  reportView: '',
  childDetailBack: 'children',
  focusSchoolId: '',
  selectedSchoolId: sessionStorage.getItem('tmsSchoolId') || '',
  schoolConfirmed: sessionStorage.getItem('tmsSchoolConfirmed') === '1',
  selectedProgramType: sessionStorage.getItem('tmsProgramType') || '',
  programConfirmed: sessionStorage.getItem('tmsProgramConfirmed') === '1',
  lastServiceProviderId: '',
  internalNotesProviderId: '',
  sessionNotesProviderId: '',
  childSessionFrom: '',
  childSessionTo: '',
  providerSessionFrom: '',
  providerSessionTo: '',
  providerSessionDistrict: '',
  sessionNotesDistrict: '',
  therapistPane: sessionStorage.getItem('tmsTherapistPane') || 'current',
  childDetailTab: sessionStorage.getItem('tmsChildDetailTab') || 'basic',
  providerDetailTab: sessionStorage.getItem('tmsProviderDetailTab') || 'basic',
  listTabLetter: 'A',
  editingMandateId: '',
};

const REPORT_LIST = [
  {
    id: 'week-progress',
    title: 'Weekly session progress',
    blurb: 'Sessions delivered % and notes posted % versus mandate by child and week.',
  },
  {
    id: 'last-service',
    title: 'Last date of service',
    blurb: 'Most recent attended or makeup date of service by child and provider.',
  },
  {
    id: 'due-dates',
    title: 'Progress-report due dates',
    blurb: 'School progress, annual, and reevaluation due dates with completion status.',
  },
  {
    id: 'archive',
    title: 'Uploads & timesheets archive',
    blurb: 'Look up uploaded session PDFs and generated timesheets by provider and date.',
  },
  {
    id: 'internal-notes',
    title: 'Internal notes',
    blurb: 'All provider internal notes across the caseload, filterable by date and provider.',
  },
  {
    id: 'session-notes',
    title: 'Session notes',
    blurb: 'Totals of attended (incl. makeup) and missed session notes for a date range.',
  },
];

/** UI language: en | es (persisted). */
const I18N = {
  en: {
    'brand.h1': 'Provider portal',
    'brand.tag': 'Clinical timesheets & caseload operations',
    'nav.role': 'Role',
    'nav.therapist': 'Therapist',
    'nav.admin': 'Admin',
    'nav.security': 'Security (MFA)',
    'nav.changePassword': 'Change password',
    'nav.signOut': 'Sign out',
    'nav.dash': 'Dashboard',
    'nav.children': 'Children',
    'nav.providers': 'Providers',
    'nav.mandates': 'Mandates',
    'nav.schools': 'Schools',
    'nav.admins': 'Admins',
    'nav.reports': 'Reports',
    'auth.kicker': 'White Glove Therapy',
    'auth.lead': 'Secure access for therapists and office staff.',
    'auth.sub': 'Manage weekly timesheets, mandates, and signatures in one workspace.',
    'login.title': 'Sign in',
    'login.blurb': 'Use the email and temporary password from your White Glove invitation.',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.signingIn': 'Signing in…',
    'login.forgot': 'Forgot password?',
    'login.needBoth': 'Enter your email and password.',
    'login.lang': 'Language',
    'mfa.challengeTitle': 'Two-step verification',
    'mfa.challengeSms': 'Enter the code sent to your phone.',
    'mfa.challengeEmail': 'Enter the code we emailed you.',
    'mfa.challengeTotp': 'Enter the 6-digit code from your authenticator app.',
    'mfa.code': 'Verification code',
    'mfa.verify': 'Verify',
    'mfa.verifying': 'Verifying…',
    'mfa.needCode': 'Enter the verification code.',
    'mfa.backLogin': 'Back to sign in',
    'mfa.trustDevice': 'Trust this device (skip MFA next time on this browser)',
    'mfa.selectTitle': 'Choose verification method',
    'mfa.selectBlurb': 'Pick how you want to verify this sign-in.',
    'mfa.pickTotp': 'Authenticator app',
    'mfa.pickEmail': 'Email code',
    'mfa.pickSms': 'Text message (SMS)',
    'mfa.setupForcedTitle': 'Set up two-step verification',
    'mfa.setupTitle': 'Security — MFA',
    'mfa.setupForcedBlurb':
      'Your organization requires multi-factor authentication before continuing. Choose a method to finish signing in.',
    'mfa.setupBlurb':
      'Protect your account with an authenticator app (recommended), email codes, or Windows Hello / passkey.',
    'mfa.enrollTotp': 'Set up authenticator app',
    'mfa.enrollEmail': 'Set up email codes',
    'mfa.enrollPasskey': 'Set up Windows Hello / passkey',
    'mfa.enrollSms': 'Set up text message (SMS)',
    'mfa.smsOffNote':
      'SMS MFA is disabled. Use authenticator, email codes, or Windows Hello / passkey.',
    'mfa.emailTitle': 'Email verification codes',
    'mfa.emailBlurb':
      'We will send a one-time code to your sign-in email when you log in. Authenticator apps remain recommended when available.',
    'mfa.emailOn': 'Email MFA is on.',
    'mfa.passkeyTitle': 'Windows Hello / passkey',
    'mfa.passkeyBlurb':
      'Register this device (Windows Hello, Face ID, Touch ID, or a security key). After setup you can sign in with the passkey instead of password + MFA.',
    'mfa.passkeyRegister': 'Register passkey on this device',
    'mfa.passkeyOn': 'Passkey registered for this account.',
    'mfa.passkeyNeedSecure': 'Passkeys need a secure context (HTTPS) and a supported browser.',
    'mfa.passkeySignIn': 'Sign in with Windows Hello / passkey',
    'mfa.passkeyNeedEmail': 'Enter your email, then use Windows Hello / passkey.',
    'mfa.passkeyWorking': 'Waiting for Windows Hello / passkey…',
    'mfa.passkeyNotRegistered':
      'No passkey is registered for this account. Sign in with your password, then open Security and register Windows Hello / passkey.',
    'mfa.passkeyHint': 'First time? Sign in with password, then register a passkey under Security.',
    'mfa.statusEmail': 'Email codes',
    'mfa.statusPasskey': 'Passkey / Windows Hello',
    'mfa.back': 'Back',
    'mfa.totpTitle': 'Authenticator app',
    'mfa.totpBlurb':
      'Scan the QR code with Google Authenticator, Authy, or Microsoft Authenticator. Or enter the key manually.',
    'mfa.copyKey': 'Copy key',
    'mfa.openApp': 'Open in authenticator app',
    'mfa.confirmCode': 'Enter 6-digit code to confirm',
    'mfa.confirmEnable': 'Confirm and enable',
    'mfa.confirming': 'Confirming…',
    'mfa.needSix': 'Enter the 6-digit code from your authenticator app.',
    'mfa.totpOn': 'Authenticator MFA is on.',
    'mfa.smsTitle': 'Text message (SMS)',
    'mfa.smsBlurb':
      'Use your personal mobile number for verification codes. SMS is billed to the organization (~$0.00645+ per US message via AWS SNS). Authenticator apps are free and recommended.',
    'mfa.phone': 'Mobile number (E.164, e.g. +15551234567)',
    'mfa.sendSms': 'Send verification code',
    'mfa.smsCode': 'SMS code',
    'mfa.smsConfirm': 'Verify phone and enable SMS MFA',
    'mfa.needPhone': 'Enter a valid phone in E.164 format (example: +15551234567).',
    'mfa.smsSent': 'Verification code sent by SMS (if SNS is configured).',
    'mfa.needSmsCode': 'Enter the SMS verification code.',
    'mfa.smsOn': 'SMS MFA is on.',
    'mfa.securityTitle': 'Security — MFA',
    'mfa.securityBlurb':
      'Authenticator app is recommended. Email codes and Windows Hello / passkeys are also available. SMS MFA is disabled.',
    'mfa.statusTotp': 'Authenticator app',
    'mfa.statusSms': 'SMS',
    'mfa.statusOrg': 'Organization requires MFA',
    'mfa.yes': 'Yes',
    'mfa.no': 'No',
    'mfa.on': 'On',
    'mfa.off': 'Off',
    'mfa.addMethods': 'Add or change methods',
    'mfa.disableMine': 'Turn off MFA on my account',
    'mfa.requiredNote':
      'MFA is required by your organization — you cannot turn it off here. An admin can change the policy under Advanced security.',
    'mfa.trustedYes': 'This browser is remembered for MFA skip.',
    'mfa.trustedNo': 'Not remembered on this browser.',
    'mfa.trustedLabel': 'Trusted device',
    'mfa.forgetDevice': 'Forget this device',
    'mfa.forgotDeviceOk': 'This device will require MFA on the next sign-in.',
    'mfa.disabledOk': 'MFA turned off for your account.',
    'mfa.needResign': 'Sign out and sign in again to manage MFA.',
    'mfa.needResignSetup': 'Sign out and sign in again to set up MFA.',
    'mfa.advanced': 'Advanced',
    'mfa.advancedHint': 'Organization MFA policy (admins)',
    'mfa.requireLabel': 'Require MFA for all logins',
    'mfa.allowSmsLabel': 'Allow SMS MFA enrollment',
    'mfa.savePolicy': 'Save policy',
    'mfa.policySaved': 'MFA policy saved.',
    'mfa.policyBlurb':
      'Require MFA applies to every therapist and admin Cognito login. Methods: authenticator app, email codes, or Windows Hello / passkey. SMS MFA stays off.',
    'mfa.footerHold': 'Hold to open advanced security…',
    'forgot.title': 'Forgot password',
    'forgot.blurb': 'We will email a confirmation code. Then choose a new password.',
    'forgot.send': 'Send reset code',
    'forgot.sending': 'Sending…',
    'forgot.needEmail': 'Enter your email address.',
    'therapist.pending': 'Pending Sessions',
    'therapist.processed': 'Processed Sessions',
    'therapist.archive': 'My uploads',
    'therapist.reload': 'Reload sessions',
    'therapist.changeSchool': 'Change program',
    'therapist.changeProgram': 'Change program',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.error': 'Something went wrong.',
    'common.ok': 'OK',
    'common.back': 'Back',
    'session.ended': 'Your session has ended. Please sign in again.',
    'lang.en': 'English',
    'lang.es': 'Español',
  },
  es: {
    'brand.h1': 'Portal del proveedor',
    'brand.tag': 'Hojas de tiempo clínicas y operaciones de caseload',
    'nav.role': 'Rol',
    'nav.therapist': 'Terapeuta',
    'nav.admin': 'Administrador',
    'nav.security': 'Seguridad (MFA)',
    'nav.changePassword': 'Cambiar contraseña',
    'nav.signOut': 'Cerrar sesión',
    'nav.dash': 'Panel',
    'nav.children': 'Niños',
    'nav.providers': 'Proveedores',
    'nav.mandates': 'Mandatos',
    'nav.schools': 'Escuelas',
    'nav.admins': 'Administradores',
    'nav.reports': 'Informes',
    'auth.kicker': 'White Glove Therapy',
    'auth.lead': 'Acceso seguro para terapeutas y personal de oficina.',
    'auth.sub': 'Gestione hojas de tiempo semanales, mandatos y firmas en un solo espacio.',
    'login.title': 'Iniciar sesión',
    'login.blurb': 'Use el correo y la contraseña temporal de su invitación de White Glove.',
    'login.email': 'Correo electrónico',
    'login.password': 'Contraseña',
    'login.submit': 'Iniciar sesión',
    'login.signingIn': 'Iniciando sesión…',
    'login.forgot': '¿Olvidó su contraseña?',
    'login.needBoth': 'Ingrese su correo y contraseña.',
    'login.lang': 'Idioma',
    'mfa.challengeTitle': 'Verificación en dos pasos',
    'mfa.challengeSms': 'Ingrese el código enviado a su teléfono.',
    'mfa.challengeEmail': 'Ingrese el código que le enviamos por correo.',
    'mfa.challengeTotp': 'Ingrese el código de 6 dígitos de su aplicación de autenticación.',
    'mfa.code': 'Código de verificación',
    'mfa.verify': 'Verificar',
    'mfa.verifying': 'Verificando…',
    'mfa.needCode': 'Ingrese el código de verificación.',
    'mfa.backLogin': 'Volver al inicio de sesión',
    'mfa.trustDevice': 'Confiar en este dispositivo (omitir MFA la próxima vez en este navegador)',
    'mfa.selectTitle': 'Elija el método de verificación',
    'mfa.selectBlurb': 'Seleccione cómo desea verificar este inicio de sesión.',
    'mfa.pickTotp': 'Aplicación de autenticación',
    'mfa.pickEmail': 'Código por correo',
    'mfa.pickSms': 'Mensaje de texto (SMS)',
    'mfa.setupForcedTitle': 'Configure la verificación en dos pasos',
    'mfa.setupTitle': 'Seguridad — MFA',
    'mfa.setupForcedBlurb':
      'Su organización exige autenticación multifactor antes de continuar. Elija un método para completar el acceso.',
    'mfa.setupBlurb':
      'Proteja su cuenta con una aplicación de autenticación (recomendado), códigos por correo o Windows Hello / passkey.',
    'mfa.enrollTotp': 'Configurar aplicación de autenticación',
    'mfa.enrollEmail': 'Configurar códigos por correo',
    'mfa.enrollPasskey': 'Configurar Windows Hello / passkey',
    'mfa.enrollSms': 'Configurar mensaje de texto (SMS)',
    'mfa.smsOffNote':
      'El MFA por SMS está desactivado. Use autenticador, correo o Windows Hello / passkey.',
    'mfa.emailTitle': 'Códigos por correo',
    'mfa.emailBlurb':
      'Enviaremos un código de un solo uso a su correo de inicio de sesión. Las aplicaciones de autenticación siguen siendo recomendadas.',
    'mfa.emailOn': 'MFA por correo activado.',
    'mfa.passkeyTitle': 'Windows Hello / passkey',
    'mfa.passkeyBlurb':
      'Registre este dispositivo (Windows Hello, Face ID, Touch ID o una llave de seguridad). Después podrá iniciar sesión con passkey en lugar de contraseña + MFA.',
    'mfa.passkeyRegister': 'Registrar passkey en este dispositivo',
    'mfa.passkeyOn': 'Passkey registrado para esta cuenta.',
    'mfa.passkeyNeedSecure': 'Los passkeys requieren HTTPS y un navegador compatible.',
    'mfa.passkeySignIn': 'Iniciar sesión con Windows Hello / passkey',
    'mfa.passkeyNeedEmail': 'Ingrese su correo y luego use Windows Hello / passkey.',
    'mfa.passkeyWorking': 'Esperando Windows Hello / passkey…',
    'mfa.passkeyNotRegistered':
      'No hay passkey registrado para esta cuenta. Inicie sesión con su contraseña, luego abra Seguridad y registre Windows Hello / passkey.',
    'mfa.passkeyHint': '¿Primera vez? Inicie sesión con contraseña y registre un passkey en Seguridad.',
    'mfa.statusEmail': 'Códigos por correo',
    'mfa.statusPasskey': 'Passkey / Windows Hello',
    'mfa.back': 'Volver',
    'mfa.totpTitle': 'Aplicación de autenticación',
    'mfa.totpBlurb':
      'Escanee el código QR con Google Authenticator, Authy o Microsoft Authenticator. O ingrese la clave manualmente.',
    'mfa.copyKey': 'Copiar clave',
    'mfa.openApp': 'Abrir en la aplicación de autenticación',
    'mfa.confirmCode': 'Ingrese el código de 6 dígitos para confirmar',
    'mfa.confirmEnable': 'Confirmar y activar',
    'mfa.confirming': 'Confirmando…',
    'mfa.needSix': 'Ingrese el código de 6 dígitos de su aplicación de autenticación.',
    'mfa.totpOn': 'MFA por autenticador activado.',
    'mfa.smsTitle': 'Mensaje de texto (SMS)',
    'mfa.smsBlurb':
      'Use su número de celular personal para los códigos. El SMS se factura a la organización (~$0.00645+ por mensaje en EE. UU. vía AWS SNS). Las aplicaciones de autenticación son gratuitas y recomendadas.',
    'mfa.phone': 'Número móvil (E.164, p. ej. +15551234567)',
    'mfa.sendSms': 'Enviar código de verificación',
    'mfa.smsCode': 'Código SMS',
    'mfa.smsConfirm': 'Verificar teléfono y activar MFA por SMS',
    'mfa.needPhone': 'Ingrese un teléfono válido en formato E.164 (ejemplo: +15551234567).',
    'mfa.smsSent': 'Código de verificación enviado por SMS (si SNS está configurado).',
    'mfa.needSmsCode': 'Ingrese el código de verificación SMS.',
    'mfa.smsOn': 'MFA por SMS activado.',
    'mfa.securityTitle': 'Seguridad — MFA',
    'mfa.securityBlurb':
      'Se recomienda la aplicación de autenticación. También hay códigos por correo y Windows Hello / passkeys. El MFA por SMS está desactivado.',
    'mfa.statusTotp': 'Aplicación de autenticación',
    'mfa.statusSms': 'SMS',
    'mfa.statusOrg': 'La organización exige MFA',
    'mfa.yes': 'Sí',
    'mfa.no': 'No',
    'mfa.on': 'Activado',
    'mfa.off': 'Desactivado',
    'mfa.addMethods': 'Agregar o cambiar métodos',
    'mfa.disableMine': 'Desactivar MFA en mi cuenta',
    'mfa.requiredNote':
      'Su organización exige MFA — no puede desactivarlo aquí. Un administrador puede cambiar la política en Seguridad avanzada.',
    'mfa.trustedYes': 'Este navegador está recordado para omitir MFA.',
    'mfa.trustedNo': 'No está recordado en este navegador.',
    'mfa.trustedLabel': 'Dispositivo de confianza',
    'mfa.forgetDevice': 'Olvidar este dispositivo',
    'mfa.forgotDeviceOk': 'Este dispositivo exigirá MFA en el próximo inicio de sesión.',
    'mfa.disabledOk': 'MFA desactivado en su cuenta.',
    'mfa.needResign': 'Cierre sesión e inicie de nuevo para administrar MFA.',
    'mfa.needResignSetup': 'Cierre sesión e inicie de nuevo para configurar MFA.',
    'mfa.advanced': 'Avanzado',
    'mfa.advancedHint': 'Política MFA de la organización (administradores)',
    'mfa.requireLabel': 'Exigir MFA en todos los inicios de sesión',
    'mfa.allowSmsLabel': 'Permitir inscripción MFA por SMS',
    'mfa.savePolicy': 'Guardar política',
    'mfa.policySaved': 'Política MFA guardada.',
    'mfa.policyBlurb':
      'Exigir MFA aplica a cada inicio de sesión. Métodos: autenticador, correo o Windows Hello / passkey. El MFA por SMS permanece desactivado.',
    'mfa.footerHold': 'Mantenga pulsado para abrir seguridad avanzada…',
    'forgot.title': 'Olvidé mi contraseña',
    'forgot.blurb': 'Le enviaremos un código de confirmación por correo. Luego elija una contraseña nueva.',
    'forgot.send': 'Enviar código',
    'forgot.sending': 'Enviando…',
    'forgot.needEmail': 'Ingrese su dirección de correo.',
    'therapist.pending': 'Sesiones pendientes',
    'therapist.processed': 'Sesiones procesadas',
    'therapist.archive': 'Mis cargas',
    'therapist.reload': 'Recargar sesiones',
    'therapist.changeSchool': 'Cambiar programa',
    'therapist.changeProgram': 'Cambiar programa',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.error': 'Algo salió mal.',
    'common.ok': 'Aceptar',
    'common.back': 'Volver',
    'session.ended': 'Su sesión ha terminado. Inicie sesión de nuevo.',
    'lang.en': 'English',
    'lang.es': 'Español',
  },
};

let uiLang = localStorage.getItem('tmsLang') === 'es' ? 'es' : 'en';

function t(key) {
  const pack = I18N[uiLang] || I18N.en;
  return pack[key] || I18N.en[key] || key;
}

function langSwitcherHtml(compact) {
  const cls = compact ? 'lang-switch lang-switch--compact' : 'lang-switch';
  return `<div class="${cls}" role="group" aria-label="${esc(t('login.lang'))}">
    <button type="button" class="lang-btn ${uiLang === 'en' ? 'on' : ''}" data-lang="en">${esc(t('lang.en'))}</button>
    <button type="button" class="lang-btn ${uiLang === 'es' ? 'on' : ''}" data-lang="es">${esc(t('lang.es'))}</button>
  </div>`;
}

function bindLangSwitcher(root, onChange) {
  const scope = root || document;
  scope.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.onclick = () => {
      const next = btn.getAttribute('data-lang') === 'es' ? 'es' : 'en';
      if (next === uiLang) return;
      setUiLang(next);
      if (typeof onChange === 'function') onChange();
    };
  });
}

function setUiLang(next) {
  uiLang = next === 'es' ? 'es' : 'en';
  localStorage.setItem('tmsLang', uiLang);
  document.documentElement.lang = uiLang;
  applyStaticI18n();
}

function applyStaticI18n() {
  document.documentElement.lang = uiLang;
  const map = [
    ['#brandH1', 'brand.h1'],
    ['#brandTag', 'brand.tag'],
    ['#rolePickLabel', 'nav.role'],
    ['#securityMfa', 'nav.security'],
    ['#changePassword', 'nav.changePassword'],
    ['#signout', 'nav.signOut'],
    ['#authAsideKicker', 'auth.kicker'],
    ['#authAsideLead', 'auth.lead'],
    ['#authAsideSub', 'auth.sub'],
  ];
  for (const [sel, key] of map) {
    const el = document.querySelector(sel);
    if (el) el.textContent = t(key);
  }
  const roleSel = document.getElementById('role');
  if (roleSel) {
    const th = roleSel.querySelector('option[value="therapist"]');
    const ad = roleSel.querySelector('option[value="admin"]');
    if (th) th.textContent = t('nav.therapist');
    if (ad) ad.textContent = t('nav.admin');
  }
  const adminNav = {
    dash: 'nav.dash',
    children: 'nav.children',
    providers: 'nav.providers',
    mandates: 'nav.mandates',
    schools: 'nav.schools',
    admins: 'nav.admins',
    reports: 'nav.reports',
  };
  document.querySelectorAll('#adminNav [data-admin]').forEach((btn) => {
    const screen = btn.getAttribute('data-admin');
    const key = adminNav[screen];
    if (!key) return;
    if (screen === 'schools') {
      const badge = document.getElementById('schoolsSetupBadge');
      const count = badge && !badge.hidden ? badge.textContent : '';
      const hidden = !badge || badge.hidden;
      btn.innerHTML = `${esc(t(key))} <span id="schoolsSetupBadge" class="nav-alert-badge"${hidden ? ' hidden' : ''}>${esc(count || '')}</span>`;
    } else {
      btn.textContent = t(key);
    }
  });
  const headerLang = document.getElementById('headerLang');
  if (headerLang) {
    headerLang.innerHTML = langSwitcherHtml(true);
    bindLangSwitcher(headerLang, () => {
      if (document.body.classList.contains('is-auth') && document.getElementById('loginBtn')) {
        const msg = document.getElementById('loginErr')?.textContent || '';
        showLogin(msg);
        return;
      }
      if (document.body.classList.contains('is-app') && state.idToken) {
        const sec = document.getElementById('mfaAddMethods') || document.getElementById('mfaEnrollTotp');
        if (sec) {
          showSecurityMfa();
          return;
        }
        showRole();
      }
    });
  }
}

function mondayIso() {
  const d = new Date();
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

/** Normalize MM/DD/YYYY or YYYY-MM-DD to YYYY-MM-DD for range compares. */
function dosToIso(dos) {
  const s = String(dos || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const md = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!md) return '';
  let y = Number(md[3]);
  if (y < 100) y += 2000;
  const m = String(Number(md[1])).padStart(2, '0');
  const d = String(Number(md[2])).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Inclusive From/To filter; HTML date inputs are ISO, session DOS is usually MM/DD/YYYY. */
function sessionDosInRange(dateOfService, fromIso, toIso) {
  if (!fromIso && !toIso) return true;
  const iso = dosToIso(dateOfService);
  if (!iso) return false;
  if (fromIso && iso < fromIso) return false;
  if (toIso && iso > toIso) return false;
  return true;
}

function mondayFromDos(dos) {
  const s = String(dos || '').trim();
  let d;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const md = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (iso) d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  else if (md) {
    let y = Number(md[3]);
    if (y < 100) y += 2000;
    d = new Date(Date.UTC(y, Number(md[1]) - 1, Number(md[2])));
  } else return '';
  const day = d.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function downloadReportXlsx(path, filename) {
  const res = await fetch(API + path, { method: 'GET', headers: headers() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Unable to export ${filename}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function headers(opts = {}) {
  const base = { 'content-type': 'application/json' };
  if (opts.anonymous) return base;
  if (COGNITO_MODE) {
    const token = String(state.idToken || '').trim();
    if (!token) return base;
    return {
      ...base,
      authorization: `Bearer ${token}`,
    };
  }
  return {
    ...base,
    'x-tms-role': state.role,
    'x-tms-email': state.role === 'admin' ? 'admin@whiteglove.local' : 'therapist@whiteglove.local',
  };
}

function issueListFromPayload(data) {
  const fromArr = Array.isArray(data?.errors)
    ? data.errors
        .map((e) => (typeof e === 'string' ? e : e?.message || e?.problem || JSON.stringify(e)))
        .map((s) => String(s || '').trim())
        .filter(Boolean)
    : [];
  const warnArr = Array.isArray(data?.warnings)
    ? data.warnings.map((w) => String(w || '').trim()).filter(Boolean)
    : [];
  const base = String(data?.error || data?.message || '').trim();
  const errors = fromArr.length ? fromArr : base ? [base] : [];
  return { errors, warnings: warnArr, summary: base || errors[0] || '' };
}

function apiError(message, extras = {}) {
  const err = new Error(message || 'The request could not be completed.');
  err.errors = Array.isArray(extras.errors) ? extras.errors : [];
  err.warnings = Array.isArray(extras.warnings) ? extras.warnings : [];
  err.status = extras.status;
  return err;
}

async function api(method, path, body, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 0;
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: headers({ anonymous: Boolean(opts.anonymous) }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw apiError(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s. Check your connection and try again.`,
      );
    }
    throw apiError(
      'Unable to reach the server. If you use NetFree, route traffic through the /api proxy, then refresh.',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401 && COGNITO_MODE && !opts.anonymous && !opts.skipAuthSignOut) {
    signOut('Your session has ended. Please sign in again.');
    throw apiError('Please sign in again.', { status: 401 });
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('pdf') ? await res.blob() : await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 207)) {
    const { errors, warnings, summary } = issueListFromPayload(data);
    const msg =
      summary ||
      (res.statusText && res.statusText !== 'Bad Request' ? res.statusText : '') ||
      `Request failed (${res.status}). Review the error details under Import.`;
    throw apiError(msg, { errors, warnings, status: res.status });
  }
  return data;
}

function lunaApiOpts() {
  const signedIn = Boolean(COGNITO_MODE ? String(state.idToken || '').trim() : state.role);
  return signedIn ? {} : { anonymous: true, skipAuthSignOut: true };
}

function clearUploadIssues() {
  const el = document.getElementById('uploadIssues');
  if (el) {
    el.hidden = true;
    el.innerHTML = '';
  }
  const adminEl = document.getElementById('pUploadIssues');
  if (adminEl) {
    adminEl.hidden = true;
    adminEl.innerHTML = '';
  }
}

function uploadIssueHost() {
  return document.getElementById('uploadIssues') || document.getElementById('pUploadIssues');
}

function splitFailedBySeverity(failed, extraWarnings) {
  const reds = [];
  const yellows = [...(extraWarnings || [])].map((w) => String(w || '').trim()).filter(Boolean);
  for (const f of failed || []) {
    if (f && typeof f === 'object' && String(f.severity || '') === 'warn') {
      const t = String(f.error || f.message || '').trim();
      if (t) yellows.push(t);
      continue;
    }
    const t = typeof f === 'string' ? f : String(f?.error || f?.message || '').trim();
    if (t) reds.push(t);
  }
  return {
    reds: [...new Set(reds)],
    yellows: [...new Set(yellows.filter((w) => !reds.includes(w)))],
  };
}

function setUploadIssues(errors, warnings, successes) {
  const el = uploadIssueHost();
  if (!el) return;
  const errs = (errors || []).map((e) => String(e || '').trim()).filter(Boolean);
  const warns = (warnings || []).map((w) => String(w || '').trim()).filter(Boolean);
  const oks = (successes || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!errs.length && !warns.length && !oks.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = [
    `<div class="dismissible-toolbar">
      <button type="button" class="btn status-clear-btn" data-clear-upload-issues>Clear</button>
    </div>`,
    oks.length
      ? `<div class="ok-box upload-issue-block status-banner"><button type="button" class="status-banner-dismiss" data-clear-upload-issues aria-label="Clear upload results">×</button><strong>Saved</strong>${oks
          .map((s) => `<div class="upload-issue-line">${esc(s)}</div>`)
          .join('')}</div>`
      : '',
    errs.length
      ? `<div class="err-box upload-issue-block status-banner"><button type="button" class="status-banner-dismiss" data-clear-upload-issues aria-label="Clear upload issues">×</button><strong>${oks.length ? 'Failed sessions' : 'Upload issues'}</strong>${errs
          .map((e) => `<div class="upload-issue-line">${esc(e)}</div>`)
          .join('')}</div>`
      : '',
    warns.length
      ? `<div class="warn-box upload-issue-block status-banner"><button type="button" class="status-banner-dismiss" data-clear-upload-issues aria-label="Clear warnings">×</button><strong>Warnings</strong>${warns
          .map((w) => `<div class="upload-issue-line">${esc(w)}</div>`)
          .join('')}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');
  el.querySelectorAll('[data-clear-upload-issues]').forEach((btn) => {
    btn.onclick = () => {
      clearUploadIssues();
      clearStatus();
    };
  });
}

function openingAccountView() {
  view(`
    <div class="card">
      <h2>Loading your account…</h2>
      <p>One moment, please.</p>
    </div>
  `);
}

function homeLoadErrorView(err) {
  view(`
    <div class="card">
      <h2>Unable to load</h2>
      <div class="err-box">${esc(err?.message || 'An unexpected error occurred.')}</div>
      <button type="button" class="btn-primary" id="retryHome">Retry</button>
    </div>
  `);
  document.getElementById('retryHome').onclick = () => {
    showRole();
  };
}

function normalizeStatusKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'ok' || k === 'success') return 'success';
  if (k === 'err' || k === 'error') return 'error';
  if (k === 'warn' || k === 'warning') return 'warn';
  return '';
}

function clearStatus() {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = '';
  el.className = '';
}

/** Top status: green success / red error / yellow warn chips. */
function setStatus(msgOrItems, kind) {
  const el = document.getElementById('status');
  if (!el) return;
  const items = [];
  const push = (text, k) => {
    const t = String(text || '').trim();
    if (!t) return;
    items.push({ text: t, kind: normalizeStatusKind(k) });
  };

  if (Array.isArray(msgOrItems)) {
    for (const it of msgOrItems) {
      if (typeof it === 'string') push(it, kind);
      else if (it && typeof it === 'object') push(it.text || it.message, it.kind || kind);
    }
  } else if (
    msgOrItems &&
    typeof msgOrItems === 'object' &&
    (msgOrItems.success ||
      msgOrItems.error ||
      msgOrItems.warn ||
      msgOrItems.ok ||
      msgOrItems.err ||
      msgOrItems.warnings ||
      msgOrItems.errors)
  ) {
    for (const t of msgOrItems.success || msgOrItems.ok || []) push(t, 'success');
    for (const t of msgOrItems.error || msgOrItems.err || msgOrItems.errors || []) push(t, 'error');
    for (const t of msgOrItems.warn || msgOrItems.warnings || []) push(t, 'warn');
  } else {
    push(msgOrItems, kind);
  }

  if (!items.length) {
    clearStatus();
    return;
  }
  el.className = 'status-stack';
  el.innerHTML = `${items
    .map((it) => `<span class="status-chip ${it.kind || 'neutral'}">${esc(it.text)}</span>`)
    .join('')}
    <button type="button" class="status-clear-btn" id="clearStatusBtn" aria-label="Clear status messages">Clear</button>`;
  document.getElementById('clearStatusBtn')?.addEventListener('click', () => clearStatus());
}

/** Week top summary: optional flash successes + red errors + yellow warnings. */
function setWeekTopStatus({ success = [], error = [], warn = [] } = {}) {
  setStatus({ success, error, warn });
}

/** Bring top status chips into view — Send lives at the bottom of a long page. */
function revealStatus() {
  const el = document.getElementById('status');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

let actionToastTimer = 0;
function clearActionToast() {
  const el = document.getElementById('actionToast');
  if (actionToastTimer) clearTimeout(actionToastTimer);
  actionToastTimer = 0;
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
  el.className = 'action-toast';
}

/** Transient UI (import banners, toasts, top chips) — not server-side week validation. */
function clearTransientErrors() {
  clearStatus();
  clearActionToast();
  clearUploadIssues();
}

/** Fixed toast so Send feedback is visible without scrolling to the top status bar. */
function showActionToast(message, kind = 'neutral', { sticky = false } = {}) {
  let el = document.getElementById('actionToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'actionToast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  const text = String(message || '').trim();
  if (!text) {
    clearActionToast();
    return;
  }
  el.hidden = false;
  el.className = `action-toast ${normalizeStatusKind(kind) || 'neutral'}`;
  el.innerHTML = `<span class="action-toast-text">${esc(text)}</span><button type="button" class="action-toast-dismiss" aria-label="Dismiss">×</button>`;
  el.querySelector('.action-toast-dismiss')?.addEventListener('click', () => clearActionToast());
  if (actionToastTimer) clearTimeout(actionToastTimer);
  actionToastTimer = 0;
  if (!sticky) {
    actionToastTimer = setTimeout(() => {
      clearActionToast();
    }, kind === 'error' || kind === 'err' ? 10000 : 7000);
  }
}

function timesheetSendBlockReason({ week, sessions, locked, errors, signerEmail }) {
  if (locked) return 'This school\'s timesheet for the week is already submitted and cannot be sent again. Choose a different school/signer to send another timesheet for the same week.';
  if (!week) return 'Your provider profile is not ready yet. Contact the office.';
  if (!sessions.length) return 'Add at least one session before submitting.';
  if (errors.length) {
    return 'Resolve the red blocking issues above before submitting.';
  }
  if (!String(signerEmail || '').trim()) {
    return 'No school signer is on file. Contact the office to assign a signer.';
  }
  return '';
}

function view(html) {
  document.getElementById('view').innerHTML = html;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/** Checkbox column header (select all) for bulk delete tables. */
function bulkTh(group) {
  return `<th class="bulk-col"><input type="checkbox" data-bulk-all="${esc(group)}" aria-label="Select all" /></th>`;
}

/** Row checkbox. Pass extraAttrs e.g. ` data-bulk-kind="user"`. */
function bulkTd(group, id, extraAttrs = '') {
  return `<td class="bulk-col"><input type="checkbox" data-bulk-group="${esc(group)}" data-bulk-id="${esc(id)}"${extraAttrs} /></td>`;
}

function bulkTdEmpty() {
  return `<td class="bulk-col"></td>`;
}

/** Hidden until ≥1 row checked. */
function bulkBar(group) {
  return `<div class="bulk-bar" data-bulk-bar="${esc(group)}" hidden>
    <button type="button" class="btn" data-bulk-delete="${esc(group)}">Delete selected</button>
    <span class="muted" data-bulk-count="${esc(group)}"></span>
  </div>`;
}

function selectedBulkEls(group) {
  return [...document.querySelectorAll(`input[data-bulk-group="${group}"]:checked`)];
}

function syncBulkBar(group) {
  const bar = document.querySelector(`[data-bulk-bar="${group}"]`);
  const els = selectedBulkEls(group);
  const n = els.length;
  if (bar) bar.hidden = n < 1;
  const count = document.querySelector(`[data-bulk-count="${group}"]`);
  if (count) count.textContent = n ? `${n} selected` : '';
  const all = document.querySelector(`input[data-bulk-all="${group}"]`);
  if (all) {
    const boxes = [...document.querySelectorAll(`input[data-bulk-group="${group}"]`)];
    const checked = boxes.filter((b) => b.checked).length;
    all.checked = boxes.length > 0 && checked === boxes.length;
    all.indeterminate = checked > 0 && checked < boxes.length;
  }
}

function confirmBulkDelete(n, noun) {
  if (!confirm(`Delete ${n} selected ${noun}? This cannot be undone.`)) return false;
  if (!confirm(`Permanently delete ${n} items? This cannot be reversed.`)) return false;
  return true;
}

/**
 * Wire select-all + Delete selected for a bulk group.
 * deleteOne(id, checkboxEl) should call the existing per-id DELETE API.
 */
function bindBulkDelete(group, { noun, deleteOne, refresh }) {
  const all = document.querySelector(`input[data-bulk-all="${group}"]`);
  if (all) {
    all.addEventListener('change', () => {
      document.querySelectorAll(`input[data-bulk-group="${group}"]`).forEach((cb) => {
        cb.checked = all.checked;
      });
      syncBulkBar(group);
    });
  }
  document.querySelectorAll(`input[data-bulk-group="${group}"]`).forEach((cb) => {
    cb.addEventListener('change', () => syncBulkBar(group));
  });
  const btn = document.querySelector(`[data-bulk-delete="${group}"]`);
  if (btn) {
    btn.addEventListener('click', async () => {
      const els = selectedBulkEls(group);
      if (!els.length) return;
      if (!confirmBulkDelete(els.length, noun)) return;
      try {
        const errors = [];
        let ok = 0;
        for (const el of els) {
          const id = el.getAttribute('data-bulk-id');
          try {
            await deleteOne(id, el);
            ok += 1;
          } catch (e) {
            errors.push(e.message || String(e));
          }
        }
        if (errors.length) {
          setStatus(
            `Removed ${ok}. ${errors.length} could not be removed: ${errors[0]}`,
            ok === 0 ? 'err' : 'warn',
          );
        } else {
          setStatus(`Removed ${ok} ${noun}.`, 'ok');
        }
        await refresh();
      } catch (e) {
        setStatus(e.message, 'err');
      }
    });
  }
  syncBulkBar(group);
}

function readPayRatesFromIds(ids) {
  const num = (id) => {
    const raw = document.getElementById(id)?.value?.trim?.() ?? '';
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return {
    payRate30Min: num(ids.min30),
    payRate42Min: num(ids.min42),
    payRate45Min: num(ids.min45),
    payRatePerHour: num(ids.hour),
    payRateGroup30Min: num(ids.g30),
    payRateGroup42Min: num(ids.g42),
    payRateGroup45Min: num(ids.g45),
    payRateEval: num(ids.eval),
    payRateAdditionalHourly: num(ids.extra),
  };
}

function payRatesFieldset(p, prefix) {
  const v = (k) => esc(p?.[k] ?? '');
  return `<fieldset class="pay-rates">
        <legend>Pay rates</legend>
        <div class="row">
          <label>30 min session <input id="${prefix}30" type="number" step="0.01" min="0" value="${v('payRate30Min')}" /></label>
          <label>42 min session <input id="${prefix}42" type="number" step="0.01" min="0" value="${v('payRate42Min')}" /></label>
        </div>
        <div class="row">
          <label>45 min session <input id="${prefix}45" type="number" step="0.01" min="0" value="${v('payRate45Min')}" /></label>
          <label>Hourly session <input id="${prefix}Hour" type="number" step="0.01" min="0" value="${v('payRatePerHour')}" /></label>
        </div>
        <div class="row">
          <label>Group 30 min <input id="${prefix}G30" type="number" step="0.01" min="0" value="${v('payRateGroup30Min')}" /></label>
          <label>Group 42 min <input id="${prefix}G42" type="number" step="0.01" min="0" value="${v('payRateGroup42Min')}" /></label>
        </div>
        <div class="row">
          <label>Group 45 min <input id="${prefix}G45" type="number" step="0.01" min="0" value="${v('payRateGroup45Min')}" /></label>
          <label>Eval <input id="${prefix}Eval" type="number" step="0.01" min="0" value="${v('payRateEval')}" /></label>
        </div>
        <div class="row">
          <label>Additional services (hourly, billed by the minute) <input id="${prefix}Extra" type="number" step="0.01" min="0" value="${v('payRateAdditionalHourly')}" /></label>
        </div>
      </fieldset>`;
}

const ADDITIONAL_SERVICE_LABELS = {
  eval: 'Eval',
  progress_report: 'Progress report',
  consultation: 'Consultation',
  meetings: 'Meetings',
  paid_absence: 'Paid absence',
};

function additionalServiceOptions(selected) {
  return ['eval', 'progress_report', 'consultation', 'meetings', 'paid_absence']
    .map((v) => `<option value="${v}"${selected === v ? ' selected' : ''}>${esc(ADDITIONAL_SERVICE_LABELS[v])}</option>`)
    .join('');
}

function additionalServiceLabel(value) {
  if (!value) return '';
  return ADDITIONAL_SERVICE_LABELS[value] || String(value);
}

function studentOptions(students, selected) {
  const sorted = [...(students || [])].sort((a, b) => {
    const la = `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.id;
    const lb = `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.id;
    return la.localeCompare(lb);
  });
  return `<option value="">Select a student</option>${sorted.map((s) => {
    const id = s.id;
    const label = `${s.firstName || ''} ${s.lastName || ''}`.trim() || id;
    return `<option value="${esc(id)}"${id === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('')}`;
}

function providerOptions(providers, selected) {
  const sorted = [...(providers || [])].sort((a, b) => {
    const la = `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.id;
    const lb = `${b.firstName || ''} ${b.lastName || ''}`.trim() || b.id;
    return la.localeCompare(lb);
  });
  return `<option value="">Select a provider</option>${sorted.map((p) => {
    const label = `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.id;
    return `<option value="${esc(p.id)}"${p.id === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('')}`;
}

function schoolOptions(schools, selected) {
  return `<option value="">Select a school</option>${(schools || []).map((s) =>
    `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.name || s.id)}</option>`,
  ).join('')}`;
}

function formatIsoDateLabel(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '—';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatCalendarSummary(calendar) {
  if (!calendar?.yearStart || !calendar?.yearEnd) return '';
  const n = (calendar.offDays || []).length;
  const offLabel = n === 1 ? '1 off day' : `${n} off days`;
  return `${formatIsoDateLabel(calendar.yearStart)} – ${formatIsoDateLabel(calendar.yearEnd)}, ${offLabel}`;
}

function schoolHasAddress(school) {
  return Boolean(
    String(school?.address1 || '').trim() &&
      String(school?.city || '').trim() &&
      String(school?.state || '').trim() &&
      String(school?.zipCode || '').trim(),
  );
}

function schoolCalendarConfigured(calendar) {
  if (!calendar) return false;
  if (String(calendar.yearStart || '').trim()) return true;
  if (String(calendar.yearEnd || '').trim()) return true;
  return (calendar.offDays || []).some((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '').trim()));
}

/** Prefer API setupBySchoolId; fall back to local calendar + address checks. */
function schoolSetupFromApi(school, calendar, setupEntry) {
  if (setupEntry) {
    return {
      incomplete: Boolean(setupEntry.incomplete),
      missingCalendar: Boolean(setupEntry.missingCalendar),
      missingAddress: Boolean(setupEntry.missingAddress),
      message: String(setupEntry.message || ''),
    };
  }
  const missingCalendar = !schoolCalendarConfigured(calendar);
  const missingAddress = !schoolHasAddress(school);
  const parts = [];
  if (missingCalendar) parts.push('calendar');
  if (missingAddress) parts.push('address');
  const name = String(school?.name || '').trim() || 'This school';
  let message = '';
  if (parts.length === 2) {
    message = `${name} needs a calendar and address before HHA patient create and school-day mandate tracking are complete.`;
  } else if (missingCalendar) {
    message = `${name} needs a school calendar (first/last day and off days).`;
  } else if (missingAddress) {
    message = `${name} needs a full address (street, city, state, zip) for HHA CreatePatient.`;
  }
  return {
    incomplete: parts.length > 0,
    missingCalendar,
    missingAddress,
    message,
  };
}

function updateSchoolsSetupBadge(count) {
  const badge = document.getElementById('schoolsSetupBadge');
  if (!badge) return;
  const n = Number(count) || 0;
  if (n <= 0) {
    badge.hidden = true;
    badge.textContent = '';
    return;
  }
  badge.hidden = false;
  badge.textContent = String(n);
  badge.title = n === 1
    ? '1 school needs calendar and/or address'
    : `${n} schools need calendar and/or address`;
}

async function refreshSchoolsSetupBadge() {
  try {
    const out = await api('GET', '/admin/schools');
    const schools = out.schools || [];
    const calendarsBySchoolId = out.calendarsBySchoolId || {};
    const setupBySchoolId = out.setupBySchoolId || {};
    const incomplete = schools.filter((s) =>
      schoolSetupFromApi(s, calendarsBySchoolId[s.id], setupBySchoolId[s.id]).incomplete,
    );
    updateSchoolsSetupBadge(incomplete.length);
  } catch {
    /* ignore badge refresh failures */
  }
}

function renderCalendarSavedHtml(calendar, schoolName) {
  const name = schoolName ? ` for ${esc(schoolName)}` : '';
  if (!calendar?.yearStart && !calendar?.yearEnd && !(calendar?.offDays || []).length) {
    return `<div class="cal-saved muted"><p>No calendar saved yet${name}. Enter the first day, last day, and off days below, then save.</p></div>`;
  }
  const offs = [...(calendar.offDays || [])].sort();
  const offList = offs.length
    ? `<ul class="cal-off-summary">${offs.map((d) => `<li>${esc(formatIsoDateLabel(d))} <span class="muted">(${esc(d)})</span></li>`).join('')}</ul>`
    : '<p class="muted">No off days recorded.</p>';
  return `<div class="cal-saved">
    <h3>Saved calendar${name}</h3>
    <p><strong>First day:</strong> ${esc(calendar.yearStart ? formatIsoDateLabel(calendar.yearStart) : '—')} ${calendar.yearStart ? `<span class="muted">(${esc(calendar.yearStart)})</span>` : ''}</p>
    <p><strong>Last day:</strong> ${esc(calendar.yearEnd ? formatIsoDateLabel(calendar.yearEnd) : '—')} ${calendar.yearEnd ? `<span class="muted">(${esc(calendar.yearEnd)})</span>` : ''}</p>
    <p><strong>Off days (${offs.length}):</strong></p>
    ${offList}
  </div>`;
}

async function fileToBase64(file) {
  if (!file) return '';
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function studentName(students, id, fallback) {
  const st = (students || []).find((x) => x.id === id);
  if (st) return `${st.firstName} ${st.lastName}`.trim();
  const named = String(fallback || '').trim();
  return named || id;
}

function therapistScopeQuery() {
  const q = new URLSearchParams();
  if (state.selectedProgramType) q.set('programType', state.selectedProgramType);
  return q;
}

function childNameLink(studentId, label) {
  const id = String(studentId || '').trim();
  const text = String(label || '').trim() || id || '—';
  if (!id) return esc(text);
  return `<button type="button" class="linkish" data-open-child="${esc(id)}">${esc(text)}</button>`;
}

function providerNameLink(providerId, label) {
  const id = String(providerId || '').trim();
  const text = String(label || '').trim() || id || '—';
  if (!id) return esc(text);
  return `<button type="button" class="linkish" data-open-provider="${esc(id)}">${esc(text)}</button>`;
}

function mandateFreqLabel(m) {
  if (m?.freqDisplay) return m.freqDisplay;
  const kind =
    m?.frequencyKind === 'school_day_cycle'
      ? 'school_day_cycle'
      : m?.frequencyKind === 'monthly'
        ? 'monthly'
        : 'weekly';
  const n = m?.sessionsPerPeriod ?? m?.frequencyPerWeek;
  if (n == null || n === '') return '—';
  if (kind === 'school_day_cycle') return `${n} / ${m?.periodSchoolDays || 6} school days`;
  if (kind === 'monthly') return `${n} / month`;
  return `${n} / week`;
}

/** Type dropdown: Weekly / 6-Day / Monthly / Makeup auth (old Madison UX). */
function mandateTypeOptions(selected) {
  const cur = String(selected || 'weekly');
  return [
    ['weekly', 'Weekly'],
    ['school_day_cycle', '6-Day Cycle'],
    ['monthly', 'Monthly'],
    ['makeup_auth', 'Makeup auth'],
  ]
    .map(([v, label]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${label}</option>`)
    .join('');
}

/** Map Type select → mandateKind + frequencyKind. */
function parseMandateTypeValue(typeVal) {
  const v = String(typeVal || 'weekly');
  if (v === 'makeup_auth') return { mandateKind: 'makeup_auth', frequencyKind: 'weekly' };
  if (v === 'school_day_cycle' || v === 'monthly') return { mandateKind: 'regular', frequencyKind: v };
  return { mandateKind: 'regular', frequencyKind: 'weekly' };
}

function mandateTypeValueFromMandate(m) {
  if (m?.mandateKind === 'makeup_auth') return 'makeup_auth';
  if (m?.frequencyKind === 'school_day_cycle') return 'school_day_cycle';
  if (m?.frequencyKind === 'monthly') return 'monthly';
  return 'weekly';
}

function bindMandateEditor(opts) {
  const { mandates, providers, students, onSaved, panelId = 'editMandatePanel' } = opts;
  document.querySelectorAll('[data-edit-mandate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-mandate');
      const m = (mandates || []).find((x) => x.id === id);
      const panel = document.getElementById(panelId);
      if (!m || !panel) return;
      const typeVal = mandateTypeValueFromMandate(m);
      panel.hidden = false;
      panel.innerHTML = `
        <h3>Edit mandate</h3>
        <div class="row">
          <label>Student
            <select id="emStudent">${studentOptions(students || [], m.studentId)}</select>
          </label>
          <label>Provider
            <select id="emProvider">${providerOptions(providers || [], m.providerId)}</select>
          </label>
        </div>
        <div class="row">
          <label>Service type <input id="emService" value="${esc(m.serviceType || '')}" /></label>
          <label>Type
            <select id="emKind">${mandateTypeOptions(typeVal)}</select>
          </label>
        </div>
        <div class="row">
          <label>Ratio
            <select id="emRatio">
              <option value="individual"${!m.ratioGroup ? ' selected' : ''}>Individual</option>
              <option value="group"${m.ratioGroup ? ' selected' : ''}>Group</option>
            </select>
          </label>
          <label>Group size <input id="emGroupSize" type="number" min="1" step="1" value="${esc(m.groupSize != null && m.groupSize !== '' ? m.groupSize : (mandateLooksGroupUi(m) ? 2 : 1))}" /></label>
        </div>
        <div class="row">
          <label>Duration (minutes) <input id="emDuration" type="number" min="1" step="1" value="${esc(m.durationMinutes ?? '')}" /></label>
          <label>Freq / count <input id="emFreq" type="number" min="0" step="1" value="${esc(m.sessionsPerPeriod ?? m.frequencyPerWeek ?? '')}" /></label>
        </div>
        <div class="row">
          <label>Start / end
            <div class="row">
              <input id="emStart" type="date" value="${esc(m.startOn || '')}" />
              <input id="emEnd" type="date" value="${esc(m.endOn || '')}" />
            </div>
          </label>
        </div>
        <div class="entry-form-actions">
          <button type="button" class="btn-primary" id="emSave">Save changes</button>
          <button type="button" class="btn" id="emCancel">Cancel</button>
        </div>
      `;
      document.getElementById('emCancel').onclick = () => {
        panel.hidden = true;
        panel.innerHTML = '';
      };
      document.getElementById('emSave').onclick = async () => {
        try {
          const freq = Number(document.getElementById('emFreq').value);
          const durationRaw = document.getElementById('emDuration').value;
          const groupSizeRaw = document.getElementById('emGroupSize').value;
          const { mandateKind, frequencyKind } = parseMandateTypeValue(document.getElementById('emKind').value);
          const ratioGroup = document.getElementById('emRatio').value === 'group';
          const groupSize = groupSizeRaw === '' ? (ratioGroup ? 2 : 1) : Number(groupSizeRaw);
          await api('PATCH', `/admin/mandates/${id}`, {
            studentId: document.getElementById('emStudent').value,
            providerId: document.getElementById('emProvider').value,
            serviceType: document.getElementById('emService').value,
            mandateKind,
            ratioGroup,
            durationMinutes: durationRaw === '' ? null : Number(durationRaw),
            groupSize,
            frequencyKind,
            frequencyPerWeek: freq,
            sessionsPerPeriod: freq,
            periodSchoolDays: frequencyKind === 'school_day_cycle' ? 6 : undefined,
            startOn: document.getElementById('emStart').value,
            endOn: document.getElementById('emEnd').value,
          });
          setStatus('Mandate updated.', 'ok');
          await onSaved();
        } catch (e) { setStatus(e.message, 'err'); }
      };
    });
  });
}

function mandateDurationLabel(m) {
  const n = m?.durationMinutes;
  if (n == null || n === '') return '—';
  return `${n} min`;
}

/** True when mandate is group (ratio flag, size > 1, or Group / Small Group in service text). */
function mandateLooksGroupUi(m) {
  if (m?.ratioGroup) return true;
  const n = m?.groupSize;
  if (n != null && n !== '' && Number.isFinite(Number(n)) && Number(n) > 1) return true;
  const blob = `${m?.serviceType || ''} ${m?.ratioLabel || ''}`;
  return /\bgroup\b|\b2\s*:\s*1\b|\b3\s*:\s*1\b|\b4\s*:\s*1\b/i.test(blob);
}

function mandateGroupSizeLabel(m) {
  const n = m?.groupSize;
  if (n != null && n !== '' && Number.isFinite(Number(n)) && Number(n) > 0) return String(Math.round(Number(n)));
  // Legacy Group / Small Group imports stored null; overlap + import + load backfill default to 2.
  if (mandateLooksGroupUi(m)) return '2';
  return '—';
}

function bindOpenChildLinks(opts = {}) {
  document.querySelectorAll('[data-open-child]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-open-child');
      if (id) {
        state.childDetailTab = 'basic';
        sessionStorage.setItem('tmsChildDetailTab', 'basic');
        adminChildDetail(id, opts);
      }
    });
  });
}

function bindOpenProviderLinks() {
  document.querySelectorAll('[data-open-provider]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-open-provider');
      if (id) {
        state.providerDetailTab = 'basic';
        sessionStorage.setItem('tmsProviderDetailTab', 'basic');
        adminProviderDetail(id);
      }
    });
  });
}

function sessionExtraLabel(s) {
  const bits = [];
  const addl = additionalServiceLabel(s?.additionalServiceType);
  if (addl) bits.push(addl);
  else if (s?.serviceType) bits.push(String(s.serviceType));
  if (s?.location) bits.push(String(s.location));
  if (s?.cancelReason) bits.push(`Cancel: ${s.cancelReason}`);
  return bits.join(' · ');
}

function closeTimesheetModal() {
  const modal = document.getElementById('timesheetModal');
  if (modal) {
    const blobUrl = modal.dataset.timesheetBlobUrl || '';
    if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
    modal.querySelectorAll('iframe[src^="blob:"]').forEach((frame) => {
      const src = frame.getAttribute('src') || '';
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    });
    modal.remove();
  }
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === '1') resolve();
      else existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Unable to load ${src}`)), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.dataset.src = src;
    s.onload = () => {
      s.dataset.loaded = '1';
      resolve();
    };
    s.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensurePdfJs() {
  const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'] || null;
  if (lib?.getDocument) {
    if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
    return lib;
  }
  await loadScriptOnce('vendor/pdf.min.js');
  const loaded = window.pdfjsLib;
  if (!loaded?.getDocument) throw new Error('PDF viewer failed to load.');
  loaded.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  return loaded;
}

async function renderTimesheetPdfPages(host, pdfBlob) {
  const pdfjsLib = await ensurePdfJs();
  const data = new Uint8Array(await pdfBlob.arrayBuffer());
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise;
  } catch {
    pdf = await pdfjsLib.getDocument({ data, verbosity: 0, disableWorker: true }).promise;
  }
  host.innerHTML = '';
  const maxWidth = Math.max(320, Math.floor(host.clientWidth || 980));
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maxWidth / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.className = 'timesheet-pdf-page';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.setAttribute('aria-label', `Timesheet page ${pageNum} of ${pdf.numPages}`);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    host.appendChild(canvas);
  }
}

function printTimesheetPdfBlob(url) {
  const frame = document.createElement('iframe');
  frame.className = 'timesheet-print-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.src = url;
  document.body.appendChild(frame);
  const cleanup = () => {
    try {
      frame.remove();
    } catch {
      /* ignore */
    }
  };
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
    setTimeout(cleanup, 60_000);
  };
  setTimeout(cleanup, 120_000);
}

async function openTimesheetModal(opts) {
  closeTimesheetModal();
  const {
    weekId = '',
    weekStart = '',
    providerName = '',
    status = '',
    signerName = '',
    signerEmail = '',
    schoolDistrict = '',
  } = opts || {};
  if (!weekId) {
    setStatus('Open a week before viewing the timesheet.', 'error');
    return;
  }
  const backdrop = document.createElement('div');
  backdrop.id = 'timesheetModal';
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Timesheet');
  const meta = [
    weekStart ? `Week of ${weekStart}` : '',
    providerName ? `Provider: ${providerName}` : '',
    schoolDistrict ? `District: ${schoolDistrict}` : '',
    status ? `Status: ${status}` : '',
    signerEmail || signerName
      ? `Signer: ${signerName || signerEmail}${signerEmail && signerName ? ` <${signerEmail}>` : ''}`
      : '',
  ].filter(Boolean);
  backdrop.innerHTML = `
    <div class="modal-panel timesheet-print timesheet-pdf-panel">
      <div class="modal-head">
        <h2>Timesheet</h2>
        <div class="modal-actions">
          <button type="button" class="btn" data-download-timesheet hidden>Download PDF</button>
          <button type="button" class="btn" data-print-timesheet hidden>Print</button>
          <button type="button" class="btn" data-close-timesheet>Close</button>
        </div>
      </div>
      ${meta.length ? `<p class="muted timesheet-pdf-meta">${meta.map((m) => esc(m)).join(' · ')}</p>` : ''}
      <p class="muted timesheet-pdf-hint">Same branded PDF that SignNow / email will send.</p>
      <div class="timesheet-pdf-loading muted">Loading branded timesheet…</div>
      <div class="timesheet-pdf-pages" hidden></div>
      <iframe class="timesheet-pdf-frame" title="Timesheet PDF fallback" hidden></iframe>
    </div>
  `;
  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeTimesheetModal();
  });
  backdrop.querySelector('[data-close-timesheet]').onclick = () => closeTimesheetModal();
  try {
    const q = state.selectedProgramType
      ? `?programType=${encodeURIComponent(state.selectedProgramType)}`
      : state.selectedSchoolId
        ? `?schoolId=${encodeURIComponent(state.selectedSchoolId)}`
        : '';
    const raw = await api('GET', `/weeks/${weekId}/timesheet${q}`);
    if (!(raw instanceof Blob)) {
      throw new Error('Timesheet PDF response was not a file.');
    }
    const blob = raw.type && raw.type.includes('pdf')
      ? raw
      : new Blob([await raw.arrayBuffer()], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    backdrop.dataset.timesheetBlobUrl = url;
    const loading = backdrop.querySelector('.timesheet-pdf-loading');
    const pages = backdrop.querySelector('.timesheet-pdf-pages');
    const frame = backdrop.querySelector('.timesheet-pdf-frame');
    const printBtn = backdrop.querySelector('[data-print-timesheet]');
    const downloadBtn = backdrop.querySelector('[data-download-timesheet]');
    printBtn.hidden = false;
    downloadBtn.hidden = false;
    downloadBtn.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = `timesheet-${weekStart || weekId}.pdf`;
      a.click();
    };
    printBtn.onclick = () => printTimesheetPdfBlob(url);
    try {
      await renderTimesheetPdfPages(pages, blob);
      pages.hidden = false;
      if (loading) loading.hidden = true;
    } catch (renderErr) {
      // Fallback: native PDF plugin in iframe / object (may be blank under NetFree).
      frame.src = `${url}#view=FitH`;
      frame.hidden = false;
      if (loading) {
        loading.textContent =
          renderErr?.message ||
          'Embedded page preview unavailable — use Print or Download for the full PDF.';
        loading.hidden = false;
        loading.classList.add('warn-box');
      }
    }
  } catch (err) {
    closeTimesheetModal();
    setStatus(err.message || 'Unable to load timesheet PDF.', 'error');
  }
}

async function fetchAndShowTimesheet({ weekId, weekStart, providerId, providerName, status, schoolId }) {
  const q = new URLSearchParams();
  if (weekStart) q.set('weekStart', weekStart);
  if (providerId) q.set('providerId', providerId);
  if (schoolId) q.set('schoolId', schoolId);
  else if (state.selectedProgramType) q.set('programType', state.selectedProgramType);
  else if (state.selectedSchoolId) q.set('schoolId', state.selectedSchoolId);
  const data = await api('GET', `/week?${q.toString()}`);
  const id = data.week?.id || weekId;
  await openTimesheetModal({
    weekId: id,
    weekStart: data.week?.weekStart || weekStart || '',
    providerName: providerName || '',
    status: data.week?.status || status || '',
    signerName: data.week?.signerName || '',
    signerEmail: data.week?.signerEmail || '',
    schoolDistrict: data.schoolDistrict || '',
  });
}

async function loadMissedOptions(studentId, selected) {
  const sel = document.getElementById('makeupOf');
  if (!sel) return;
  if (!studentId) {
    sel.innerHTML = '<option value="">None — apply makeup authorization if needed</option>';
    return;
  }
  try {
    const out = await api('GET', `/students/${studentId}/missed`);
    const missed = out.missed || [];
    sel.innerHTML = `<option value="">None — apply makeup authorization if needed</option>${missed.map((m) =>
      `<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc(m.dateOfService || m.id)}</option>`,
    ).join('')}`;
  } catch {
    sel.innerHTML = '<option value="">None — apply makeup authorization if needed</option>';
  }
}

function bindMakeupPickers() {
  const att = document.getElementById('att');
  const student = document.getElementById('studentId');
  const wrap = document.getElementById('makeupWrap');
  const makeupOf = document.getElementById('makeupOf');
  const notes = document.getElementById('notes');
  if (!att || !student || !wrap) return;
  const fillMakeupNote = () => {
    if (!notes || att.value !== 'makeup') return;
    let cur = notes.value || '';
    if (!/\bmakeup\b|\bmake[\s-]?up\b/i.test(cur)) {
      cur = `${cur ? `${cur.trim()} ` : ''}Makeup session`;
    }
    if (makeupOf?.value) {
      const date = makeupOf.selectedOptions[0]?.textContent?.trim() || '';
      if (date && !cur.includes(date)) {
        cur = `${cur.trim()} for missed session on ${date}`;
      }
    }
    notes.value = cur;
  };
  const sync = () => {
    wrap.hidden = att.value !== 'makeup';
    if (att.value === 'makeup') {
      loadMissedOptions(student.value).then(fillMakeupNote);
    }
  };
  att.onchange = sync;
  student.onchange = sync;
  if (makeupOf) makeupOf.onchange = fillMakeupNote;
  sync();
}

function weekApprovalLabel(status) {
  if (status === 'locked' || status === 'signed') {
    return {
      key: 'approved',
      title: 'Approved',
      detail: 'This timesheet is signed and locked. Payment will proceed.',
      box: 'ok-box',
    };
  }
  if (status === 'submitted') {
    return {
      key: 'pending',
      title: 'Pending',
      detail: 'Awaiting approval from the school signer or an administrator. Status becomes Approved once signed.',
      box: 'warn-box',
    };
  }
  if (status === 'reopened') {
    return {
      key: 'reopened',
      title: 'Revision required',
      detail: 'An administrator reopened this week. Revise it and resubmit the timesheet.',
      box: 'warn-box',
    };
  }
  return {
    key: 'draft',
    title: 'Not submitted',
    detail: 'Upload session notes or add sessions, then submit the timesheet.',
    box: 'warn-box',
  };
}

/** Hide approval status until week or status key changes (not forever). */
const dismissedApprovalBanners = new Set();

function approvalBanner(status) {
  const a = weekApprovalLabel(status);
  const key = `${state.weekStart}:${a.key}`;
  if (dismissedApprovalBanners.has(key)) return '';
  return `<div class="${a.box} status-banner" data-approval-key="${esc(key)}">
    <button type="button" class="status-banner-dismiss" id="dismissApprovalBanner" aria-label="Dismiss status">×</button>
    <strong>Status: ${esc(a.title)}</strong>
    <div>${esc(a.detail)}</div>
  </div>`;
}


function alphaLetterFromName(name) {
  const ch = String(name || '').trim().charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

function letterTabsHtml(active, letters) {
  const tabs = letters.length ? letters : ['#'];
  return `<div class="letter-tabs" role="tablist">${tabs
    .map(
      (L) =>
        `<button type="button" class="letter-tab${L === active ? ' on' : ''}" data-letter="${esc(L)}" role="tab" aria-selected="${L === active ? 'true' : 'false'}">${esc(L)}</button>`,
    )
    .join('')}</div>`;
}

/** Full A–Z (+ # when needed) so long admin lists are scannable without scrolling. */
function alphabetLettersForRows(rows, getName) {
  const present = new Set(rows.map((row) => alphaLetterFromName(getName(row))));
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((L) => present.has(L));
  if (present.has('#')) letters.push('#');
  return letters.length ? letters : ['A'];
}

function bindLetterTabs(getRows, getName) {
  const rows = [...getRows()];
  const letters = alphabetLettersForRows(rows, getName);
  if (!letters.includes(state.listTabLetter)) state.listTabLetter = letters[0] || 'A';
  const host = document.getElementById('listLetterTabs');
  if (host) host.innerHTML = letterTabsHtml(state.listTabLetter, letters);
  const apply = () => {
    getRows().forEach((row) => {
      row.hidden = alphaLetterFromName(getName(row)) !== state.listTabLetter;
    });
    document.querySelectorAll('#listLetterTabs .letter-tab').forEach((btn) => {
      const on = btn.getAttribute('data-letter') === state.listTabLetter;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  };
  document.querySelectorAll('#listLetterTabs .letter-tab').forEach((btn) => {
    btn.onclick = () => {
      state.listTabLetter = btn.getAttribute('data-letter') || 'A';
      apply();
    };
  });
  apply();
}

async function therapistHome(statusFlash) {
  clearActionToast();
  clearUploadIssues();
  let banner = '';
  let week = null;
  let sessions = [];
  let students = [];
  let errors = [];
  let warnings = [];
  let signerName = '';
  let signerEmail = '';
  let providerId = '';
  let schoolDistrict = '';
  let loadFailed = null;
  let schools = [];
  let programTypes = [];

  try {
    const me = await api('GET', '/me');
    providerId = me.provider?.id || '';
    schools = me.schools || [];
    programTypes = Array.isArray(me.programTypes) ? me.programTypes.filter(Boolean) : [];
    state.meSettings = me.settings || {};
    if (schools.length === 0 && programTypes.length === 0) {
      // Caseload has no schools — empty state only (never org-wide / other therapists).
      state.selectedSchoolId = '';
      state.schoolConfirmed = false;
      state.selectedProgramType = '';
      state.programConfirmed = false;
      sessionStorage.removeItem('tmsSchoolId');
      sessionStorage.removeItem('tmsSchoolConfirmed');
      sessionStorage.removeItem('tmsProgramType');
      sessionStorage.removeItem('tmsProgramConfirmed');
      await showProgramPicker([]);
      return;
    }
    // Primary scope = program type (district/payer), not school building.
    // Multiple buildings under one program → no picker; one timesheet across buildings.
    if (programTypes.length <= 1) {
      state.selectedProgramType = programTypes[0] || '';
      state.programConfirmed = true;
      sessionStorage.setItem('tmsProgramType', state.selectedProgramType);
      sessionStorage.setItem('tmsProgramConfirmed', '1');
    } else {
      const stillValid = programTypes.some(
        (p) => String(p).toLowerCase() === String(state.selectedProgramType || '').toLowerCase(),
      );
      if (!state.programConfirmed || !stillValid) {
        await showProgramPicker(programTypes);
        return;
      }
      const match = programTypes.find(
        (p) => String(p).toLowerCase() === String(state.selectedProgramType || '').toLowerCase(),
      );
      if (match) state.selectedProgramType = match;
    }
    // Keep a school id only as optional metadata for ensure/signer fallbacks — never gate the UI.
    if (schools.length === 1) {
      state.selectedSchoolId = schools[0].id;
      sessionStorage.setItem('tmsSchoolId', state.selectedSchoolId);
    } else if (
      state.selectedSchoolId &&
      !schools.some((s) => s.id === state.selectedSchoolId)
    ) {
      state.selectedSchoolId = '';
      sessionStorage.removeItem('tmsSchoolId');
    }
    state.schoolConfirmed = true;
    sessionStorage.setItem('tmsSchoolConfirmed', '1');
    const dues = (me.dueDates || []).filter((d) => d.status !== 'done');
    const alerts = me.alerts || [];
    if (dues.length || alerts.length) {
      banner = `<div class="warn-box">${[...alerts.map((a) => a.body), ...dues.map((d) => {
        const type = d.kind === 'annual' ? 'Annual' : d.kind === 'reeval' ? 'Reevaluation' : 'Progress';
        const note = d.notes ? ` (${d.notes})` : '';
        return `${d.schoolName || d.schoolId || 'School'}: ${type}${note} due ${d.dueOn}`;
      })].map((t) => `<div>${esc(t)}</div>`).join('')}</div>`;
    }
    if (providerId) {
      const ensured = await api('POST', '/week/ensure', {
        weekStart: state.weekStart,
        providerId,
        schoolId: state.selectedSchoolId || undefined,
        programType: state.selectedProgramType || undefined,
      });
      week = ensured.week;
      state.weekId = week.id;
      signerName = week.signerName || '';
      signerEmail = week.signerEmail || '';
    }
  } catch (e) {
    loadFailed = e.message || 'Unable to load this week.';
  }

  const scopeQ = therapistScopeQuery();
  const schoolQ = scopeQ.toString() ? `&${scopeQ.toString()}` : '';

  try {
    const list = await api(
      'GET',
      `/students?weekStart=${encodeURIComponent(state.weekStart)}${schoolQ}`,
    );
    students = list.students || [];
  } catch {
    students = [];
  }

  try {
    const data = await api(
      'GET',
      `/week?weekStart=${encodeURIComponent(state.weekStart)}${schoolQ}`,
    );
    if (data.week) {
      week = data.week;
      state.weekId = week.id;
      sessions = data.sessions || [];
      if ((data.students || []).length) students = data.students;
      errors = data.errors || [];
      warnings = data.warnings || [];
      signerName = week.signerName || signerName;
      signerEmail = week.signerEmail || signerEmail;
      schoolDistrict = data.schoolDistrict || '';
    }
  } catch {
    /* keep empty week */
  }

  const status = week?.status || 'draft';
  const processed = status === 'signed' || status === 'locked';
  const pending = status === 'submitted';
  // Madison: while awaiting signature or already signed/locked, providers cannot mutate sessions.
  const canImport = !pending && !processed && (status === 'draft' || status === 'reopened');
  const canMutateExisting = canImport;
  const sendBlockReason = timesheetSendBlockReason({
    week,
    sessions,
    locked: pending || processed,
    errors,
    signerEmail,
  });
  const canSend = !sendBlockReason;
  const programLabel = state.selectedProgramType || '';
  const selectedSchool = schools.find((s) => s.id === state.selectedSchoolId);
  const schoolLabel = programLabel
    || (selectedSchool ? (selectedSchool.district || selectedSchool.name || '') : '')
    || schoolDistrict;

  const flash = statusFlash && typeof statusFlash === 'object' ? statusFlash : null;
  const topSuccess = [...(flash?.success || [])];
  if (!topSuccess.length && sessions.length && (errors.length || warnings.length || flash)) {
    topSuccess.push(`${sessions.length} session(s) on this week.`);
  }
  setWeekTopStatus({
    success: topSuccess,
    error: [...(loadFailed ? [loadFailed] : []), ...(flash?.error || []), ...errors],
    warn: [...(flash?.warn || []), ...warnings],
  });

  let processedSessions = [];
  if (providerId) {
    try {
      const listed = await api('GET', '/weeks');
      processedSessions = Array.isArray(listed.processedSessions) ? listed.processedSessions : [];
      if (!processedSessions.length) {
        // Fallback: flatten sessions from signed/locked weeks if API is older.
        const signed = (listed.weeks || []).filter((w) => w.status === 'signed' || w.status === 'locked');
        for (const w of signed) {
          try {
            const detail = await api('GET', `/week?weekStart=${encodeURIComponent(w.weekStart)}`);
            for (const s of detail.sessions || []) {
              processedSessions.push({
                id: s.id,
                dateOfService: s.dateOfService,
                attendance: s.attendance,
                beginTime: s.beginTime || '',
                endTime: s.endTime || '',
                payAmount: s.payAmount ?? null,
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      processedSessions = [];
    }
  }
  const pane =
    state.therapistPane === 'prior'
      ? 'prior'
      : state.therapistPane === 'archive'
        ? 'archive'
        : 'current';
  const isPriorPane = pane === 'prior';
  const isArchivePane = pane === 'archive';
  const yellowBlocksImport = state.meSettings?.yellowWarningsBlockImport !== false;
  const importBlockCopy = yellowBlocksImport
    ? 'Import is all-or-nothing — any error or yellow warning blocks the whole file.'
    : 'Import is all-or-nothing for hard errors (red). Yellow note warnings are shown but do not block the file.';

  let archiveUploads = [];
  let archiveTimesheets = [];
  if (isArchivePane && providerId) {
    try {
      const [up, ts] = await Promise.all([
        api('GET', '/archive?kind=upload'),
        api('GET', '/archive?kind=timesheet'),
      ]);
      archiveUploads = Array.isArray(up.items) ? up.items : [];
      archiveTimesheets = Array.isArray(ts.items) ? ts.items : [];
    } catch {
      archiveUploads = [];
      archiveTimesheets = [];
    }
  }

  const addlForm = `
    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">2</span> Additional services</h2>
      <input type="hidden" id="editSessionId" value="" />
      <div class="row">
        <label>Service type
          <select id="additionalServiceType">
            <option value="">Select…</option>
            <option value="eval">Eval</option>
            <option value="progress_report">Progress report</option>
            <option value="consultation">Consultation</option>
            <option value="meetings">Meetings</option>
            <option value="paid_absence">Paid absence</option>
          </select>
        </label>
        <label>Student
          <select id="studentId">${studentOptions(students)}</select>
        </label>
      </div>
      <div class="row">
        <label>Date of service <input id="dos" placeholder="MM/DD/YYYY" /></label>
        <label>Attendance
          <select id="att">
            <option value="attended">attended</option>
            <option value="missed">missed</option>
            <option value="makeup">makeup</option>
          </select>
        </label>
      </div>
      <div class="row">
        <label>Begin time <input id="beginTime" placeholder="9:00 am" /></label>
        <label>End time <input id="endTime" placeholder="9:30 am" /></label>
      </div>
      <div class="row">
        <label>CPT code <input id="cptLabel" placeholder="97110x2" /></label>
        <label id="makeupWrap" hidden>Makeup for missed session (optional)
          <select id="makeupOf"><option value="">None — apply makeup authorization if needed</option></select>
        </label>
      </div>
      <label>Notes <textarea id="notes" rows="3"></textarea></label>
      <p class="muted">If a group-mandate child is seen alone (or as individual), the note must say no peer/partner was available.</p>
      <button type="button" class="btn big" id="add">Save session</button>
    </div>`;

  view(`
    <div class="hero-strip" aria-hidden="true"></div>
    <div class="card">
      <div class="pane-tabs" id="therapistPaneTabs" role="tablist">
        <button type="button" class="pane-tab${pane === 'current' ? ' on' : ''}" data-therapist-pane="current" role="tab">${esc(t('therapist.pending'))}</button>
        <button type="button" class="pane-tab${pane === 'prior' ? ' on' : ''}" data-therapist-pane="prior" role="tab">${esc(t('therapist.processed'))}</button>
        <button type="button" class="pane-tab${pane === 'archive' ? ' on' : ''}" data-therapist-pane="archive" role="tab">${esc(t('therapist.archive'))}</button>
      </div>
      ${isArchivePane ? `
      <h2>My uploads &amp; timesheets</h2>
      <p class="muted">Successfully imported session-note PDFs and timesheets you generated. Open a row to preview the PDF, or delete a saved report you no longer need.</p>
      <h3 class="sec">My uploads</h3>
      <div class="table-wrap"><table>
        <tr><th>Uploaded</th><th>Type</th><th>Week</th><th>File</th><th></th></tr>
        ${archiveUploads.map((a) => `<tr>
          <td>${esc(formatArchiveWhen(a.createdAt))}</td>
          <td>${esc(archiveSourceLabel(a.sourceType))}</td>
          <td>${esc(a.weekStart || '—')}</td>
          <td>${esc(a.filename || 'PDF')}</td>
          <td class="row-actions">
            ${a.hasFile ? `<button type="button" class="btn" data-open-archive="${esc(a.id)}">Open</button>` : ''}
            <button type="button" class="btn" data-delete-archive="${esc(a.id)}">Delete</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="5">No uploaded reports archived yet.</td></tr>'}
      </table></div>
      <h3 class="sec">My timesheets</h3>
      <div class="table-wrap"><table>
        <tr><th>Generated</th><th>Week</th><th>Status</th><th>File</th><th></th></tr>
        ${archiveTimesheets.map((a) => `<tr>
          <td>${esc(formatArchiveWhen(a.createdAt))}</td>
          <td>${esc(a.weekStart || '—')}</td>
          <td>${esc(a.status || '—')}</td>
          <td>${esc(a.filename || 'timesheet.pdf')}</td>
          <td class="row-actions">
            ${a.hasFile ? `<button type="button" class="btn" data-open-archive="${esc(a.id)}">Open</button>` : ''}
            <button type="button" class="btn" data-delete-archive="${esc(a.id)}">Delete</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="5">No timesheets archived yet.</td></tr>'}
      </table></div>
      ` : isPriorPane ? `
      <h2>Processed sessions</h2>
      <p class="muted">Signed and paid sessions only. Draft, pending signature, and reopened work stay under Pending Sessions.</p>
      <div class="table-wrap"><table>
        <tr><th>Session date</th><th>Attended status</th><th>Start/End time</th></tr>
        ${processedSessions.map((s) => {
          const time = [s.beginTime, s.endTime].filter(Boolean).join(' – ') || '—';
          return `<tr>
          <td>${esc(s.dateOfService || '—')}</td>
          <td>${esc(s.attendance || '—')}</td>
          <td>${esc(time)}</td>
        </tr>`;
        }).join('') || '<tr><td colspan="3">No processed sessions yet.</td></tr>'}
      </table></div>
      ` : `
      <h2>Pending sessions</h2>
      ${banner}
      ${week ? approvalBanner(status) : '<div class="warn-box">Contact the office to complete your therapist profile setup.</div>'}
      <p class="muted">Week of ${esc(state.weekStart)}${schoolLabel ? ` · ${esc(schoolLabel)}` : ''}${pending ? ' · awaiting signature (sessions locked)' : ''}${processed ? ' · signed/locked (sessions locked)' : ''}</p>
      <div class="row">
        ${programTypes.length > 1 ? `<button type="button" class="btn" id="changeSchool">${esc(t('therapist.changeProgram'))}</button>` : ''}
        <button class="btn" id="refreshHome">${esc(t('therapist.reload'))}</button>
        ${pending ? `<button type="button" class="btn" id="cancelApproval">Cancel approval request</button>` : ''}
      </div>
      `}
      ${!isPriorPane && !isArchivePane && errors.length ? `<div class="err-box status-banner" id="weekErrorsBox" data-week-issue="errors"><button type="button" class="status-banner-dismiss" data-dismiss-week-issue aria-label="Dismiss errors">×</button><strong>Resolve these items before submitting.</strong>${errors.map((e) => `<div>${esc(e)}</div>`).join('')}<button type="button" class="btn status-clear-btn" data-dismiss-week-issue>Clear</button></div>` : ''}
      ${!isPriorPane && !isArchivePane && warnings.length ? `<div class="warn-box status-banner" id="weekWarningsBox" data-week-issue="warnings"><button type="button" class="status-banner-dismiss" data-dismiss-week-issue aria-label="Dismiss warnings">×</button><strong>Warnings (submission is still allowed).</strong>${warnings.map((w) => `<div>${esc(w)}</div>`).join('')}<button type="button" class="btn status-clear-btn" data-dismiss-week-issue>Clear</button></div>` : ''}
      ${!isPriorPane && !isArchivePane ? `<p class="muted">Red indicates a blocking issue (no mandate on file, over-mandate, or note review). Yellow indicates under-mandate or soft warnings only.</p>
      <div class="table-wrap">
      <table>
        <tr><th>Date</th><th>Child</th><th>Service</th><th>CPT</th><th>Time</th><th>Attendance</th><th>Notes</th><th></th></tr>
        ${sessions.map((s) => {
          const name = studentName(students, s.studentId, s.studentName);
          const time = [s.beginTime, s.endTime].filter(Boolean).join(' – ');
          const hard = Boolean(s.aiBlock);
          const flags = s.aiFlags || [];
          const underChild = (warnings || []).some(
            (w) =>
              /under\s+(?:monthly\s+|cycle\s+)?mandate/i.test(String(w || '')) &&
              name &&
              String(w).toLowerCase().includes(String(name).toLowerCase()),
          );
          const rowClass = hard ? 'hard' : flags.length || underChild ? 'warn' : '';
          const serviceLabel = additionalServiceLabel(s.additionalServiceType) || s.serviceType || '—';
          const cpt = s.cptLabel || (s.cptCodes || []).join(', ') || '—';
          const canEditAddl = Boolean(s.additionalServiceType) && canMutateExisting;
          const canRemove = canMutateExisting;
          const canEditRow = canMutateExisting;
          const payload = {
            id: s.id,
            studentId: s.studentId,
            dateOfService: s.dateOfService,
            beginTime: s.beginTime,
            endTime: s.endTime,
            attendance: s.attendance,
            additionalServiceType: s.additionalServiceType || '',
            notes: s.notes || '',
            cptLabel: s.cptLabel || '',
            makeupOfSessionId: s.makeupOfSessionId || '',
          };
          const actions = `<td class="row-actions">
                ${canEditRow ? `<button type="button" class="icon-btn" data-edit-session="${esc(s.id)}" title="Edit" aria-label="Edit">${pencilIcon()}</button>` : ''}
                ${canRemove ? `<button type="button" class="btn" data-remove-session="${esc(s.id)}">Remove</button>` : ''}
              </td>`;
          return `<tr class="${rowClass}" data-session-json="${esc(JSON.stringify(payload))}"><td>${esc(s.dateOfService)}</td><td>${esc(name)}</td><td>${esc(serviceLabel)}</td><td>${esc(cpt)}</td><td>${esc(time)}</td><td>${esc(s.attendance)}</td><td>${esc(s.notes || '')}</td>${actions}</tr>`;
        }).join('') || `<tr><td colspan="8">No sessions recorded yet.</td></tr>`}
      </table>
    </div>` : ''}
    </div>

    ${!isPriorPane && !isArchivePane ? `
    ${processed ? `<div class="warn-box">This week is signed and locked. Sessions cannot be edited, removed, or added. Ask an admin to reopen the week if a change is required.</div>` : ''}
    ${pending ? `<div class="warn-box">Approval is pending. Sessions are locked until you cancel the approval request (returns the week to draft) or the timesheet is signed.</div>` : ''}
    ${canImport ? `
    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">1</span> Import session notes</h2>
      <p>Select a Frontline Related Service Session Notes PDF or a Therapist Activity Output PDF (text-based, not a scan). Children and schools must already exist from caseload import; this upload will not create them. ${importBlockCopy} Exact duplicates (same child, date, times, and attendance) are skipped — missed and attended at the same slot are kept separate. Sessions attach to the week of each date of service (within the 14-day locker).</p>
      <input id="pdfFile" type="file" accept="application/pdf,.pdf" />
      <button class="btn-primary big" id="upload">Import</button>
      <p class="muted" id="uploadHint">Accepts Frontline session-notes or Therapist Activity Output PDFs. Import caseloads under Mandates. Scanned PDFs are not supported.</p>
    </div>

    <div id="uploadIssues" class="upload-issues" hidden></div>

    ${addlForm}
    ` : `
    <div id="uploadIssues" class="upload-issues" hidden></div>
    `}

    ${pending || processed ? `
    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">3</span> Timesheet</h2>
      <button type="button" class="btn big" id="viewTimesheet" ${sessions.length ? '' : 'disabled'}>View timesheet</button>
    </div>` : `
    <div class="card sec-card">
      <h2 class="sec"><span class="sec-num">3</span> Send timesheet</h2>
      <p>The timesheet is sent to the school signer on file${signerEmail ? `: ${esc(signerName || signerEmail)} &lt;${esc(signerEmail)}&gt;` : ''}.</p>
      <div class="row timesheet-actions">
        <button type="button" class="btn big" id="viewTimesheet" ${sessions.length ? '' : 'disabled'}>View timesheet</button>
        <button type="button" class="btn-primary big${canSend ? '' : ' is-blocked'}" id="submit" title="${esc(sendBlockReason || 'Send timesheet to the school signer')}">Send timesheet</button>
      </div>
      <p id="submitHint" class="${canSend ? 'muted' : 'err-inline'}"${canSend ? ' hidden' : ''}>${esc(sendBlockReason || '')}</p>
    </div>
    `}
    ` : ''}
  `);

  document.querySelectorAll('[data-therapist-pane]').forEach((btn) => {
    btn.onclick = () => {
      clearTransientErrors();
      state.therapistPane = btn.getAttribute('data-therapist-pane') || 'current';
      sessionStorage.setItem('tmsTherapistPane', state.therapistPane);
      if (state.therapistPane === 'current') state.weekStart = mondayIso();
      therapistHome();
    };
  });
  document.getElementById('refreshHome')?.addEventListener('click', () => {
    clearTransientErrors();
    therapistHome();
  });
  document.getElementById('changeSchool')?.addEventListener('click', async () => {
    clearTransientErrors();
    await showProgramPicker(programTypes, { allowKeep: true });
  });
  document.getElementById('cancelApproval')?.addEventListener('click', async () => {
    if (!state.weekId) return;
    if (!confirm('Cancel the pending approval request? This voids the SignNow / email signing request (if any) and returns the week to draft.')) return;
    try {
      clearTransientErrors();
      const out = await api('POST', `/weeks/${state.weekId}/cancel-approval`);
      await therapistHome({ success: [out.message || 'Approval cancelled. Week is draft again.'] });
    } catch (err) {
      setStatus(err.message, 'error');
    }
  });

  const dismissApproval = document.getElementById('dismissApprovalBanner');
  if (dismissApproval) {
    dismissApproval.onclick = () => {
      const bannerEl = dismissApproval.closest('.status-banner');
      const key = bannerEl?.getAttribute('data-approval-key');
      if (key) dismissedApprovalBanners.add(key);
      if (bannerEl) bannerEl.remove();
    };
  }

  document.querySelectorAll('[data-dismiss-week-issue]').forEach((btn) => {
    btn.onclick = () => {
      const box = btn.closest('[data-week-issue]');
      if (box) box.remove();
      // UI only — next week GET still shows blockers if still invalid.
      clearStatus();
    };
  });

  const viewTimesheetBtn = document.getElementById('viewTimesheet');
  if (viewTimesheetBtn) {
    viewTimesheetBtn.onclick = () => {
      openTimesheetModal({
        weekId: state.weekId || week?.id,
        weekStart: state.weekStart,
        status,
        signerName,
        signerEmail,
        schoolDistrict: schoolLabel,
      });
    };
  }

  document.querySelectorAll('[data-open-archive]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-open-archive');
      if (id) openArchivePdf(id);
    };
  });
  document.querySelectorAll('[data-delete-archive]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-delete-archive');
      if (!id) return;
      if (!confirm('Delete this saved report from your archive? This cannot be undone.')) return;
      try {
        await api('DELETE', `/archive/${encodeURIComponent(id)}`);
        await therapistHome({ success: ['Archived report deleted.'] });
      } catch (e) {
        setStatus(e.message || 'Unable to delete archived report.', 'error');
      }
    };
  });

  if (isPriorPane || isArchivePane) return;

  const viewEl = document.getElementById('view');
  if (!canImport) {
    viewEl.onclick = null;
    return;
  }

  bindMakeupPickers();

  viewEl.onclick = async (e) => {
    const editBtn = e.target.closest('[data-edit-session]');
    if (editBtn) {
      const row = editBtn.closest('tr');
      let raw = {};
      try {
        raw = JSON.parse(row?.getAttribute('data-session-json') || '{}');
      } catch {
        raw = {};
      }
      document.getElementById('editSessionId').value = raw.id || '';
      document.getElementById('additionalServiceType').value = raw.additionalServiceType || '';
      document.getElementById('studentId').value = raw.studentId || '';
      document.getElementById('dos').value = raw.dateOfService || '';
      document.getElementById('att').value = raw.attendance || 'attended';
      document.getElementById('beginTime').value = raw.beginTime || '';
      document.getElementById('endTime').value = raw.endTime || '';
      document.getElementById('cptLabel').value = raw.cptLabel || '';
      document.getElementById('notes').value = raw.notes || '';
      bindMakeupPickers();
      if (raw.makeupOfSessionId) {
        await loadMissedOptions(raw.studentId, raw.makeupOfSessionId);
      }
      document.getElementById('add').textContent = 'Update session';
      document.getElementById('additionalServiceType')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const removeBtn = e.target.closest('[data-remove-session]');
    if (!removeBtn) return;
    if (!confirm('Remove this session, including any additional services? This cannot be undone.')) return;
    try {
      await api('DELETE', `/sessions/${removeBtn.getAttribute('data-remove-session')}`);
      await therapistHome({ success: ['Session removed.'] });
    } catch (err) {
      setStatus(err.message, 'error');
    }
  };

  document.getElementById('upload').onclick = async () => {
    const btn = document.getElementById('upload');
    try {
      const file = document.getElementById('pdfFile').files[0];
      if (!file) throw apiError('Select a notes PDF first.', { errors: ['Select a notes PDF first.'] });
      if (!providerId) {
        throw apiError('Your provider profile is not linked yet. Contact the office for assistance.', {
          errors: ['Your provider profile is not linked yet. Contact the office for assistance.'],
        });
      }
      btn.disabled = true;
      btn.textContent = 'Importing…';
      clearTransientErrors();
      setStatus('Importing PDF…', '');
      const pdfBase64 = await fileToBase64(file);
      const out = await api('POST', '/week/upload-sessions', {
        weekStart: state.weekStart,
        providerId,
        schoolId: state.selectedSchoolId || undefined,
        programType: state.selectedProgramType || undefined,
        fileName: file.name || '',
        pdfBase64,
      });
      state.weekId = out.week.id;
      const split = splitFailedBySeverity(out.failed, out.warnings);
      const warnList = split.yellows;
      const failedList = split.reds;
      const savedList = Array.isArray(out.saved)
        ? out.saved.map((s) => {
            if (typeof s === 'string') return s;
            const who = s.studentName || 'Session';
            const slot = [s.dateOfService, s.beginTime && s.endTime ? `${s.beginTime}–${s.endTime}` : '']
              .filter(Boolean)
              .join(' ');
            return `${who}${slot ? ` — ${slot}` : ''}`;
          })
        : [];
      const skippedN = Number(out.skippedCount || (out.skipped || []).length || 0);
      const importedN = Number(out.imported != null ? out.imported : savedList.length);
      const successMsgs = [];
      if (importedN > 0) successMsgs.push(`Imported ${importedN} session(s).`);
      if (skippedN > 0) successMsgs.push(`Skipped ${skippedN} already saved session(s).`);
      if (!successMsgs.length && !failedList.length) {
        successMsgs.push(`Imported ${out.parsed || 0} session(s).`);
      }
      if (failedList.length) successMsgs.length = 0;
      const blockedByYellow = Boolean(out.ok === false && warnList.length && !failedList.length);
      await therapistHome({
        success: successMsgs,
        error: failedList,
        warn: [
          ...warnList,
          ...(blockedByYellow
            ? ['Import blocked by yellow warnings (admin locker is ON). Nothing was saved.']
            : []),
        ],
      });
      setUploadIssues(failedList, warnList, failedList.length || warnList.length ? [] : savedList);
    } catch (e) {
      const errs = Array.isArray(e.errors) && e.errors.length
        ? e.errors
        : [e.message || 'Unable to import this PDF.'];
      const warns = Array.isArray(e.warnings) ? e.warnings : [];
      setUploadIssues(errs, warns);
      setStatus({
        error: errs.length ? errs : ['Import blocked — see details below.'],
        warn: warns,
      });
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Import';
      }
    }
  };

  document.getElementById('add').onclick = async () => {
    const btn = document.getElementById('add');
    try {
      if (!state.weekId) {
        if (!providerId) throw new Error('This week is not open yet. Contact the office to complete your provider profile.');
        const ensured = await api('POST', '/week/ensure', {
          weekStart: state.weekStart,
          providerId,
          schoolId: state.selectedSchoolId || undefined,
          programType: state.selectedProgramType || undefined,
        });
        state.weekId = ensured.week?.id || '';
      }
      if (!state.weekId) throw new Error('This week is not open yet. Contact the office for assistance.');
      const additionalServiceType = document.getElementById('additionalServiceType').value;
      const studentId = document.getElementById('studentId').value;
      const dateOfService = document.getElementById('dos').value.trim();
      const notes = document.getElementById('notes').value.trim();
      const editId = document.getElementById('editSessionId').value.trim();
      if (!additionalServiceType) throw new Error('Select a service type.');
      if (!studentId) throw new Error('Select a student.');
      if (!dateOfService) throw new Error('Enter the date of service.');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      clearTransientErrors();
      setStatus('Saving session…', '');
      await api('POST', '/week/sessions', {
        id: editId || undefined,
        weekId: state.weekId,
        studentId,
        dateOfService,
        beginTime: document.getElementById('beginTime').value,
        endTime: document.getElementById('endTime').value,
        attendance: document.getElementById('att').value,
        makeupOfSessionId: document.getElementById('makeupOf').value,
        additionalServiceType,
        cptLabel: document.getElementById('cptLabel').value.trim(),
        notes,
      });
      await therapistHome({ success: [editId ? 'Session updated.' : 'Session saved.'] });
    } catch (e) {
      const errs = Array.isArray(e.errors) && e.errors.length ? e.errors : [e.message];
      const warns = Array.isArray(e.warnings) ? e.warnings : [];
      setStatus({ error: errs, warn: warns });
      btn.disabled = false;
      btn.textContent = document.getElementById('editSessionId')?.value ? 'Update session' : 'Save session';
    }
  };

  const submitBtn = document.getElementById('submit');
  if (submitBtn) {
    submitBtn.onclick = async () => {
      const hint = document.getElementById('submitHint');
      const blockNow = timesheetSendBlockReason({
        week,
        sessions,
        locked: false,
        errors,
        signerEmail,
      });
      if (blockNow) {
        if (hint) {
          hint.hidden = false;
          hint.className = 'err-inline';
          hint.textContent = blockNow;
        }
        setStatus({ error: [blockNow] });
        showActionToast(blockNow, 'error');
        revealStatus();
        return;
      }
      const prevLabel = submitBtn.textContent;
      try {
        if (!state.weekId) throw new Error('Add at least one session first.');
        if (!signerEmail) throw new Error('No school signer is on file. Contact the office to assign a signer.');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
        clearUploadIssues();
        if (hint) {
          hint.hidden = false;
          hint.className = 'muted';
          hint.textContent = 'Sending timesheet — this can take up to a minute (note review + email)…';
        }
        setStatus('Sending timesheet…', '');
        showActionToast(
          'Sending timesheet… note review can take up to a minute.',
          'neutral',
          { sticky: true },
        );
        revealStatus();
        const out = await api(
          'POST',
          `/weeks/${state.weekId}/submit`,
          { signerName, signerEmail, schoolId: state.selectedSchoolId || undefined, programType: state.selectedProgramType || undefined },
          { timeoutMs: 120000 },
        );
        state.last = out;
        const okMsg = out.message || 'Submitted. Status is now Pending.';
        showActionToast(okMsg, 'success');
        await therapistHome({ success: [okMsg] });
        revealStatus();
      } catch (e) {
        const errs = Array.isArray(e.errors) && e.errors.length
          ? e.errors
          : [e.message || 'Unable to send timesheet.'];
        const warns = Array.isArray(e.warnings) ? e.warnings : [];
        setStatus({ error: errs, warn: warns });
        if (hint) {
          hint.hidden = false;
          hint.className = 'err-inline';
          hint.textContent = errs[0] || 'Unable to send timesheet.';
        }
        showActionToast(errs[0] || 'Unable to send timesheet.', 'error');
        revealStatus();
        submitBtn.disabled = false;
        submitBtn.textContent = prevLabel || 'Send timesheet';
      }
    };
  }
}

function pencilIcon() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.999-1.66z"/></svg>`;
}

async function showProgramPicker(programTypes, opts = {}) {
  const types = Array.isArray(programTypes) ? programTypes.filter(Boolean) : [];
  view(`
    <div class="hero-strip" aria-hidden="true"></div>
    <div class="card school-picker-card">
      <h2>Select your program</h2>
      <p class="muted">Choose the program type for your caseload. Your timesheet stays one per week across all buildings in that program — we do not split by school building.</p>
      <div class="school-picker-grid">
        ${types.map((pt) => `
          <button type="button" class="school-pick-btn" data-program-type="${esc(pt)}">
            <strong>${esc(pt)}</strong>
          </button>
        `).join('') || '<p class="muted">No program types on your caseload yet. Contact the office.</p>'}
      </div>
      ${opts.allowKeep && state.selectedProgramType ? `<p><button type="button" class="btn" id="keepSchool">Keep current program</button></p>` : ''}
    </div>
  `);
  document.querySelectorAll('[data-program-type]').forEach((btn) => {
    btn.onclick = async () => {
      state.selectedProgramType = btn.getAttribute('data-program-type') || '';
      state.programConfirmed = true;
      sessionStorage.setItem('tmsProgramType', state.selectedProgramType);
      sessionStorage.setItem('tmsProgramConfirmed', '1');
      await therapistHome();
    };
  });
  document.getElementById('keepSchool')?.addEventListener('click', () => {
    state.programConfirmed = true;
    sessionStorage.setItem('tmsProgramConfirmed', '1');
    therapistHome();
  });
}

/** @deprecated building picker replaced by program-type scope — kept as alias */
async function showSchoolPicker(schools, opts = {}) {
  const types = [...new Set((schools || []).map((s) => s.district || s.name).filter(Boolean))];
  return showProgramPicker(types.length ? types : [], opts);
}


function hhaStatusCell(w) {
  const status = String(w.hhaStatus || 'none');
  const confirmed = Number(w.hhaConfirmed ?? 0);
  const eligible = Number(w.hhaEligible ?? 0);
  const failed = Number(w.hhaFailed ?? 0);
  const ratio =
    eligible > 0
      ? status === 'failed'
        ? `${failed} failed · ${confirmed}/${eligible} ok`
        : `${confirmed}/${eligible} eligible`
      : '';
  if (status === 'failed') {
    const reason = String(w.hhaError || '').trim() || 'HHA transfer failed (no detail stored). Use Send to HHA after fixing data.';
    const tip = ratio ? `HHA failed (${ratio}) — click for details` : 'HHA failed — click for details';
    return `<button type="button" class="triage-badge" data-triage-week="${esc(w.id)}" data-triage-error="${esc(reason)}" title="${tip}" aria-label="${tip}"><svg class="triage-warn-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg> <span class="muted">${esc(ratio || 'failed')}</span></button>`;
  }
  if (ratio && (status === 'confirmed' || status === 'pending' || status === 'sent')) {
    return `<span title="HHA transfers attended/makeup only; Sessions column includes misses">${esc(status)} ${esc(ratio)}</span>`;
  }
  return esc(status);
}

function showTriageDetail(errorText, weekId) {
  closeTimesheetModal();
  const existing = document.getElementById('triageModal');
  if (existing) existing.remove();
  const backdrop = document.createElement('div');
  backdrop.id = 'triageModal';
  backdrop.className = 'modal-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'HHA triage');
  const lines = String(errorText || '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const retryBtn = weekId
    ? `<button type="button" class="btn-primary" data-triage-hha="${esc(weekId)}">Send to HHA (retry)</button>`
    : '';
  backdrop.innerHTML = `
    <div class="modal-panel">
      <div class="modal-head">
        <h2>HHA Triage</h2>
        <div class="modal-actions">
          ${retryBtn}
          <button type="button" class="btn" data-close-triage>Close</button>
        </div>
      </div>
      <p class="muted">Exact failure reason from the last HHA transfer. Fix the data, then use <strong>Send to HHA</strong> to retry.</p>
      <div class="err-box triage-detail">${lines.map((l) => esc(l)).join('<br>') || 'No error detail available.'}</div>
    </div>
  `;
  backdrop.addEventListener('click', async (e) => {
    if (e.target === backdrop || e.target.closest('[data-close-triage]')) {
      backdrop.remove();
      return;
    }
    const retry = e.target.closest('[data-triage-hha]');
    if (retry) {
      const id = retry.getAttribute('data-triage-hha');
      backdrop.remove();
      if (!id) return;
      try {
        await api('POST', `/weeks/${id}/hha`);
        setStatus('Sent to HHA.', 'ok');
        await adminDash();
      } catch (err) {
        setStatus(err.message || 'HHA transfer failed.', 'err');
      }
    }
  });
  document.body.appendChild(backdrop);
}

async function adminDash() {
  let d = { timesheet: { draft: 0, submitted: 0, signed: 0, locked: 0 }, hha: { pending: 0, confirmed: 0, failed: 0 } };
  let weeks = [];
  try {
    d = await api('GET', '/dashboard');
  } catch (err) {
    console.warn('dashboard load failed', err);
  }
  try {
    const listed = await api('GET', '/admin/weeks');
    weeks = Array.isArray(listed?.weeks) ? listed.weeks : [];
  } catch (err) {
    console.warn('admin weeks load failed', err);
    weeks = [];
  }
  const weekActions = (w) => {
    const status = w.status || 'draft';
    const canReopen = status === 'signed' || status === 'locked';
    const canHha = status === 'signed' || status === 'locked';
    const parts = [];
    parts.push(
      `<button type="button" class="btn" data-view-timesheet="${esc(w.id)}" data-week-start="${esc(w.weekStart)}" data-provider-id="${esc(w.providerId || '')}" data-provider-name="${esc(w.providerName || '')}" data-week-status="${esc(status)}">View</button>`,
    );
    // Remove so it stays visible even when the actions cell is narrow.
    parts.push(`<button type="button" class="btn" data-remove-week="${esc(w.id)}" data-week-status="${esc(status)}">Remove</button>`);
    if (status === 'submitted') {
      parts.push(`<span class="muted">Awaiting SignNow</span>`);
    }
    if (canReopen) {
      parts.push(`<button type="button" class="btn" data-reopen="${esc(w.id)}">Reopen</button>`);
    }
    if (canHha) {
      const failed = String(w.hhaStatus || '') === 'failed';
      parts.push(
        `<button type="button" class="btn${failed ? '-primary' : ''}" data-hha="${esc(w.id)}" title="${failed ? 'Retry HHA transfer after fixing the error' : 'Send week to HHA'}">${failed ? 'Retry HHA' : 'Send to HHA'}</button>`,
      );
    }
    if (status === 'draft') {
      parts.push(`<span class="muted">Awaiting therapist submission</span>`);
    } else if (status === 'reopened') {
      parts.push(`<span class="muted">Awaiting therapist resubmission</span>`);
    }
    return parts.join(' ') || '<span class="muted">—</span>';
  };
  view(`
    <div class="hero-strip" aria-hidden="true"></div>
    <div class="card">
      <h2>Dashboard</h2>
      <p>Timesheets — draft ${d?.timesheet?.draft ?? 0} · submitted ${d?.timesheet?.submitted ?? 0} · signed ${d?.timesheet?.signed ?? 0} · locked ${d?.timesheet?.locked ?? 0}</p>
      <p>HHA — confirmed ${d?.hha?.confirmed ?? 0} of ${d?.hha?.eligible ?? 0} eligible · pending ${d?.hha?.pending ?? 0} · failed ${d?.hha?.failed ?? 0}</p>
      <p class="muted">HHA counts attended/makeup visits only. The Weeks “Sessions” column includes misses.</p>
      <p class="muted">Auto-transfer runs Wed mornings (~7am ET); use Send to HHA for early payroll or exceptions.</p>
    </div>
    <div class="card">
      <h2>14-day session import locker</h2>
      <p class="muted">When enabled, providers cannot import or add sessions older than the max age. Unlock a week or provider below to grant an exception.</p>
      <div class="row">
        <label>Rule enabled
          <select id="ageLockEnabled">
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <label>Max age (days) <input id="ageLockDays" type="number" min="1" step="1" value="14" /></label>
      </div>
      <div class="row">
        <label>Unlocked week IDs (comma-separated) <input id="ageUnlockWeeks" placeholder="week-uuid, …" /></label>
        <label>Unlocked provider IDs (comma-separated) <input id="ageUnlockProviders" placeholder="provider-uuid, …" /></label>
      </div>
      <button type="button" class="btn-primary" id="saveAgeLock">Save locker settings</button>
      <p class="muted" id="ageLockStatus"></p>
    </div>
    <div class="card">
      <h2>PDF import note screening</h2>
      <p class="muted">Controls whether yellow AI / soft note warnings fail the entire Frontline or Therapist Activity import. Red (hard) issues always block the whole file.</p>
      <div class="row">
        <label>Block entire import on yellow/warning note issues
          <select id="yellowBlockImport">
            <option value="true">ON (block)</option>
            <option value="false">OFF (warn only)</option>
          </select>
        </label>
      </div>
      <button type="button" class="btn-primary" id="saveYellowBlock">Save import screening</button>
      <p class="muted" id="yellowBlockStatus"></p>
    </div>
    <div class="card">
      <h2>Weeks</h2>
      ${bulkBar('weeks')}
      <div class="table-wrap">
      <table>
        <tr>${bulkTh('weeks')}<th>Week</th><th>Provider</th><th>School</th><th>Sessions</th><th>Status</th><th>Signer</th><th>HHA</th><th></th></tr>
        ${weeks.map((w) => `<tr data-week-row="${esc(w.id)}" class="${String(w.hhaStatus) === 'failed' ? 'hha-failed-row' : ''}">
          ${bulkTd('weeks', w.id)}
          <td>${esc(w.weekStart)}</td>
          <td>${esc(w.providerName || '—')}</td>
          <td>${esc(w.schoolName || w.district || '—')}</td>
          <td>${esc(w.sessionCount)}</td>
          <td>${esc(w.status)}</td>
          <td>${esc(w.signerName || w.signerEmail || '—')}</td>
          <td>${hhaStatusCell(w)}</td>
          <td class="week-actions">${weekActions(w)}</td>
        </tr>`).join('') || `<tr><td colspan="9">No weeks yet.</td></tr>`}
      </table>
      </div>
    </div>
  `);
  // Load 14-day locker + yellow import settings
  (async () => {
    try {
      const out = await api('GET', '/admin/settings');
      const s = out.settings || {};
      const en = document.getElementById('ageLockEnabled');
      const days = document.getElementById('ageLockDays');
      const weeks = document.getElementById('ageUnlockWeeks');
      const providers = document.getElementById('ageUnlockProviders');
      const yellow = document.getElementById('yellowBlockImport');
      if (en) en.value = s.sessionImportAgeLockEnabled === false ? 'false' : 'true';
      if (days) days.value = String(s.sessionImportMaxAgeDays || 14);
      if (weeks) weeks.value = (s.unlockedWeekIds || []).join(', ');
      if (providers) providers.value = (s.unlockedProviderIds || []).join(', ');
      if (yellow) yellow.value = s.yellowWarningsBlockImport === false ? 'false' : 'true';
      state.meSettings = {
        ...(state.meSettings || {}),
        requireMfa: coerceRequireMfa(s.requireMfa, false),
        allowSmsMfa: s.allowSmsMfa === true,
      };
      cacheRequireMfa(state.meSettings.requireMfa);
    } catch {
      /* ignore */
    }
  })();
  document.getElementById('saveAgeLock')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('ageLockStatus');
    try {
      const splitIds = (raw) =>
        String(raw || '')
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      // Never send requireMfa here — a stale local cache of true was flipping org MFA back ON.
      const out = await api('POST', '/admin/settings', {
        sessionImportAgeLockEnabled: document.getElementById('ageLockEnabled').value === 'true',
        sessionImportMaxAgeDays: Number(document.getElementById('ageLockDays').value) || 14,
        unlockedWeekIds: splitIds(document.getElementById('ageUnlockWeeks').value),
        unlockedProviderIds: splitIds(document.getElementById('ageUnlockProviders').value),
      });
      if (statusEl) statusEl.textContent = 'Locker settings saved.';
      setStatus('14-day locker settings saved.', 'ok');
      const s = out.settings || {};
      document.getElementById('ageUnlockWeeks').value = (s.unlockedWeekIds || []).join(', ');
      document.getElementById('ageUnlockProviders').value = (s.unlockedProviderIds || []).join(', ');
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Save failed.';
      setStatus(err.message || 'Unable to save locker settings.', 'err');
    }
  });
  document.getElementById('saveYellowBlock')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('yellowBlockStatus');
    try {
      const out = await api('POST', '/admin/settings', {
        yellowWarningsBlockImport: document.getElementById('yellowBlockImport').value === 'true',
      });
      const on = out.settings?.yellowWarningsBlockImport !== false;
      document.getElementById('yellowBlockImport').value = on ? 'true' : 'false';
      if (statusEl) statusEl.textContent = on ? 'Yellow warnings block import (ON).' : 'Yellow warnings do not block import (OFF).';
      setStatus('Import screening setting saved.', 'ok');
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Save failed.';
      setStatus(err.message || 'Unable to save import screening.', 'err');
    }
  });
  bindBulkDelete('weeks', {
    noun: 'weeks',
    deleteOne: (id) => api('DELETE', `/admin/weeks/${id}`),
    refresh: () => adminDash(),
  });
  document.getElementById('view').onclick = async (e) => {
    const viewTs = e.target.closest('[data-view-timesheet]');
    const triage = e.target.closest('[data-triage-week]');
    const reopen = e.target.closest('[data-reopen]');
    const hha = e.target.closest('[data-hha]');
    const removeWeek = e.target.closest('[data-remove-week]');
    try {
      if (viewTs) {
        await fetchAndShowTimesheet({
          weekId: viewTs.getAttribute('data-view-timesheet') || '',
          weekStart: viewTs.getAttribute('data-week-start') || '',
          providerId: viewTs.getAttribute('data-provider-id') || '',
          providerName: viewTs.getAttribute('data-provider-name') || '',
          status: viewTs.getAttribute('data-week-status') || '',
        });
        return;
      }
      if (triage) {
        showTriageDetail(
          triage.getAttribute('data-triage-error') || '',
          triage.getAttribute('data-triage-week') || '',
        );
        return;
      }
      if (reopen) {
        await api('POST', `/admin/weeks/${reopen.getAttribute('data-reopen')}/reopen`, {});
        setStatus('Week reopened for revision.', 'ok');
        await adminDash();
        return;
      }
      if (hha) {
        const out = await api('POST', `/weeks/${hha.getAttribute('data-hha')}/hha`, {});
        setStatus({
          success: [`HHA transfer completed: ${out.transferred}.`],
          error: out.ok ? [] : out.errors?.length ? out.errors : ['HHA transfer completed with errors.'],
          warn: out.ok && out.errors?.length ? out.errors : [],
        });
        await adminDash();
        return;
      }
      if (removeWeek) {
        const st = removeWeek.getAttribute('data-week-status') || 'draft';
        if (!confirm(`Remove this ${st} week? All sessions for this week will be deleted. This cannot be undone.`)) return;
        await api('DELETE', `/admin/weeks/${removeWeek.getAttribute('data-remove-week')}`);
        setStatus('Week removed.', 'ok');
        await adminDash();
      }
    } catch (err) {
      setStatus(err.message, 'err');
    }
  };

  // Deep link from HHA error digest email: ?hhaWeek=<weekId>
  const focusWeek = new URLSearchParams(location.search).get('hhaWeek');
  if (focusWeek) {
    const row = document.querySelector(`[data-week-row="${CSS.escape(focusWeek)}"]`);
    if (row) {
      row.classList.add('hha-focus-row');
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const triage = row.querySelector('[data-triage-week]');
      if (triage) {
        showTriageDetail(
          triage.getAttribute('data-triage-error') || '',
          triage.getAttribute('data-triage-week') || focusWeek,
        );
      }
    } else {
      setStatus('Linked week not found on the dashboard (may already be fixed or removed).', 'warn');
    }
    const url = new URL(location.href);
    url.searchParams.delete('hhaWeek');
    history.replaceState({}, '', url.pathname + url.search + url.hash);
  }
}

async function adminChildren() {
  const out = await api('GET', '/admin/students');
  const students = out.students || [];
  view(`
    <div class="card">
      <h2>Children</h2>
      <p class="muted">All students on the caseload. Open a record to edit details, review mandates and sessions, or remove.</p>
      <label>Search
        <input id="childSearch" type="search" placeholder="First, last, school, program type, ID, grade…" autocomplete="off" />
      </label>
      ${bulkBar('children')}
      <table>
        <tr>${bulkTh('children')}<th>Name</th><th>School</th><th>Grade</th><th>Program</th><th>Mandates</th><th>Sessions</th><th></th></tr>
        <tbody id="childrenBody">
        ${students.map((s) => `<tr data-child-row
          data-search="${esc([s.firstName, s.lastName, s.name, s.schoolName, s.grade, s.programId, s.programType, s.id].filter(Boolean).join(' ').toLowerCase())}">
          ${bulkTd('children', s.id)}
          <td>${childNameLink(s.id, s.name)}</td>
          <td>${esc(s.schoolName)}</td>
          <td>${esc(s.grade || '—')}</td>
          <td>${esc([s.programType, s.programId].filter(Boolean).join(' · ') || '—')}</td>
          <td>${esc(s.mandateCount)}</td>
          <td>${esc(s.sessionCount)}</td>
          <td>
            <button type="button" class="btn" data-open-child="${esc(s.id)}">Open</button>
            <button type="button" class="btn" data-del-child="${esc(s.id)}">Remove</button>
          </td>
        </tr>`).join('') || '<tr id="childrenEmpty"><td colspan="8">No children on file. Import a caseload under Mandates.</td></tr>'}
        </tbody>
      </table>
      <p class="muted" id="childrenFilterEmpty" hidden>No children match this search.</p>
    </div>
  `);
  const searchEl = document.getElementById('childSearch');
  const filterEmpty = document.getElementById('childrenFilterEmpty');
  const applyChildFilter = () => {
    const q = String(searchEl?.value || '').trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll('[data-child-row]').forEach((row) => {
      const hay = row.getAttribute('data-search') || '';
      const ok = !q || hay.includes(q) || q.split(/\s+/).every((t) => hay.includes(t));
      row.hidden = !ok;
      if (ok) shown += 1;
    });
    if (filterEmpty) filterEmpty.hidden = shown > 0 || !q;
  };
  if (searchEl) searchEl.addEventListener('input', applyChildFilter);
  bindOpenChildLinks();
  bindBulkDelete('children', {
    noun: 'children',
    deleteOne: (id) => api('DELETE', `/admin/students/${id}`),
    refresh: () => adminChildren(),
  });
  document.querySelectorAll('[data-del-child]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this child? Mandates, sessions, and student files for this child will also be removed. This cannot be undone.')) return;
        await api('DELETE', `/admin/students/${btn.getAttribute('data-del-child')}`);
        setStatus('Child removed.', 'ok');
        await adminChildren();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminChildDetail(studentId, opts = {}) {
  state.childDetailBack = opts.backTo === 'reports' ? 'reports' : 'children';
  const [detail, schoolsOut] = await Promise.all([
    api('GET', `/admin/students/${studentId}`),
    api('GET', '/admin/schools'),
  ]);
  const s = detail.student;
  const school = detail.school;
  const schools = schoolsOut.schools || [];
  const mandates = detail.mandates || [];
  const sessions = detail.sessions || [];
  const weeks = detail.weeks || [];
  const dueDates = detail.dueDates || [];
  const files = detail.files || [];
  const schoolName = detail.schoolName || school?.name || '—';
  const cal = detail.schoolCalendar;
  const calSummary = detail.schoolCalendarSummary || formatCalendarSummary(cal);
  const calendarLine = calSummary
    ? `<p class="muted"><strong>Calendar:</strong> ${esc(calSummary)}${(cal?.offDays || []).length ? ` — off: ${esc((cal.offDays || []).slice().sort().join(', '))}` : ''}</p>`
    : '<p class="muted"><strong>Calendar:</strong> Not set (open the school under Schools)</p>';
  // Only show providers that have a real providerId (never name-only / unmatched text).
  const assignedProviders = detail.assignedProviders?.length
    ? detail.assignedProviders.filter((p) => String(p.id || '').trim())
    : [...new Map(
      mandates
        .filter((m) => String(m.providerId || '').trim())
        .map((m) => [
          m.providerId,
          { id: m.providerId, name: m.providerName && m.providerName !== '—' ? m.providerName : m.providerId },
        ]),
    ).values()];
  const backLabel = state.childDetailBack === 'reports' ? '← Reports' : '← Children';
  const sessFrom = state.childSessionFrom || '';
  const sessTo = state.childSessionTo || '';
  const filteredSessions = sessions.filter((x) =>
    sessionDosInRange(x.dateOfService, sessFrom, sessTo),
  );
  const childTab = ['basic', 'mandates', 'sessions', 'timesheet', 'files'].includes(state.childDetailTab)
    ? state.childDetailTab
    : 'basic';
  const childTabBtn = (id, label) =>
    `<button type="button" class="pane-tab${childTab === id ? ' on' : ''}" data-child-tab="${id}" role="tab">${label}</button>`;
  view(`
    <div class="card">
      <button type="button" class="btn" id="backChildren">${backLabel}</button>
      <h2>${esc(`${s.firstName || ''} ${s.lastName || ''}`.trim() || 'Child')}</h2>
      <p class="muted"><strong>School:</strong> ${esc(schoolName)}</p>
      ${calendarLine}
      <p class="muted"><strong>Provider(s) on mandates:</strong> ${
        assignedProviders.length
          ? assignedProviders.map((p) => providerNameLink(p.id, p.name)).join(', ')
          : '—'
      }</p>
      <div class="pane-tabs" role="tablist">
        ${childTabBtn('basic', 'Basic info')}
        ${childTabBtn('mandates', 'Mandates')}
        ${childTabBtn('sessions', 'Sessions')}
        ${childTabBtn('timesheet', 'Timesheet')}
        ${childTabBtn('files', 'Student files')}
      </div>

      <div class="detail-pane"${childTab === 'basic' ? '' : ' hidden'}>
        <h3>Basic information</h3>
        <div class="row">
          <label>First name <input id="cFirst" value="${esc(s.firstName || '')}" /></label>
          <label>Last name <input id="cLast" value="${esc(s.lastName || '')}" /></label>
        </div>
        <div class="row">
          <label>School
            <select id="cSchool">${schoolOptions(schools, s.schoolId)}</select>
          </label>
          <label>Grade <input id="cGrade" value="${esc(s.grade || '')}" /></label>
        </div>
        <div class="row">
          <label>DOB <input id="cDob" value="${esc(s.dob || '')}" placeholder="YYYY-MM-DD" />
            <span class="muted" style="display:block;font-size:0.85rem">Optional now; recommended before HHA transfer.</span>
          </label>
          <label>HHA patient id <input id="cHha" value="${esc(s.hhaPatientId || '')}" /></label>
        </div>
        <div class="row">
          <label>Program id <input id="cProgId" value="${esc(s.programId || '')}" /></label>
          <label>Program type <input id="cProgType" value="${esc(s.programType || '')}" /></label>
        </div>
        <button type="button" class="btn-primary" id="saveChild">Save child</button>
        <button type="button" class="btn" id="deleteChild">Delete child</button>
      </div>

      <div class="detail-pane"${childTab === 'mandates' ? '' : ' hidden'}>
        <h3>Mandates</h3>
        ${bulkBar('child-mandates')}
        <table>
          <tr>${bulkTh('child-mandates')}<th>Discipline / service</th><th>Ratio</th><th>Group size</th><th>Duration</th><th>Frequency</th><th>Dates</th><th>Provider</th><th></th></tr>
          ${mandates.map((m) => {
            const service = [m.discipline, m.serviceType].filter(Boolean).join(' · ') || '—';
            const billing = m.billingServiceName
              ? `<div class="muted" style="font-size:0.85rem">${esc(m.billingServiceName)}</div>`
              : '';
            const dates = [m.startOn, m.endOn].filter(Boolean).join(' → ') || '—';
            return `<tr>
            ${bulkTd('child-mandates', m.id)}
            <td>${esc(service)}${billing}</td>
            <td>${esc(m.ratioLabel || (m.ratioGroup ? 'Group' : 'Individual'))}</td>
            <td>${esc(mandateGroupSizeLabel(m))}</td>
            <td>${esc(mandateDurationLabel(m))}</td>
            <td>${esc(mandateFreqLabel(m))}</td>
            <td>${esc(dates)}</td>
            <td>${providerNameLink(m.providerId, m.providerName || '—')}</td>
            <td>
              <button type="button" class="btn" data-edit-mandate="${esc(m.id)}">Edit</button>
              <button type="button" class="btn" data-del-mandate="${esc(m.id)}">Delete</button>
            </td>
          </tr>`;
          }).join('') || '<tr><td colspan="9">No mandates on file.</td></tr>'}
        </table>
        <div id="editMandatePanel" class="entry-card" hidden style="margin-top:1rem"></div>
        <h3 style="margin-top:1.25rem">Progress-report due dates</h3>
        <p class="muted">School-level progress, annual, and reevaluation due dates for this child’s school. Child-specific notes appear when set on the school assignment.</p>
        ${bulkBar('child-dues')}
        <table>
          <tr>${bulkTh('child-dues')}<th>Type</th><th>Due Date</th><th>Notes</th><th>Status</th><th></th></tr>
          ${dueDates.map((d) => `<tr>
            ${bulkTd('child-dues', d.id)}
            <td>${esc(d.kind === 'annual' ? 'Annual' : d.kind === 'reeval' ? 'Reevaluation' : 'Progress')}</td>
            <td>${esc(d.dueOn)}</td>
            <td>${esc(d.notes || '—')}</td>
            <td>${esc(d.status)}</td>
            <td><button type="button" class="btn" data-del-due="${esc(d.id)}">Remove</button></td>
          </tr>`).join('') || '<tr><td colspan="6">None for this school.</td></tr>'}
        </table>
      </div>

      <div class="detail-pane"${childTab === 'sessions' ? '' : ' hidden'}>
        <h3>Sessions</h3>
        <div class="row">
          <label>From <input id="sessFrom" type="date" value="${esc(sessFrom)}" /></label>
          <label>To <input id="sessTo" type="date" value="${esc(sessTo)}" /></label>
          <button type="button" class="btn" id="sessFilter">Filter</button>
          <button type="button" class="btn" id="sessClear">Clear</button>
        </div>
        ${bulkBar('child-sessions')}
        <table>
          <tr>${bulkTh('child-sessions')}<th>Date</th><th>Week</th><th>Status</th><th>Attendance</th><th>Notes</th><th></th></tr>
          ${filteredSessions.map((x) => `<tr>
            ${bulkTd('child-sessions', x.id)}
            <td>${esc(x.dateOfService)}</td>
            <td>${esc(x.weekStart || '—')}</td>
            <td>${esc(x.weekStatus || '—')}</td>
            <td>${esc(x.attendance)}</td>
            <td>${esc(x.notes || '')}</td>
            <td><button type="button" class="btn" data-del-session="${esc(x.id)}">Delete</button></td>
          </tr>`).join('') || '<tr><td colspan="7">No sessions in this date range.</td></tr>'}
        </table>
      </div>

      <div class="detail-pane"${childTab === 'timesheet' ? '' : ' hidden'}>
        <h3 title="Weekly timesheet periods that include sessions for this child">Timesheet</h3>
        <p class="muted">Weekly timesheet periods linked to this child’s sessions.</p>
        ${bulkBar('child-weeks')}
        <table>
          <tr>${bulkTh('child-weeks')}<th>Week</th><th>Status</th><th>HHA</th><th></th></tr>
          ${weeks.map((w) => `<tr>
            ${bulkTd('child-weeks', w.id)}
            <td>${esc(w.weekStart)}</td>
            <td>${esc(w.status)}</td>
            <td>${hhaStatusCell(w)}</td>
            <td><button type="button" class="btn" data-del-week="${esc(w.id)}" data-week-status="${esc(w.status || '')}">Remove</button></td>
          </tr>`).join('') || '<tr><td colspan="5">None.</td></tr>'}
        </table>
      </div>

      <div class="detail-pane"${childTab === 'files' ? '' : ' hidden'}>
        <h3 title="Uploaded PDFs and documents kept with this child">Student files</h3>
        <p class="muted">Documents stored with this child (timesheets, notes PDFs, and related files).</p>
        ${bulkBar('child-files')}
        <table>
          <tr>${bulkTh('child-files')}<th>Label</th><th>Type</th><th>When</th><th></th></tr>
          ${files.map((f) => `<tr>
            ${bulkTd('child-files', f.id)}
            <td>${esc(f.label || f.s3Key || '—')}</td>
            <td>${esc(f.kind || '—')}</td>
            <td>${esc((f.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
            <td><button type="button" class="btn" data-del-file="${esc(f.id)}">Delete</button></td>
          </tr>`).join('') || '<tr><td colspan="5">No files on file.</td></tr>'}
        </table>
      </div>
    </div>
  `);
  document.querySelectorAll('[data-child-tab]').forEach((btn) => {
    btn.onclick = () => {
      state.childDetailTab = btn.getAttribute('data-child-tab') || 'basic';
      sessionStorage.setItem('tmsChildDetailTab', state.childDetailTab);
      adminChildDetail(studentId, { backTo: state.childDetailBack });
    };
  });
  const refreshChild = () => adminChildDetail(studentId, { backTo: state.childDetailBack });
  bindOpenProviderLinks();
  bindBulkDelete('child-mandates', {
    noun: 'mandates',
    deleteOne: (id) => api('DELETE', `/admin/mandates/${id}`),
    refresh: refreshChild,
  });
  bindBulkDelete('child-sessions', {
    noun: 'sessions',
    deleteOne: (id) => api('DELETE', `/sessions/${id}`),
    refresh: refreshChild,
  });
  bindBulkDelete('child-weeks', {
    noun: 'weeks',
    deleteOne: (id) => api('DELETE', `/admin/weeks/${id}`),
    refresh: refreshChild,
  });
  bindBulkDelete('child-dues', {
    noun: 'due dates',
    deleteOne: (id) => api('DELETE', `/admin/due-dates/${id}`),
    refresh: refreshChild,
  });
  bindBulkDelete('child-files', {
    noun: 'files',
    deleteOne: (id) => api('DELETE', `/admin/files/${id}`),
    refresh: refreshChild,
  });
  document.getElementById('backChildren').onclick = () => {
    if (state.childDetailBack === 'reports') adminReports();
    else adminChildren();
  };
  document.getElementById('sessFilter').onclick = () => {
    state.childSessionFrom = document.getElementById('sessFrom').value || '';
    state.childSessionTo = document.getElementById('sessTo').value || '';
    adminChildDetail(studentId, { backTo: state.childDetailBack });
  };
  document.getElementById('sessClear').onclick = () => {
    state.childSessionFrom = '';
    state.childSessionTo = '';
    adminChildDetail(studentId, { backTo: state.childDetailBack });
  };
  document.getElementById('saveChild').onclick = async () => {
    try {
      await api('POST', `/admin/students/${studentId}`, {
        firstName: document.getElementById('cFirst').value,
        lastName: document.getElementById('cLast').value,
        schoolId: document.getElementById('cSchool').value,
        grade: document.getElementById('cGrade').value,
        dob: document.getElementById('cDob').value,
        hhaPatientId: document.getElementById('cHha').value,
        programId: document.getElementById('cProgId').value,
        programType: document.getElementById('cProgType').value,
      });
      setStatus('Child saved.', 'ok');
      await adminChildren();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('deleteChild').onclick = async () => {
    try {
      if (!confirm('Remove this child? Mandates, sessions, and student files for this child will also be removed. This cannot be undone.')) return;
      await api('DELETE', `/admin/students/${studentId}`);
      setStatus('Child removed.', 'ok');
      await adminChildren();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.querySelectorAll('[data-del-mandate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this mandate? This cannot be undone.')) return;
        await api('DELETE', `/admin/mandates/${btn.getAttribute('data-del-mandate')}`);
        setStatus('Mandate removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  (async () => {
    try {
      const [providersOut] = await Promise.all([api('GET', '/admin/providers')]);
      bindMandateEditor({
        mandates,
        providers: providersOut.providers || [],
        students: [{ id: studentId, firstName: s.firstName, lastName: s.lastName }],
        onSaved: () => adminChildDetail(studentId, { backTo: state.childDetailBack }),
      });
    } catch {
      bindMandateEditor({
        mandates,
        providers: [],
        students: [{ id: studentId, firstName: s.firstName, lastName: s.lastName }],
        onSaved: () => adminChildDetail(studentId, { backTo: state.childDetailBack }),
      });
    }
  })();
  document.querySelectorAll('[data-del-session]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this session? This cannot be undone.')) return;
        await api('DELETE', `/sessions/${btn.getAttribute('data-del-session')}`);
        setStatus('Session removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-file]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this student file record? This cannot be undone.')) return;
        await api('DELETE', `/admin/files/${btn.getAttribute('data-del-file')}`);
        setStatus('File removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-week]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const st = btn.getAttribute('data-week-status') || 'draft';
        if (!confirm(`Remove this ${st} week? All sessions for this week will be deleted. This cannot be undone.`)) return;
        await api('DELETE', `/admin/weeks/${btn.getAttribute('data-del-week')}`);
        setStatus('Week removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-triage-week]').forEach((btn) => {
    btn.addEventListener('click', () =>
      showTriageDetail(btn.getAttribute('data-triage-error') || '', btn.getAttribute('data-triage-week') || ''),
    );
  });
  document.querySelectorAll('[data-del-due]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this progress-report due date? Related alerts will stop. This cannot be undone.')) return;
        await api('DELETE', `/admin/due-dates/${btn.getAttribute('data-del-due')}`);
        setStatus('Due date removed.', 'ok');
        await adminChildDetail(studentId, { backTo: state.childDetailBack });
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminProviderDetail(providerId) {
  const detail = await api('GET', `/admin/providers/${providerId}`);
  const p = detail.provider;
  const user = detail.user;
  const notes = detail.notes || [];
  const mandates = detail.mandates || [];
  const weeks = detail.weeks || [];
  const sessions = detail.sessions || [];
  // Keep URL/state on the canonical linked id when duplicates were merged server-side.
  if (p?.id && String(p.id) !== String(providerId)) providerId = p.id;
  const sessFrom = state.providerSessionFrom || '';
  const sessTo = state.providerSessionTo || '';
  const sessDistrict = state.providerSessionDistrict || '';
  const districtOptions = [...new Set(
    sessions.map((x) => String(x.district || '').trim()).filter(Boolean),
  )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const filteredSessions = sessions.filter((x) => {
    if (!sessionDosInRange(x.dateOfService, sessFrom, sessTo)) return false;
    if (sessDistrict && String(x.district || '').trim() !== sessDistrict) return false;
    return true;
  });
  const timesheetSchools = (() => {
    const byId = new Map();
    for (const x of sessions) {
      const sid = String(x.schoolId || '').trim();
      if (!sid || byId.has(sid)) continue;
      byId.set(sid, {
        id: sid,
        label: [x.schoolName, x.district].filter(Boolean).join(' · ') || sid,
      });
    }
    for (const w of weeks) {
      const sid = String(w.schoolId || '').trim();
      if (!sid || byId.has(sid)) continue;
      const school = detail.schools?.find?.((s) => s.id === sid);
      byId.set(sid, {
        id: sid,
        label: [w.schoolName || school?.name, w.district || school?.district].filter(Boolean).join(' · ') || sid,
      });
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  })();
  const provTab = ['basic', 'pay', 'caseload', 'sessions', 'reports', 'notes'].includes(state.providerDetailTab)
    ? state.providerDetailTab
    : 'basic';
  const provTabBtn = (id, label) =>
    `<button type="button" class="pane-tab${provTab === id ? ' on' : ''}" data-provider-tab="${id}" role="tab">${label}</button>`;
  view(`
    <div class="card">
      <button type="button" class="btn" id="backProviders">← Providers</button>
      <h2>${esc(`${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Provider')}</h2>
      <p class="muted">Linked account: ${esc(user?.email || '—')} · Cognito: ${esc(user?.cognitoSub || '—')}</p>
      ${detail.redirectedFromProviderId ? `<p class="muted">Caseload from a duplicate profile was merged into this linked provider.</p>` : ''}
      <div class="pane-tabs" role="tablist">
        ${provTabBtn('basic', 'Basic info')}
        ${provTabBtn('pay', 'Pay rates')}
        ${provTabBtn('caseload', 'Caseload')}
        ${provTabBtn('sessions', 'Sessions')}
        ${provTabBtn('reports', 'Upload reports')}
        ${provTabBtn('notes', 'Internal notes')}
      </div>

      <div class="detail-pane"${provTab === 'basic' ? '' : ' hidden'}>
        <h3>Basic information</h3>
        <div class="row">
          <label>First name <input id="pFirst" value="${esc(p.firstName || '')}" /></label>
          <label>Last name <input id="pLast" value="${esc(p.lastName || '')}" /></label>
        </div>
        <div class="row">
          <label>Email <input id="pEmail" type="email" value="${esc(user?.email || '')}" /></label>
          <label>Discipline
            <select id="pDisc">
              ${['OT', 'PT', 'SLP'].map((d) => `<option ${p.discipline === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="row">
          <label>HHA caregiver code <input id="pHha" value="${esc(p.hhaCaregiverCode || '')}" /></label>
          <label>Status
            <select id="pActive">
              <option value="true"${p.active !== false ? ' selected' : ''}>Active</option>
              <option value="false"${p.active === false ? ' selected' : ''}>Inactive</option>
            </select>
          </label>
        </div>
        <button type="button" class="btn-primary" id="saveProvider">Save provider</button>
        <button type="button" class="btn" id="deleteProvider">Delete provider</button>
      </div>

      <div class="detail-pane"${provTab === 'pay' ? '' : ' hidden'}>
        <h3>Pay rates</h3>
        ${payRatesFieldset(p, 'pRate')}
        <button type="button" class="btn-primary" id="saveProviderPay">Save pay rates</button>
      </div>

      <div class="detail-pane"${provTab === 'caseload' ? '' : ' hidden'}>
        <h3>Caseload (${esc(detail.caseloadCount || 0)} children)</h3>
        <p class="muted">Drawn from this provider’s mandates (a child may appear under more than one provider).</p>
        ${bulkBar('prov-mandates')}
        <table>
          <tr>${bulkTh('prov-mandates')}<th>Child</th><th>Service</th><th>Group size</th><th>Duration</th><th>Freq</th><th></th></tr>
          ${mandates.map((m) => {
            const billing = m.billingServiceName
              ? `<div class="muted" style="font-size:0.85rem">${esc(m.billingServiceName)}</div>`
              : '';
            return `<tr>
            ${bulkTd('prov-mandates', m.id)}
            <td>${childNameLink(m.studentId, m.studentName || '—')}</td>
            <td>${esc(m.serviceType || '—')}${billing}</td>
            <td>${esc(mandateGroupSizeLabel(m))}</td>
            <td>${esc(mandateDurationLabel(m))}</td>
            <td>${esc(mandateFreqLabel(m))}</td>
            <td>
              <button type="button" class="btn" data-edit-mandate="${esc(m.id)}">Edit</button>
              <button type="button" class="btn" data-del-mandate="${esc(m.id)}">Delete mandate</button>
            </td>
          </tr>`;
          }).join('') || '<tr><td colspan="7">No mandates assigned.</td></tr>'}
        </table>
        <div id="editMandatePanel" class="entry-card" hidden style="margin-top:1rem"></div>
      </div>

      <div class="detail-pane"${provTab === 'sessions' ? '' : ' hidden'}>
        <h3>Sessions</h3>
        <p class="muted">All sessions for this provider (newest first). Filter by date of service or district as needed. Sessions from different school signers land on separate timesheets for the same week.</p>
        <div class="row">
          <label>From <input id="pSessFrom" type="date" value="${esc(sessFrom)}" /></label>
          <label>To <input id="pSessTo" type="date" value="${esc(sessTo)}" /></label>
          <label>District
            <select id="pSessDistrict">
              <option value="">All districts</option>
              ${districtOptions.map((d) => `<option value="${esc(d)}"${d === sessDistrict ? ' selected' : ''}>${esc(d)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="btn" id="pSessFilter">Filter</button>
          <button type="button" class="btn" id="pSessClear">Clear</button>
        </div>
        ${bulkBar('prov-sessions')}
        <table>
          <tr>${bulkTh('prov-sessions')}<th>Date</th><th>Child</th><th>School</th><th>District</th><th>Week</th><th>Status</th><th>Attendance</th><th>Notes</th><th></th></tr>
          ${filteredSessions.map((x) => {
            const hard = Boolean(x.aiBlock);
            const flags = x.aiFlags || [];
            const rowClass = hard ? 'hard' : flags.length ? 'warn' : '';
            return `<tr class="${rowClass}">
            ${bulkTd('prov-sessions', x.id)}
            <td>${esc(x.dateOfService)}</td>
            <td>${childNameLink(x.studentId, x.studentName || '—')}</td>
            <td>${esc(x.schoolName || '—')}</td>
            <td>${esc(x.district || '—')}</td>
            <td>${esc(x.weekStart || '—')}</td>
            <td>${esc(x.weekStatus || '—')}</td>
            <td>${esc(x.attendance)}</td>
            <td>${esc(x.notes || '')}${flags.length ? `<div class="muted">${esc(flags.join('; '))}</div>` : ''}</td>
            <td><button type="button" class="btn" data-del-session="${esc(x.id)}">Delete</button></td>
          </tr>`;
          }).join('') || '<tr><td colspan="9">No sessions in this date range.</td></tr>'}
        </table>

        <h3 style="margin-top:1.25rem">Import Frontline / Therapist Activity sessions</h3>
        <p class="muted">Same as the therapist workspace: upload a Frontline or Therapist Activity PDF (text-based). No week selection needed — each session attaches to the week of its date of service (within the 14-day locker), split by school signer when schools differ. Children and schools must already exist. Import is all-or-nothing for hard errors; yellow warnings follow the admin screening setting.</p>
        <input id="pSessionPdf" type="file" accept="application/pdf,.pdf" />
        <button type="button" class="btn-primary" id="pUploadSessions">Import sessions</button>
        <div id="pUploadIssues" class="upload-issues" hidden></div>

        <h3 style="margin-top:1.25rem">Generate timesheet</h3>
        <p class="muted">Open or create a week for this provider, choose the school/signer when there is more than one, then view or send the timesheet. You can send another timesheet for the same calendar week when it is for a different school signer.</p>
        <div class="row">
          <label>Week start (Monday) <input id="pWeekStart" type="date" value="${esc(mondayIso())}" /></label>
          <label>School / signer
            <select id="pTimesheetSchool">
              <option value="">Auto (from sessions)</option>
              ${timesheetSchools.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="btn-primary" id="pGenTimesheet">View timesheet</button>
          <button type="button" class="btn-primary" id="pSendTimesheet">Send timesheet</button>
        </div>
        <p class="muted" id="pSendTimesheetHint" hidden></p>

        <h3 style="margin-top:1.25rem">Additional services</h3>
        <p class="muted">Same service types as the therapist workspace, including paid absence.</p>
        <div class="row">
          <label>Service type
            <select id="pAddlType">
              <option value="">Select…</option>
              ${additionalServiceOptions()}
            </select>
          </label>
          <label>Child
            <select id="pAddlStudent">${(mandates || []).map((m) => `<option value="${esc(m.studentId)}">${esc(m.studentName || m.studentId)}</option>`).join('') || '<option value="">No caseload children</option>'}</select>
          </label>
        </div>
        <div class="row">
          <label>Date of service <input id="pAddlDos" placeholder="MM/DD/YYYY" /></label>
          <label>Begin / end
            <div class="row">
              <input id="pAddlBegin" placeholder="9:00 am" />
              <input id="pAddlEnd" placeholder="9:30 am" />
            </div>
          </label>
        </div>
        <label>Notes <textarea id="pAddlNotes" rows="2"></textarea></label>
        <label>CPT code <input id="pAddlCpt" placeholder="97110x2" /></label>
        <button type="button" class="btn" id="pAddlSave">Save additional service</button>
      </div>

      <div class="detail-pane"${provTab === 'reports' ? '' : ' hidden'}>
        <h3>Upload reports</h3>
        <p class="muted">Admins can upload provider reports and documents here.</p>
        <input id="pReportFile" type="file" />
        <label>Label <input id="pReportLabel" placeholder="IEP / progress / other" /></label>
        <button type="button" class="btn" id="pUploadReport">Upload report</button>
        ${bulkBar('prov-files')}
        <table>
          <tr>${bulkTh('prov-files')}<th>Label</th><th>When</th><th></th></tr>
          ${(detail.files || []).map((f) => `<tr>
            ${bulkTd('prov-files', f.id)}
            <td>${esc(f.label || f.s3Key)}</td>
            <td>${esc((f.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
            <td><button type="button" class="btn" data-del-file="${esc(f.id)}">Delete</button></td>
          </tr>`).join('') || '<tr><td colspan="4">No files on file.</td></tr>'}
        </table>
      </div>

      <div class="detail-pane"${provTab === 'notes' ? '' : ' hidden'}>
        <h3>Internal notes</h3>
        <p class="muted">Visible to administrators only. Tag notes to support later filtering.</p>
        <label>Filter by tag
          <select id="pNoteFilter">
            <option value="">All</option>
            ${(detail.noteTagOptions || ['Session note follow up', 'Gap in service']).map((t) => `<option>${esc(t)}</option>`).join('')}
          </select>
        </label>
        <label>New note <textarea id="pNoteBody" rows="3"></textarea></label>
        <div class="row" id="pNoteTags">
          ${(detail.noteTagOptions || ['Session note follow up', 'Gap in service']).map((t) =>
            `<label class="chk"><input type="checkbox" data-new-tag value="${esc(t)}" /> ${esc(t)}</label>`,
          ).join('')}
        </div>
        <label>Add tag <input id="pNoteTagCustom" placeholder="New tag name" /></label>
        <button type="button" class="btn" id="pAddNote">Add note</button>
        <table>
          <tr><th>When</th><th>Tags</th><th>Note</th><th></th></tr>
          ${notes.slice().reverse().map((n) => `<tr data-note-tags="${esc((n.tags || []).join('|').toLowerCase())}">
            <td>${esc((n.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
            <td>${(n.tags || []).map((t) => `<span class="status-chip">${esc(t)}</span>`).join(' ') || '—'}</td>
            <td><textarea data-note-body="${esc(n.id)}" rows="2">${esc(n.body || '')}</textarea></td>
            <td>
              <button type="button" class="btn" data-save-note="${esc(n.id)}">Save</button>
              <button type="button" class="btn" data-del-note="${esc(n.id)}">Delete</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="4">No notes yet.</td></tr>'}
        </table>
      </div>
    </div>
  `);
  document.querySelectorAll('[data-provider-tab]').forEach((btn) => {
    btn.onclick = () => {
      state.providerDetailTab = btn.getAttribute('data-provider-tab') || 'basic';
      sessionStorage.setItem('tmsProviderDetailTab', state.providerDetailTab);
      adminProviderDetail(providerId);
    };
  });
  const refreshProvider = () => adminProviderDetail(providerId);
  bindBulkDelete('prov-mandates', {
    noun: 'mandates',
    deleteOne: (id) => api('DELETE', `/admin/mandates/${id}`),
    refresh: refreshProvider,
  });
  bindBulkDelete('prov-sessions', {
    noun: 'sessions',
    deleteOne: (id) => api('DELETE', `/sessions/${id}`),
    refresh: refreshProvider,
  });
  bindBulkDelete('prov-files', {
    noun: 'files',
    deleteOne: (id) => api('DELETE', `/admin/files/${id}`),
    refresh: refreshProvider,
  });
  bindOpenChildLinks();
  bindMandateEditor({
    mandates,
    providers: [p],
    students: mandates.map((m) => ({
      id: m.studentId,
      firstName: String(m.studentName || '').split(/\s+/)[0] || '',
      lastName: String(m.studentName || '').split(/\s+/).slice(1).join(' ') || m.studentName || '',
    })),
    onSaved: refreshProvider,
  });
  document.getElementById('pSessFilter')?.addEventListener('click', () => {
    state.providerSessionFrom = document.getElementById('pSessFrom')?.value || '';
    state.providerSessionTo = document.getElementById('pSessTo')?.value || '';
    state.providerSessionDistrict = document.getElementById('pSessDistrict')?.value || '';
    refreshProvider();
  });
  document.getElementById('pSessClear')?.addEventListener('click', () => {
    state.providerSessionFrom = '';
    state.providerSessionTo = '';
    state.providerSessionDistrict = '';
    refreshProvider();
  });
  document.querySelectorAll('[data-del-session]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this session? This cannot be undone.')) return;
        await api('DELETE', `/sessions/${btn.getAttribute('data-del-session')}`);
        setStatus('Session removed.', 'ok');
        await refreshProvider();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.getElementById('backProviders').onclick = () => adminProviders();
  const saveProviderBasic = async () => {
    await api('PATCH', `/admin/providers/${providerId}`, {
      firstName: document.getElementById('pFirst').value,
      lastName: document.getElementById('pLast').value,
      email: document.getElementById('pEmail').value,
      discipline: document.getElementById('pDisc').value,
      hhaCaregiverCode: document.getElementById('pHha').value,
      active: document.getElementById('pActive')?.value !== 'false',
    });
  };
  const saveProviderPayRates = async () => {
    await api('PATCH', `/admin/providers/${providerId}`, {
      ...readPayRatesFromIds({
        min30: 'pRate30',
        min42: 'pRate42',
        min45: 'pRate45',
        hour: 'pRateHour',
        g30: 'pRateG30',
        g42: 'pRateG42',
        g45: 'pRateG45',
        eval: 'pRateEval',
        extra: 'pRateExtra',
      }),
    });
  };
  document.getElementById('saveProvider')?.addEventListener('click', async () => {
    try {
      await saveProviderBasic();
      setStatus('Provider saved.', 'ok');
      await adminProviders();
    } catch (e) { setStatus(e.message, 'err'); }
  });
  document.getElementById('saveProviderPay')?.addEventListener('click', async () => {
    try {
      await saveProviderPayRates();
      setStatus('Pay rates saved.', 'ok');
      await refreshProvider();
    } catch (e) { setStatus(e.message, 'err'); }
  });
  document.getElementById('deleteProvider').onclick = async () => {
    try {
      if (!confirm('Remove this provider? The profile and internal notes will be deleted, and the linked therapist account will be deactivated. Mandates remain but become unassigned. This cannot be undone.')) return;
      await api('DELETE', `/admin/providers/${providerId}`);
      setStatus('Provider removed.', 'ok');
      await adminProviders();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('pAddNote').onclick = async () => {
    try {
      const text = document.getElementById('pNoteBody').value.trim();
      if (!text) throw new Error('Enter a note first.');
      const tags = [...document.querySelectorAll('[data-new-tag]:checked')].map((el) => el.value);
      const custom = document.getElementById('pNoteTagCustom')?.value?.trim();
      if (custom) tags.push(custom);
      await api('POST', `/admin/providers/${providerId}/notes`, { body: text, tags });
      setStatus('Note saved.', 'ok');
      await adminProviderDetail(providerId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  const noteFilter = document.getElementById('pNoteFilter');
  if (noteFilter) {
    noteFilter.onchange = () => {
      const want = noteFilter.value.toLowerCase();
      document.querySelectorAll('[data-note-tags]').forEach((tr) => {
        const hay = tr.getAttribute('data-note-tags') || '';
        tr.hidden = Boolean(want) && !hay.split('|').includes(want);
      });
    };
  }
  document.getElementById('pUploadReport').onclick = async () => {
    try {
      const file = document.getElementById('pReportFile').files[0];
      if (!file) throw new Error('Select a file first.');
      const fileBase64 = await fileToBase64(file);
      await api('POST', '/files', {
        providerId,
        studentId: '',
        kind: 'provider_report',
        label: document.getElementById('pReportLabel').value.trim() || file.name,
        fileName: file.name,
        fileBase64,
      });
      setStatus('Report uploaded.', 'ok');
      await adminProviderDetail(providerId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('pUploadSessions').onclick = async () => {
    const btn = document.getElementById('pUploadSessions');
    const issuesHost = document.getElementById('pUploadIssues');
    try {
      const file = document.getElementById('pSessionPdf').files[0];
      if (!file) throw new Error('Select a Frontline or Therapist Activity PDF first.');
      btn.disabled = true;
      btn.textContent = 'Importing…';
      if (issuesHost) {
        issuesHost.hidden = true;
        issuesHost.innerHTML = '';
      }
      setStatus('Importing PDF…', '');
      const pdfBase64 = await fileToBase64(file);
      const out = await api('POST', '/week/upload-sessions', {
        providerId,
        fileName: file.name || '',
        pdfBase64,
      });
      const split = splitFailedBySeverity(out.failed, out.warnings);
      const warnList = split.yellows;
      const failedList = split.reds;
      const savedList = Array.isArray(out.saved)
        ? out.saved.map((s) => {
            if (typeof s === 'string') return s;
            const who = s.studentName || s.studentId || 'session';
            const when = [s.dateOfService, s.beginTime, s.endTime].filter(Boolean).join(' ');
            return when ? `${who} — ${when}` : who;
          })
        : [];
      const skippedN = Array.isArray(out.skipped) ? out.skipped.length : out.skippedCount || 0;
      const blockedByYellow = Boolean(out.ok === false && warnList.length && !failedList.length);
      setUploadIssues(
        failedList,
        [
          ...warnList,
          ...(blockedByYellow
            ? ['Import blocked by yellow warnings (locker is ON). Nothing was saved.']
            : []),
        ],
        failedList.length || out.ok === false ? [] : savedList,
      );
      if (failedList.length || out.ok === false) {
        setStatus({
          error: failedList.length ? failedList : [],
          warn: warnList.length
            ? warnList
            : [],
        });
        if (blockedByYellow) {
          setStatus({
            error: ['Import blocked by yellow warnings. Nothing was saved.'],
            warn: warnList,
          });
        }
      } else {
        const skipBit = skippedN ? ` (${skippedN} already imported skipped)` : '';
        setStatus({
          success: [`Imported ${savedList.length || out.imported || 0} session(s)${skipBit}.`],
          warn: warnList,
        });
        const flashWarn = warnList;
        await adminProviderDetail(providerId);
        if (flashWarn.length) setUploadIssues([], flashWarn, savedList);
      }
    } catch (e) {
      const split = splitFailedBySeverity(e.failed || e.errors, e.warnings);
      setUploadIssues(split.reds, split.yellows);
      setStatus({
        error: split.reds.length ? split.reds : [e.message || 'Import failed.'],
        warn: split.yellows,
      });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Import sessions';
      }
    }
  };
  document.getElementById('pGenTimesheet').onclick = async () => {
    try {
      const weekStart = document.getElementById('pWeekStart').value;
      const schoolId = document.getElementById('pTimesheetSchool')?.value || '';
      if (!weekStart) throw new Error('Select a week start date.');
      await api('POST', '/week/ensure', {
        providerId,
        weekStart,
        schoolId: schoolId || undefined,
      });
      await fetchAndShowTimesheet({
        weekStart,
        providerId,
        providerName: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
        schoolId: schoolId || undefined,
      });
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('pSendTimesheet').onclick = async () => {
    const btn = document.getElementById('pSendTimesheet');
    const hint = document.getElementById('pSendTimesheetHint');
    try {
      const weekStart = document.getElementById('pWeekStart').value;
      const schoolId = document.getElementById('pTimesheetSchool')?.value || '';
      if (!weekStart) throw new Error('Select a week start date.');
      const ensured = await api('POST', '/week/ensure', {
        providerId,
        weekStart,
        schoolId: schoolId || undefined,
      });
      const weekId = ensured.week?.id;
      if (!weekId) throw new Error('Could not open this provider week.');
      const q = new URLSearchParams({
        weekStart,
        providerId,
      });
      if (schoolId) q.set('schoolId', schoolId);
      const detail = await api('GET', `/week?${q.toString()}`);
      const signerEmail = detail.week?.signerEmail || ensured.week?.signerEmail || '';
      const signerName = detail.week?.signerName || ensured.week?.signerName || '';
      const sessions = detail.sessions || [];
      const errors = detail.errors || [];
      const block = timesheetSendBlockReason({
        week: detail.week || ensured.week,
        sessions,
        locked: ['submitted', 'signed', 'locked'].includes(String(detail.week?.status || '')),
        errors,
        signerEmail,
      });
      if (block) {
        if (hint) {
          hint.hidden = false;
          hint.className = 'err-inline';
          hint.textContent = block;
        }
        setStatus({ error: [block], warn: detail.warnings || [] });
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Sending…';
      if (hint) {
        hint.hidden = false;
        hint.className = 'muted';
        hint.textContent = 'Sending timesheet — this can take up to a minute…';
      }
      const out = await api(
        'POST',
        `/weeks/${weekId}/submit`,
        { signerName, signerEmail, schoolId: schoolId || detail.week?.schoolId || undefined },
        { timeoutMs: 120000 },
      );
      const okMsg = out.message || 'Timesheet sent. Status is now Pending.';
      setStatus({ success: [okMsg], warn: detail.warnings || [] });
      showActionToast(okMsg, 'success');
      await adminProviderDetail(providerId);
    } catch (e) {
      const errs = Array.isArray(e.errors) && e.errors.length ? e.errors : [e.message || 'Unable to send timesheet.'];
      const warns = Array.isArray(e.warnings) ? e.warnings : [];
      setStatus({ error: errs, warn: warns });
      if (hint) {
        hint.hidden = false;
        hint.className = 'err-inline';
        hint.textContent = errs[0] || 'Unable to send timesheet.';
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send timesheet';
      }
    }
  };
  document.getElementById('pAddlSave').onclick = async () => {
    try {
      const additionalServiceType = document.getElementById('pAddlType').value;
      const studentId = document.getElementById('pAddlStudent').value;
      const dateOfService = document.getElementById('pAddlDos').value.trim();
      if (!additionalServiceType) throw new Error('Select a service type.');
      if (!studentId) throw new Error('Select a child.');
      if (!dateOfService) throw new Error('Enter the date of service.');
      const weekStart = mondayFromDos(dateOfService) || mondayIso();
      const childSchoolId = String(
        sessions.find((x) => x.studentId === studentId)?.schoolId
          || mandates.find((m) => m.studentId === studentId)?.schoolId
          || '',
      ).trim();
      const ensured = await api('POST', '/week/ensure', {
        providerId,
        weekStart,
        schoolId: childSchoolId || undefined,
      });
      await api('POST', '/week/sessions', {
        weekId: ensured.week?.id,
        studentId,
        dateOfService,
        beginTime: document.getElementById('pAddlBegin').value,
        endTime: document.getElementById('pAddlEnd').value,
        attendance: additionalServiceType === 'paid_absence' ? 'attended' : 'attended',
        additionalServiceType,
        cptLabel: document.getElementById('pAddlCpt')?.value?.trim() || '',
        notes: document.getElementById('pAddlNotes').value,
      });
      setStatus('Additional service saved.', 'ok');
      await adminProviderDetail(providerId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.querySelectorAll('[data-del-file]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this file record?')) return;
        await api('DELETE', `/admin/files/${btn.getAttribute('data-del-file')}`);
        setStatus('File removed.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-save-note]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const id = btn.getAttribute('data-save-note');
        const body = document.querySelector(`[data-note-body="${id}"]`)?.value?.trim();
        if (!body) throw new Error('Note text is required.');
        await api('PATCH', `/admin/providers/${providerId}/notes/${id}`, { body });
        setStatus('Note updated.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-note]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Delete this internal note? This cannot be undone.')) return;
        await api('DELETE', `/admin/providers/${providerId}/notes/${btn.getAttribute('data-del-note')}`);
        setStatus('Note deleted.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-mandate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this mandate? This cannot be undone.')) return;
        await api('DELETE', `/admin/mandates/${btn.getAttribute('data-del-mandate')}`);
        setStatus('Mandate removed.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-del-week]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const st = btn.getAttribute('data-week-status') || 'draft';
        if (!confirm(`Remove this ${st} week? All sessions for this week will be deleted. This cannot be undone.`)) return;
        await api('DELETE', `/admin/weeks/${btn.getAttribute('data-del-week')}`);
        setStatus('Week removed.', 'ok');
        await adminProviderDetail(providerId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.querySelectorAll('[data-triage-week]').forEach((btn) => {
    btn.addEventListener('click', () =>
      showTriageDetail(btn.getAttribute('data-triage-error') || '', btn.getAttribute('data-triage-week') || ''),
    );
  });
}

async function adminSchoolDetail(schoolId) {
  const [detail, duesOut] = await Promise.all([
    api('GET', `/admin/schools/${schoolId}`),
    api('GET', '/admin/reports/due-dates'),
  ]);
  const school = detail.school;
  const cal = detail.calendar;
  const dueDates = (duesOut.rows || []).filter((d) => d.schoolId === schoolId);
  const calSummary = detail.schoolCalendarSummary || formatCalendarSummary(cal);
  const calendarEmpty =
    !cal?.yearStart && !cal?.yearEnd && !(cal?.offDays || []).length;
  const calFallbackWarn =
    detail.calendarFallbackWarning ||
    (calendarEmpty
      ? `No school calendar for ${school.name || 'this school'} — falling back to Mon–Fri (weekends excluded; no holiday off-days).`
      : '');
  const setup = schoolSetupFromApi(
    school,
    cal,
    typeof detail.setupIncomplete === 'boolean'
      ? {
          incomplete: detail.setupIncomplete,
          missingCalendar: detail.setupMissingCalendar,
          missingAddress: detail.setupMissingAddress,
          message: detail.setupIncompleteMessage,
        }
      : null,
  );
  const setupBanner = setup.incomplete
    ? `<div class="err-box school-setup-banner"><strong>School setup incomplete</strong><p>${esc(setup.message || 'This school needs a calendar and/or address.')}</p>
        <ul>${setup.missingCalendar ? '<li>Add a school calendar (first day, last day, off days).</li>' : ''}${setup.missingAddress ? '<li>Add a full address (street, city, state, zip) for HHA CreatePatient.</li>' : ''}</ul></div>`
    : '';
  view(`
    <div class="card">
      <button type="button" class="btn" id="backSchools">← Schools</button>
      <h2 class="${setup.incomplete ? 'school-name-incomplete' : ''}">${esc(school.name || 'School')}</h2>
      ${setupBanner}
      <p class="muted">${esc(detail.studentCount || 0)} children on caseload</p>
      <div class="row">
        <label>School name <input id="sname" value="${esc(school.name || '')}" /></label>
        <label>District <input id="sdistrict" value="${esc(school.district || '')}" /></label>
      </div>
      <div class="row">
        <label>Signer name <input id="signerName" value="${esc(school.signerName || '')}" /></label>
        <label>Signer email <input id="signerEmail" value="${esc(school.signerEmail || '')}" /></label>
      </div>
      <p class="muted">School address is used when TMS creates an HHA patient (CreatePatient).</p>
      <div class="row">
        <label>Address <input id="saddress1" value="${esc(school.address1 || '')}" placeholder="Street" /></label>
        <label>City <input id="scity" value="${esc(school.city || '')}" /></label>
      </div>
      <div class="row">
        <label>State <input id="sstate" value="${esc(school.state || '')}" placeholder="NY" maxlength="2" /></label>
        <label>Zip <input id="szip" value="${esc(school.zipCode || '')}" placeholder="11514" /></label>
      </div>
      <button type="button" class="btn-primary" id="saveSchool">Save school</button>
      <button type="button" class="btn" id="deleteSchool">Remove school</button>
    </div>
    <div class="card" id="schoolCalendarSection">
      <h3>School calendar</h3>
      <p class="muted">School year dates and closed days (holidays and breaks). Used for school-day mandate tracking.</p>
      ${
        calFallbackWarn
          ? `<div class="warn-box cal-fallback-banner" id="calFallbackBanner"><strong>${esc(calFallbackWarn)}</strong><p>Cycle mandates currently use Mon–Fri until first day, last day, and off days are set.</p></div>`
          : ''
      }
      <div id="calSavedView" class="cal-saved-view">${renderCalendarSavedHtml(cal, school.name)}</div>
      <div class="row">
        <label>First day (YYYY-MM-DD) <input id="calYearStart" type="date" value="${esc(cal?.yearStart || '')}" /></label>
        <label>Last day (YYYY-MM-DD) <input id="calYearEnd" type="date" value="${esc(cal?.yearEnd || '')}" /></label>
      </div>
      <div class="row">
        <label>Add off day <input id="calOffDayPick" type="date" /></label>
        <button type="button" class="btn" id="calAddOffDay">Add off day</button>
      </div>
      <ul id="calOffDaysList" class="off-days-list"></ul>
      <label>Paste off days (one YYYY-MM-DD per line)
        <textarea id="calOffDaysPaste" rows="3" placeholder="2026-11-27&#10;2026-12-25"></textarea>
      </label>
      <div class="cal-pdf-upload">
        <h4>Upload calendar PDF</h4>
        <p class="muted">Text-based district calendars that list holidays/closed days (e.g. “Thanksgiving Recess Nov 27–28, 2025”). Scanned image-only PDFs will not work.</p>
        <div class="row">
          <label>Calendar PDF <input id="calPdfFile" type="file" accept="application/pdf,.pdf" /></label>
          <button type="button" class="btn" id="calParsePdf">Parse PDF</button>
        </div>
        <div id="calPdfPreview" class="cal-pdf-preview" hidden></div>
      </div>
      <button type="button" class="btn-primary" id="calSave">Save calendar</button>
      ${calSummary ? `<p class="muted" style="margin-top:0.5rem">Saved: ${esc(calSummary)}</p>` : ''}
    </div>
    <div class="card">
      <h3>Progress-report due dates</h3>
      <p class="muted">Assign report due dates for this school. Use <strong>Notes</strong> for school-wide context or a specific child name (e.g. “only for child X”). Multiple assignments of the same type are allowed.</p>
      <input type="hidden" id="dueEditId" value="" />
      <div class="row">
        <label>Type
          <select id="dueKind">
            <option value="progress">Progress</option>
            <option value="annual">Annual</option>
            <option value="reeval">Reevaluation</option>
          </select>
        </label>
        <label>Due Date <input id="dueOn" type="date" /></label>
      </div>
      <label>Notes <input id="dueNotes" placeholder="e.g. only for child X, or school-wide note" /></label>
      <div class="row">
        <button type="button" class="btn-primary" id="duebtn">Add due date</button>
        <button type="button" class="btn" id="dueCancelEdit" hidden>Cancel edit</button>
      </div>
      ${bulkBar('school-dues')}
      <table>
        <tr>${bulkTh('school-dues')}<th>Type</th><th>Due Date</th><th>Notes</th><th>Status</th><th></th></tr>
        ${dueDates.map((r) => `<tr>
          ${bulkTd('school-dues', r.id)}
          <td>${esc(r.kind === 'annual' ? 'Annual' : r.kind === 'reeval' ? 'Reevaluation' : 'Progress')}</td>
          <td>${esc(r.dueOn)}</td>
          <td>${esc(r.notes || '—')}</td>
          <td>${esc(r.status)}</td>
          <td>
            <button type="button" class="btn" data-edit-due="${esc(r.id)}">Edit</button>
            <button type="button" class="btn" data-del-due="${esc(r.id)}">Remove</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="6">None yet</td></tr>'}
      </table>
    </div>
  `);

  let calOffDays = [...(cal?.offDays || [])].sort();
  const calOffDaysList = document.getElementById('calOffDaysList');
  const renderCalOffDays = () => {
    if (!calOffDaysList) return;
    calOffDaysList.innerHTML = calOffDays.length
      ? calOffDays.map((d) => `<li>${esc(d)} <button type="button" class="btn" data-rm-off="${esc(d)}">Remove</button></li>`).join('')
      : '<li class="muted">No off days yet.</li>';
    calOffDaysList.querySelectorAll('[data-rm-off]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const date = btn.getAttribute('data-rm-off');
        if (!confirm(`Remove off day ${date}?`)) return;
        calOffDays = calOffDays.filter((x) => x !== date);
        renderCalOffDays();
      });
    });
  };
  renderCalOffDays();
  document.getElementById('calAddOffDay').onclick = () => {
    const d = document.getElementById('calOffDayPick').value;
    if (!d) return;
    if (!calOffDays.includes(d)) calOffDays = [...calOffDays, d].sort();
    document.getElementById('calOffDayPick').value = '';
    renderCalOffDays();
  };
  document.getElementById('calParsePdf').onclick = async () => {
    const preview = document.getElementById('calPdfPreview');
    try {
      const file = document.getElementById('calPdfFile')?.files?.[0];
      if (!file) {
        setStatus('Choose a school calendar PDF first.', 'err');
        return;
      }
      setStatus('Reading calendar PDF…', 'ok');
      const pdfBase64 = await fileToBase64(file);
      const res = await api('POST', `/admin/schools/${schoolId}/calendar/parse`, { pdfBase64 });
      const parsed = res.parsed || {};
      const proposed = res.proposed || {};
      const extracted = Array.isArray(parsed.offDays) ? parsed.offDays : [];
      if (proposed.yearStart) document.getElementById('calYearStart').value = proposed.yearStart;
      if (proposed.yearEnd) document.getElementById('calYearEnd').value = proposed.yearEnd;
      calOffDays = [...new Set([...(proposed.offDays || []), ...calOffDays])].sort();
      renderCalOffDays();
      const warnLines = Array.isArray(parsed.warnings) ? parsed.warnings : [];
      const sample = extracted.slice(0, 12).map((d) => esc(d)).join(', ');
      const more = extracted.length > 12 ? ` … (+${extracted.length - 12} more)` : '';
      if (preview) {
        preview.hidden = false;
        preview.className = extracted.length ? 'cal-pdf-preview ok-box' : 'cal-pdf-preview warn-box';
        preview.innerHTML = `
          <strong>${esc(res.message || `Parsed ${extracted.length} off day(s).`)}</strong>
          ${proposed.yearStart || proposed.yearEnd ? `<p>First/last: ${esc(proposed.yearStart || '—')} → ${esc(proposed.yearEnd || '—')}</p>` : ''}
          ${extracted.length ? `<p>Off days preview: ${sample}${more}</p>` : ''}
          ${warnLines.length ? `<p>${warnLines.map((w) => esc(w)).join('<br/>')}</p>` : ''}
          <p class="muted">Review the list above, then click <strong>Save calendar</strong> to keep these dates.</p>
        `;
      }
      setStatus(
        extracted.length
          ? `Parsed ${extracted.length} off day(s) from PDF — review and save.`
          : (res.message || 'No off days found in PDF.'),
        extracted.length ? 'ok' : 'err',
      );
    } catch (e) {
      if (preview) {
        preview.hidden = false;
        preview.className = 'cal-pdf-preview warn-box';
        preview.innerHTML = `<strong>${esc(e.message || 'PDF parse failed.')}</strong>`;
      }
      setStatus(e.message, 'err');
    }
  };
  document.getElementById('calSave').onclick = async () => {
    try {
      const paste = document.getElementById('calOffDaysPaste').value || '';
      const pasted = paste.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      const offDays = [...new Set([...calOffDays, ...pasted])].sort();
      await api('POST', `/admin/schools/${schoolId}/calendar`, {
        yearStart: document.getElementById('calYearStart').value,
        yearEnd: document.getElementById('calYearEnd').value,
        offDays,
      });
      setStatus('School calendar saved.', 'ok');
      await adminSchoolDetail(schoolId);
      void refreshSchoolsSetupBadge();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('backSchools').onclick = () => adminSchools();
  document.getElementById('saveSchool').onclick = async () => {
    try {
      await api('POST', '/admin/schools', {
        id: schoolId,
        name: document.getElementById('sname').value,
        district: document.getElementById('sdistrict').value,
        signerName: document.getElementById('signerName').value,
        signerEmail: document.getElementById('signerEmail').value,
        address1: document.getElementById('saddress1').value,
        city: document.getElementById('scity').value,
        state: document.getElementById('sstate').value,
        zipCode: document.getElementById('szip').value,
      });
      setStatus('School saved.', 'ok');
      await adminSchoolDetail(schoolId);
      void refreshSchoolsSetupBadge();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('deleteSchool').onclick = async () => {
    try {
      if (!confirm('Remove this school? Its due dates will be deleted and children will be unlinked from it. This cannot be undone.')) return;
      await api('DELETE', `/admin/schools/${schoolId}`);
      setStatus('School removed.', 'ok');
      await adminSchools();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.getElementById('duebtn').onclick = async () => {
    try {
      const editId = (document.getElementById('dueEditId')?.value || '').trim();
      const payload = {
        schoolId,
        kind: document.getElementById('dueKind').value,
        dueOn: document.getElementById('dueOn').value,
        notes: document.getElementById('dueNotes').value,
      };
      if (editId) payload.id = editId;
      await api('POST', '/admin/due-dates', payload);
      setStatus(editId ? 'Due date updated.' : 'Progress-report due date saved. Alerts remain until marked complete.', 'ok');
      document.getElementById('dueOn').value = '';
      document.getElementById('dueNotes').value = '';
      document.getElementById('dueEditId').value = '';
      document.getElementById('duebtn').textContent = 'Add due date';
      const cancelBtn = document.getElementById('dueCancelEdit');
      if (cancelBtn) cancelBtn.hidden = true;
      await adminSchoolDetail(schoolId);
    } catch (e) { setStatus(e.message, 'err'); }
  };
  const dueCancelEdit = document.getElementById('dueCancelEdit');
  if (dueCancelEdit) {
    dueCancelEdit.onclick = () => {
      document.getElementById('dueEditId').value = '';
      document.getElementById('dueOn').value = '';
      document.getElementById('dueNotes').value = '';
      document.getElementById('dueKind').value = 'progress';
      document.getElementById('duebtn').textContent = 'Add due date';
      dueCancelEdit.hidden = true;
    };
  }
  document.querySelectorAll('[data-edit-due]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-edit-due');
      const row = dueDates.find((d) => d.id === id);
      if (!row) return;
      document.getElementById('dueEditId').value = row.id;
      document.getElementById('dueKind').value = row.kind === 'annual' || row.kind === 'reeval' ? row.kind : 'progress';
      document.getElementById('dueOn').value = row.dueOn || '';
      document.getElementById('dueNotes').value = row.notes || '';
      document.getElementById('duebtn').textContent = 'Save changes';
      if (dueCancelEdit) dueCancelEdit.hidden = false;
      document.getElementById('dueNotes')?.focus();
    });
  });
  bindBulkDelete('school-dues', {
    noun: 'due dates',
    deleteOne: (id) => api('DELETE', `/admin/due-dates/${id}`),
    refresh: () => adminSchoolDetail(schoolId),
  });
  document.querySelectorAll('[data-del-due]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this progress-report due date? Related alerts will stop. This cannot be undone.')) return;
        await api('DELETE', `/admin/due-dates/${btn.getAttribute('data-del-due')}`);
        setStatus('Due date removed.', 'ok');
        await adminSchoolDetail(schoolId);
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminProviders() {
  const [usersOut, providersOut] = await Promise.all([
    api('GET', '/admin/users'),
    api('GET', '/admin/providers'),
  ]);
  const users = usersOut.users || [];
  const providers = providersOut.providers || [];
  const orphanPurge = providersOut.orphanPurge;
  if (orphanPurge?.deleted?.length) {
    const kept = orphanPurge.retained?.length
      ? ` Kept ${orphanPurge.retained.length} named orphan(s) that still hold caseload with no linked account.`
      : '';
    setStatus(
      `Cleaned ${orphanPurge.deleted.length} orphan provider profile(s).${kept}`,
      orphanPurge.retained?.length ? 'warn' : 'ok',
    );
  }
  const therapists = users.filter((u) => u.role === 'therapist');
  // List every provider profile (not only therapist logins). Orphans are purged on this GET when empty/merged.
  const providerRows = [...providers]
    .sort((a, b) => {
      const an = `${a.lastName || ''} ${a.firstName || ''}`.trim().toLowerCase();
      const bn = `${b.lastName || ''} ${b.firstName || ''}`.trim().toLowerCase();
      return an.localeCompare(bn);
    })
    .map((p) => {
      const u =
        (p.userId ? users.find((x) => x.id === p.userId) : null) ||
        users.find((x) => x.providerId === p.id) ||
        null;
      const name = `${p.firstName || ''} ${p.lastName || ''}`.trim() || u?.displayName || p.id;
      const orphan = !String(p.userId || '').trim() && !u;
      return { p, u, name, pid: p.id, orphan };
    });
  const loginOnly = therapists.filter(
    (u) => !providers.some((p) => p.id === u.providerId || p.userId === u.id),
  );
  view(`
    <div class="card entry-card">
      <div class="entry-collapsed" id="addProviderCollapsed">
        <button type="button" class="btn-primary" id="openAddProvider">Add provider</button>
      </div>
      <div id="addProviderForm" hidden>
        <h2>Add provider</h2>
        <p class="muted">Creates one linked account and provider profile.</p>
        <label>Email <input id="temail" type="email" autocomplete="off" /></label>
        <div class="row">
          <label>First name <input id="tfirst" /></label>
          <label>Last name <input id="tlast" /></label>
        </div>
        <div class="row">
          <label>Discipline
            <select id="tdisc"><option>OT</option><option selected>PT</option><option>SLP</option></select>
          </label>
        </div>
        ${payRatesFieldset({}, 't')}
        <label>HHA caregiver code (optional) <input id="thha" /></label>
        <label>Internal note (optional; hidden from the therapist) <textarea id="tnote" rows="3"></textarea></label>
        <div class="entry-form-actions">
          <button class="btn-primary big" id="createTherapist">Create provider</button>
          <button type="button" class="btn" id="cancelAddProvider">Cancel</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Providers</h2>
      ${bulkBar('providers')}
      <table>
        <tr>${bulkTh('providers')}<th>Name</th><th>Email</th><th>Provider id</th><th>Discipline</th><th></th></tr>
        ${providerRows.map(({ p, u, name, pid, orphan }) => `<tr data-provider-row data-provider-name="${esc(name || '')}">
            ${bulkTd('providers', pid, ' data-bulk-kind="provider"')}
            <td>${providerNameLink(pid, name || '—')}${orphan ? ' <span class="muted">(no account)</span>' : ''}</td>
            <td>${esc(u?.email || '—')}</td>
            <td>${esc(pid)}</td>
            <td>${esc(p.discipline || '—')}</td>
            <td>
              <button type="button" class="btn" data-open-provider="${esc(pid)}">Open</button>
              <button type="button" class="btn" data-del-provider="${esc(pid)}">Remove</button>
            </td>
          </tr>`).join('') || ''}
        ${loginOnly.map((u) => `<tr>
            ${bulkTd('providers', u.id, ' data-bulk-kind="user"')}
            <td>${esc(u.displayName || '—')} <span class="muted">(account only)</span></td>
            <td>${esc(u.email)}</td>
            <td>—</td>
            <td>—</td>
            <td><button type="button" class="btn" data-remove-therapist="${esc(u.id)}">Remove</button></td>
          </tr>`).join('')}
        ${!providerRows.length && !loginOnly.length ? '<tr><td colspan="6">None yet</td></tr>' : ''}
      </table>
    </div>
  `);

  bindBulkDelete('providers', {
    noun: 'providers',
    deleteOne: (id, el) => {
      const kind = el.getAttribute('data-bulk-kind') || 'provider';
      if (kind === 'user') return api('DELETE', `/admin/users/${id}`);
      return api('DELETE', `/admin/providers/${id}`);
    },
    refresh: () => adminProviders(),
  });

  const setAddProviderOpen = (open) => {
    const c = document.getElementById('addProviderCollapsed');
    const f = document.getElementById('addProviderForm');
    if (c) c.hidden = open;
    if (f) f.hidden = !open;
  };
  document.getElementById('openAddProvider').onclick = () => setAddProviderOpen(true);
  document.getElementById('cancelAddProvider').onclick = () => setAddProviderOpen(false);

  document.querySelectorAll('[data-remove-therapist]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this therapist account? There is no provider profile. The account will be deleted and removed from this list.')) return;
        const id = btn.getAttribute('data-remove-therapist');
        const out = await api('DELETE', `/admin/users/${id}`);
        setStatus(out.message || 'Therapist removed.', 'ok');
        await adminProviders();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.getElementById('createTherapist').onclick = async () => {
    try {
      const note = document.getElementById('tnote').value.trim();
      const out = await api('POST', '/admin/therapists', {
        email: document.getElementById('temail').value,
        firstName: document.getElementById('tfirst').value,
        lastName: document.getElementById('tlast').value,
        discipline: document.getElementById('tdisc').value,
        ...readPayRatesFromIds({
          min30: 't30',
          min42: 't42',
          min45: 't45',
          hour: 'tHour',
          g30: 'tG30',
          g42: 'tG42',
          g45: 'tG45',
          eval: 'tEval',
          extra: 'tExtra',
        }),
        hhaCaregiverCode: document.getElementById('thha').value,
        role: 'therapist',
      });
      const providerId = out.provider?.id;
      if (note && providerId) {
        await api('POST', `/admin/providers/${providerId}/notes`, { body: note });
      }
      setStatus(out.message || `Provider ready: ${out.user?.email} ↔ ${providerId}`, 'ok');
      await adminProviders();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  bindOpenProviderLinks();
  document.querySelectorAll('[data-del-provider]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this provider? The profile and internal notes will be deleted, and the linked therapist account will be deactivated. Mandates remain but become unassigned. This cannot be undone.')) return;
        await api('DELETE', `/admin/providers/${btn.getAttribute('data-del-provider')}`);
        setStatus('Provider removed.', 'ok');
        await adminProviders();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminSchools(opts = {}) {
  if (opts.focusSchoolId) state.focusSchoolId = opts.focusSchoolId;
  const schoolsOut = await api('GET', '/admin/schools');
  const schools = schoolsOut.schools || [];
  const calendarsBySchoolId = schoolsOut.calendarsBySchoolId || {};
  const setupBySchoolId = schoolsOut.setupBySchoolId || {};
  const incompleteSchools = schools
    .map((s) => ({
      school: s,
      setup: schoolSetupFromApi(s, calendarsBySchoolId[s.id], setupBySchoolId[s.id]),
    }))
    .filter((x) => x.setup.incomplete);
  updateSchoolsSetupBadge(incompleteSchools.length);
  const setupAlert = incompleteSchools.length
    ? `<div class="err-box school-setup-banner status-banner">
        <strong>${incompleteSchools.length === 1 ? '1 school needs setup' : `${incompleteSchools.length} schools need setup`}</strong>
        <p>Schools stay red until a calendar and full address are saved (address is required for HHA CreatePatient).</p>
        <ul>${incompleteSchools.map(({ school: s, setup }) => {
          const needs = [
            setup.missingCalendar ? 'calendar' : '',
            setup.missingAddress ? 'address' : '',
          ].filter(Boolean).join(' + ');
          return `<li><button type="button" class="linkish school-name-incomplete" data-open-school="${esc(s.id)}">${esc(s.name)}</button> — needs ${esc(needs)}</li>`;
        }).join('')}</ul>
      </div>`
    : '';
  view(`
    <div class="card entry-card">
      <div class="entry-collapsed" id="addSchoolCollapsed">
        <button type="button" class="btn-primary" id="openAddSchool">Add school</button>
      </div>
      <div id="addSchoolForm" hidden>
        <h2>Add school</h2>
        <label>School <input id="sname" /></label>
        <label>Signer name <input id="signerName" /></label>
        <label>Signer email <input id="signerEmail" /></label>
        <div class="entry-form-actions">
          <button class="btn-primary big" id="school">Save school</button>
          <button type="button" class="btn" id="cancelAddSchool">Cancel</button>
        </div>
      </div>
    </div>
    ${setupAlert}
    <div class="card">
      <h2>Schools</h2>
      <p class="muted">Open a school to manage the signer, address, progress-report due dates, and calendar. Incomplete schools are shown in red until calendar and address are set.</p>
      ${bulkBar('schools')}
      <table>
        <tr>${bulkTh('schools')}<th>School</th><th>Signer</th><th>Setup</th><th>Calendar</th><th></th></tr>
        ${schools.map((s) => {
          const cal = calendarsBySchoolId[s.id];
          const summary = formatCalendarSummary(cal);
          const setup = schoolSetupFromApi(s, cal, setupBySchoolId[s.id]);
          const setupLabel = setup.incomplete
            ? [
                setup.missingCalendar ? 'Calendar' : '',
                setup.missingAddress ? 'Address' : '',
              ].filter(Boolean).join(' + ') || 'Incomplete'
            : 'Ready';
          return `<tr class="${setup.incomplete ? 'school-row-incomplete' : ''}">
          ${bulkTd('schools', s.id)}
          <td><button type="button" class="linkish ${setup.incomplete ? 'school-name-incomplete' : ''}" data-open-school="${esc(s.id)}">${esc(s.name)}</button></td>
          <td>${esc(s.signerName || s.signerEmail || '')}</td>
          <td>${setup.incomplete ? `<span class="school-setup-flag">${esc(`Needs ${setupLabel}`)}</span>` : '<span class="muted">Ready</span>'}</td>
          <td>${summary ? esc(summary) : '<span class="muted">Not set</span>'}</td>
          <td>
            <button type="button" class="btn" data-open-school="${esc(s.id)}">Open</button>
            <button type="button" class="btn" data-del-school="${esc(s.id)}">Remove</button>
          </td>
        </tr>`;
        }).join('') || '<tr><td colspan="6">None</td></tr>'}
      </table>
    </div>
  `);

  bindBulkDelete('schools', {
    noun: 'schools',
    deleteOne: async (id) => {
      if (state.focusSchoolId === id) state.focusSchoolId = '';
      await api('DELETE', `/admin/schools/${id}`);
    },
    refresh: () => adminSchools(),
  });

  const setAddSchoolOpen = (open) => {
    const c = document.getElementById('addSchoolCollapsed');
    const f = document.getElementById('addSchoolForm');
    if (c) c.hidden = open;
    if (f) f.hidden = !open;
  };
  document.getElementById('openAddSchool').onclick = () => setAddSchoolOpen(true);
  document.getElementById('cancelAddSchool').onclick = () => setAddSchoolOpen(false);

  document.querySelectorAll('[data-open-school]').forEach((btn) => {
    btn.addEventListener('click', () => adminSchoolDetail(btn.getAttribute('data-open-school')));
  });
  document.querySelectorAll('[data-del-school]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this school? Its due dates will be deleted and children will be unlinked from it. This cannot be undone.')) return;
        const id = btn.getAttribute('data-del-school');
        if (state.focusSchoolId === id) state.focusSchoolId = '';
        const out = await api('DELETE', `/admin/schools/${id}`);
        setStatus(out.message || 'School removed.', 'ok');
        await adminSchools();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
  document.getElementById('school').onclick = async () => {
    try {
      const out = await api('POST', '/admin/schools', {
        name: document.getElementById('sname').value,
        signerName: document.getElementById('signerName').value,
        signerEmail: document.getElementById('signerEmail').value,
      });
      const schoolId = out.school?.id || '';
      setStatus('School saved.', 'ok');
      if (schoolId) await adminSchoolDetail(schoolId);
      else await adminSchools();
    } catch (e) { setStatus(e.message, 'err'); }
  };

  if (opts.focusSchoolId) {
    await adminSchoolDetail(opts.focusSchoolId);
  }
}

async function adminAdmins() {
  const usersOut = await api('GET', '/admin/users');
  const admins = (usersOut.users || []).filter((u) => u.role === 'admin');
  view(`
    <div class="card entry-card">
      <div class="entry-collapsed" id="addAdminCollapsed">
        <button type="button" class="btn-primary" id="openAddAdmin">Add admin</button>
      </div>
      <div id="addAdminForm" hidden>
        <h2>Add admin</h2>
        <p class="muted">Invites another office account (Cognito Admin group). Only existing administrators can do this.</p>
        <label>Email <input id="aemail" type="email" autocomplete="off" /></label>
        <label>Display name <input id="aname" placeholder="Optional" /></label>
        <div class="entry-form-actions">
          <button class="btn-primary big" id="createAdmin">Invite admin</button>
          <button type="button" class="btn" id="cancelAddAdmin">Cancel</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Admins</h2>
      ${bulkBar('admins')}
      <table>
        <tr>${bulkTh('admins')}<th>Name</th><th>Email</th><th></th></tr>
        ${admins.map((u) => {
          const self = state.email && u.email && state.email.toLowerCase() === String(u.email).toLowerCase();
          return `<tr>
            ${self ? bulkTdEmpty() : bulkTd('admins', u.id)}
            <td>${esc(u.displayName || '—')}</td>
            <td>${esc(u.email)}</td>
            <td>${
              self
                ? '—'
                : `<button type="button" class="btn" data-remove-admin="${esc(u.id)}">Remove</button>`
            }</td>
          </tr>`;
        }).join('') || '<tr><td colspan="4">None yet</td></tr>'}
      </table>
    </div>
  `);

  bindBulkDelete('admins', {
    noun: 'admins',
    deleteOne: (id) => api('DELETE', `/admin/users/${id}`),
    refresh: () => adminAdmins(),
  });

  const setAddAdminOpen = (open) => {
    const c = document.getElementById('addAdminCollapsed');
    const f = document.getElementById('addAdminForm');
    if (c) c.hidden = open;
    if (f) f.hidden = !open;
  };
  document.getElementById('openAddAdmin').onclick = () => setAddAdminOpen(true);
  document.getElementById('cancelAddAdmin').onclick = () => setAddAdminOpen(false);

  document.getElementById('createAdmin').onclick = async () => {
    try {
      const email = document.getElementById('aemail').value.trim();
      const displayName = document.getElementById('aname').value.trim();
      if (!email) throw new Error('Email is required.');
      const out = await api('POST', '/admin/users', {
        email,
        displayName: displayName || email,
        role: 'admin',
      });
      setStatus(out.message || `Admin invited: ${out.user?.email}`, 'ok');
      await adminAdmins();
    } catch (e) { setStatus(e.message, 'err'); }
  };
  document.querySelectorAll('[data-remove-admin]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!confirm('Remove this administrator? Their account will be deleted and removed from this list.')) return;
        const id = btn.getAttribute('data-remove-admin');
        const out = await api('DELETE', `/admin/users/${id}`);
        setStatus(out.message || 'Admin removed.', 'ok');
        await adminAdmins();
      } catch (e) { setStatus(e.message, 'err'); }
    });
  });
}

async function adminMandates() {
  const [studentsOut, providersOut] = await Promise.all([
    api('GET', '/students'),
    api('GET', '/admin/providers'),
  ]);
  const students = studentsOut.students || [];
  const providers = providersOut.providers || [];
  const preview = state.caseloadPreview;
  const previewRows = preview?.rows || [];
  const previewErrors = preview?.errors || [];
  const previewWarnings = preview?.warnings || [];
  view(`
    <div class="card">
      <h2>Import caseload</h2>
      <p class="muted">Use the KU export <strong>Related Service by serviceschool (WG)</strong> (Listing Results sheet) as CSV or Excel (.xls / .xlsx). Import saves immediately.</p>
      <p class="muted" style="margin-top:0.35rem">Columns: CR Recommended School, Student Last/First Name, CR Expected Grade, CR Decision/Status, Related Service, RS Start/End, RS Ratio, RS Frequency, RS Period, <strong>RS Duration</strong>, RS Location, RS Provider. Optional when present: Group Size, Program ID, Program Type, Date of Birth. (Older short headers still work.)</p>
      <p class="muted" style="margin-top:0.35rem">Frequency: <em>Weekly</em> = sessions per week; <em>Monthly</em> = sessions per calendar month; <em>6 day cycle</em> = N sessions per 6 school days. Providers must already exist in TMS and match “Last, First” or “First Last”. Agency labels such as “White Glove” or “White, Glove” are invalid — use the therapist name. Unmatched RS Provider rows are skipped (no empty-provider mandates).</p>
      <input id="caseloadFile" type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      <div class="row" style="margin-top:0.6rem">
        <button class="btn-primary" id="caseloadImportBtn">Import caseload</button>
        ${preview ? `<button type="button" class="btn" id="caseloadCompleteBtn">Complete</button>` : ''}
      </div>
      ${preview ? `
      <p style="margin-top:0.8rem">${previewRows.length} mandate row(s) · ${preview.createdStudents || 0} new students · ${preview.updatedStudents || 0} updated students · ${preview.createdSchools || 0} new schools · ${preview.createdMandates || 0} new mandates · ${preview.updatedMandates || 0} updated mandates</p>
      ${previewErrors.length ? `
      <div class="err-box caseload-issues status-banner" id="caseloadErrorsBox">
        <button type="button" class="status-banner-dismiss" data-clear-caseload-issues aria-label="Dismiss errors">×</button>
        <strong>Errors (${previewErrors.length})</strong>
        <p class="muted" style="margin:0.35rem 0 0.5rem">One issue per row. Correct these in the spreadsheet, then import again. Valid rows in the table below can still be imported.</p>
        <table class="issue-table">
          <tr><th>Row #</th><th>Field</th><th>Issue</th><th>Resolution</th></tr>
          ${previewErrors.map((e) => {
            const rowNum = e.row ?? e.rowNumber ?? 0;
            const rowLabel = Number(rowNum) > 0 ? String(rowNum) : 'File';
            const field = e.field || (e.student ? String(e.student) : '—');
            const problem = e.problem || e.message || '';
            const fix = e.fix || '';
            return `<tr class="row-err">
              <td>${esc(rowLabel)}</td>
              <td>${esc(field)}${e.student ? `<div class="muted">${esc(String(e.student))}</div>` : ''}</td>
              <td>${esc(problem)}</td>
              <td>${esc(fix || '—')}</td>
            </tr>`;
          }).join('')}
        </table>
        <button type="button" class="btn status-clear-btn" data-clear-caseload-issues>Clear</button>
      </div>` : ''}
      ${previewWarnings.length ? `
      <div class="warn-box caseload-issues status-banner" id="caseloadWarningsBox">
        <button type="button" class="status-banner-dismiss" data-clear-caseload-issues aria-label="Dismiss warnings">×</button>
        <strong>Warnings (${previewWarnings.length})</strong>
        <table class="issue-table">
          <tr><th>Row #</th><th>Field</th><th>Issue</th><th>Resolution</th></tr>
          ${previewWarnings.map((w) => {
            const rowNum = w.row ?? w.rowNumber ?? 0;
            const rowLabel = Number(rowNum) > 0 ? String(rowNum) : 'File';
            const field = w.field || '—';
            const problem = w.problem || w.message || '';
            const fix = w.fix || '';
            return `<tr>
              <td>${esc(rowLabel)}</td>
              <td>${esc(field)}${w.student ? `<div class="muted">${esc(String(w.student))}</div>` : ''}</td>
              <td>${esc(problem)}</td>
              <td>${esc(fix || '—')}</td>
            </tr>`;
          }).join('')}
        </table>
        <button type="button" class="btn status-clear-btn" data-clear-caseload-issues>Clear</button>
      </div>` : ''}
      <table>
        <tr><th>Row</th><th>Student</th><th>School</th><th>Service</th><th>Ratio</th><th>Freq</th><th>RS Provider</th><th>Assigned to</th></tr>
        ${(() => {
          const errRows = new Set(
            previewErrors.map((e) => Number(e.row ?? e.rowNumber)).filter((n) => Number.isFinite(n) && n > 0),
          );
          const providerLabel = (id) => {
            if (!id) return '';
            const p = providers.find((x) => x.id === id);
            return p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() || id : id;
          };
          return previewRows.map((r) => {
            const badRow = errRows.has(Number(r.rowNumber));
            const cls = badRow ? 'row-err' : '';
            const assigned = providerLabel(r.providerId);
            const assignedNote = r.providerMatched
              ? ' <span class="muted">(matched)</span>'
              : '';
            return `<tr${cls ? ` class="${cls}"` : ''}>
              <td>${esc(String(r.rowNumber || ''))}</td>
              <td>${esc(r.firstName)} ${esc(r.lastName)}${r.grade ? ` <span class="muted">(gr ${esc(r.grade)})</span>` : ''}</td>
              <td>${esc(r.schoolName || '')}</td>
              <td>${esc(r.serviceType || r.discipline || '')}${
                r.billingServiceName
                  ? `<div class="muted" style="font-size:0.85rem">${esc(r.billingServiceName)}</div>`
                  : ''
              }</td>
              <td>${r.ratioGroup ? 'Group' : 'Individual'}</td>
              <td>${esc(r.freqDisplay || '')}</td>
              <td>${esc(r.providerName || '—')}${badRow ? ' <span class="err-inline">(see Errors)</span>' : ''}</td>
              <td>${esc(assigned || '—')}${assignedNote}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="8">No valid rows to import</td></tr>';
        })()}
      </table>` : ''}
    </div>
    <div class="card entry-card">
      <div class="entry-collapsed" id="addMandateCollapsed">
        <button type="button" class="btn-primary" id="openAddMandate">Add mandate manually</button>
      </div>
      <div id="addMandateForm" hidden>
        <h2>Add mandate manually</h2>
        <p class="muted"><strong>Type</strong> is <strong>Weekly</strong>, <strong>6-Day Cycle</strong>, <strong>Monthly</strong>, or <strong>Makeup auth</strong>. Makeup auth uses a remaining session pool; unlinked makeups use Makeup auth, miss-linked makeups do not.</p>
        <div class="row">
          <label>Student
            <select id="manStudent">${studentOptions(students)}</select>
          </label>
          <label>Provider
            <select id="manProvider">${providerOptions(providers)}</select>
          </label>
        </div>
        <div class="row">
          <label>Service type <input id="manService" placeholder="PT School" /></label>
          <label>Type
            <select id="manKind">${mandateTypeOptions('weekly')}</select>
          </label>
        </div>
        <div class="row">
          <label>Ratio
            <select id="manRatio">
              <option value="individual">Individual</option>
              <option value="group">Group</option>
            </select>
          </label>
          <label>Group size <input id="manGroupSize" type="number" min="1" step="1" placeholder="1" /></label>
        </div>
        <div class="row">
          <label>Duration (minutes) <input id="manDuration" type="number" min="1" step="1" placeholder="30" /></label>
          <label>Freq / count <input id="manFreq" type="number" min="0" step="1" placeholder="2" /></label>
        </div>
        <div class="row">
          <label>Start / end
            <div class="row">
              <input id="manStart" type="date" />
              <input id="manEnd" type="date" />
            </div>
          </label>
        </div>
        <div class="entry-form-actions">
          <button type="button" class="btn-primary big" id="manSave">Save mandate</button>
          <button type="button" class="btn" id="cancelAddMandate">Cancel</button>
        </div>
      </div>
    </div>
  `);

  async function readCaseloadFile() {
    const file = document.getElementById('caseloadFile').files[0];
    if (!file) throw new Error('Select a CSV or Excel file first.');
    const name = file.name || '';
    const mime = file.type || '';
    if (/\.xlsx?$/i.test(name) || /excel|spreadsheetml/i.test(mime)) {
      const fileBase64 = await fileToBase64(file);
      state.caseloadImport = { fileName: name, mime, fileBase64 };
      return state.caseloadImport;
    }
    const csvText = await file.text();
    state.caseloadImport = { fileName: name, mime, csvText };
    return state.caseloadImport;
  }

  document.getElementById('caseloadImportBtn').onclick = async () => {
    try {
      clearStatus();
      document.querySelectorAll('[data-clear-caseload-issues]').forEach((b) => {
        b.closest('.caseload-issues')?.remove();
      });
      const payload = await readCaseloadFile();
      const out = await api('POST', '/admin/caseloads/import', payload);
      state.caseloadPreview = out;
      const errN = (out.errors || []).length;
      const warnN = (out.warnings || []).length;
      const createdM = out.createdMandates || 0;
      const updatedM = out.updatedMandates || 0;
      const createdS = out.createdStudents || 0;
      const updatedS = out.updatedStudents || 0;
      const saved =
        createdM > 0 || updatedM > 0 || createdS > 0 || updatedS > 0 || (out.rows || []).length > 0;
      const summary = `${createdM} new / ${updatedM} updated mandate(s), ${createdS} new / ${updatedS} updated student(s)`;
      // Re-render first so the status chip is not wiped by navigation work.
      await adminMandates();
      if (errN && !saved) {
        setStatus(`Import failed — no rows were saved. ${errN} row error(s). See the table below.`, 'err');
      } else if (errN || warnN) {
        setStatus(
          `Imported with warnings: ${errN ? `${errN} row error(s)` : ''}${errN && warnN ? ', ' : ''}${warnN ? `${warnN} warning(s)` : ''}. Saved: ${summary}.`,
          errN ? 'warn' : 'ok',
        );
      } else {
        setStatus(`Import complete: ${summary}.`, 'ok');
      }
    } catch (e) { setStatus(e.message, 'err'); }
  };

  document.querySelectorAll('[data-clear-caseload-issues]').forEach((btn) => {
    btn.onclick = () => {
      const box = btn.closest('.caseload-issues');
      if (box) box.remove();
      clearStatus();
    };
  });

  const completeBtn = document.getElementById('caseloadCompleteBtn');
  if (completeBtn) {
    completeBtn.onclick = async () => {
      state.caseloadPreview = null;
      state.caseloadImport = null;
      setStatus('Import results cleared.', 'ok');
      await adminMandates();
    };
  }

  const setAddMandateOpen = (open) => {
    const c = document.getElementById('addMandateCollapsed');
    const f = document.getElementById('addMandateForm');
    if (c) c.hidden = open;
    if (f) f.hidden = !open;
  };
  document.getElementById('openAddMandate').onclick = () => setAddMandateOpen(true);
  document.getElementById('cancelAddMandate').onclick = () => setAddMandateOpen(false);

  document.getElementById('manSave').onclick = async () => {
    try {
      const studentId = document.getElementById('manStudent').value;
      const { mandateKind, frequencyKind } = parseMandateTypeValue(document.getElementById('manKind').value);
      const freq = Number(document.getElementById('manFreq').value);
      const durationRaw = document.getElementById('manDuration').value;
      const groupSizeRaw = document.getElementById('manGroupSize').value;
      const durationMinutes = durationRaw === '' ? null : Number(durationRaw);
      const ratioGroup = document.getElementById('manRatio').value === 'group';
      const groupSize = groupSizeRaw === '' ? (ratioGroup ? 2 : 1) : Number(groupSizeRaw);
      if (!studentId) throw new Error('Select a student.');
      if (!Number.isFinite(freq) || freq < 0) throw new Error('Enter frequency or makeup count.');
      if (durationMinutes != null && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
        throw new Error('Duration must be a positive number of minutes.');
      }
      if (!Number.isFinite(groupSize) || groupSize <= 0) {
        throw new Error('Group size must be a positive number.');
      }
      const out = await api('POST', '/admin/mandates', {
        studentId,
        providerId: document.getElementById('manProvider').value,
        serviceType: document.getElementById('manService').value || (mandateKind === 'makeup_auth' ? 'Makeup authorization' : ''),
        mandateKind,
        ratioGroup,
        durationMinutes,
        groupSize,
        frequencyKind,
        frequencyPerWeek: freq,
        sessionsPerPeriod: freq,
        periodSchoolDays: frequencyKind === 'school_day_cycle' ? 6 : undefined,
        startOn: document.getElementById('manStart').value,
        endOn: document.getElementById('manEnd').value,
      });
      setStatus(out.message || 'Mandate saved.', 'ok');
      await adminMandates();
    } catch (e) { setStatus(e.message, 'err'); }
  };
}

function weekProgressRowsHtml(progressRows) {
  return (progressRows || [])
    .map((r) => {
      const expected = Number(r.mandateExpected || 0);
      const delivered = Number(r.sessionsProvided ?? 0);
      const notes = Number(r.notesPosted ?? 0);
      const deliveredPct =
        r.sessionsDeliveredPct != null
          ? Number(r.sessionsDeliveredPct)
          : Number(r.progressPct ?? 0);
      const notesPct = r.notesPostedPct != null ? Number(r.notesPostedPct) : 0;
      const below =
        r.belowMandate === true ||
        (expected > 0 && delivered < expected);
      const deliveredLabel = expected > 0
        ? `${delivered}/${expected} (${deliveredPct}%)`
        : `${delivered} (${deliveredPct}%)`;
      const notesLabel = expected > 0
        ? `${notes}/${expected} (${notesPct}%)`
        : `${notes} (${notesPct}%)`;
      return `<tr class="${below ? 'row-warn' : ''}">
            <td><button type="button" class="linkish" data-open-child="${esc(r.studentId)}">${esc(r.childName)}</button></td>
            <td>${esc(r.providerName || '—')}</td>
            <td>${esc(r.programType || '—')}</td>
            <td>${esc(r.mandateLabel || '—')}</td>
            <td>${esc(r.weekLabel || r.weekStart || '—')}</td>
            <td>${esc(deliveredLabel)}</td>
            <td>${esc(notesLabel)}</td>
          </tr>`;
    })
    .join('') || '<tr><td colspan="7">No sessions in this week range.</td></tr>';
}

function reportDateDefaults() {
  const fromDefault = state.reportFrom || (() => {
    const d = new Date(`${mondayIso()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 28);
    return d.toISOString().slice(0, 10);
  })();
  const toDefault = state.reportTo || mondayIso();
  const from = state.reportFrom || fromDefault;
  const to = state.reportTo || toDefault;
  state.reportFrom = from;
  state.reportTo = to;
  return { from, to };
}

function bindReportDetailChrome() {
  const back = document.getElementById('backReports');
  if (back) {
    back.onclick = () => {
      state.reportView = '';
      adminReports();
    };
  }
  document.getElementById('view').onclick = async (e) => {
    const openChild = e.target.closest('[data-open-child]');
    if (openChild) {
      state.childDetailTab = 'basic';
      sessionStorage.setItem('tmsChildDetailTab', 'basic');
      adminChildDetail(openChild.getAttribute('data-open-child'), { backTo: 'reports' });
      return;
    }
    const delDue = e.target.closest('[data-del-due]');
    if (delDue) {
      try {
        if (!confirm('Remove this progress report due date? Alerts for it will stop. This cannot be undone.')) return;
        await api('DELETE', `/admin/due-dates/${delDue.getAttribute('data-del-due')}`);
        setStatus('Due date removed.', 'ok');
        adminReports();
      } catch (err) {
        setStatus(err.message, 'err');
      }
      return;
    }
    const btn = e.target.closest('[data-complete]');
    if (!btn) return;
    try {
      await api('POST', `/admin/due-dates/${btn.getAttribute('data-complete')}/complete`, {});
      setStatus('Due date marked complete. Alerts stopped.', 'ok');
      adminReports();
    } catch (err) {
      setStatus(err.message, 'err');
    }
  };
}

function adminReportsLanding() {
  state.reportView = '';
  view(`
    <div class="card">
      <h2>Reports</h2>
      <p class="muted">Open a report to review caseload progress, last dates of service, progress-report due dates, internal notes, or session note totals.</p>
      <ul class="report-pick">
        ${REPORT_LIST.map(
          (r) => `<li>
            <button type="button" data-open-report="${esc(r.id)}">
              <span class="report-pick-copy">
                <span class="report-pick-title">${esc(r.title)}</span>
                <span class="report-pick-blurb muted">${esc(r.blurb)}</span>
              </span>
              <span class="report-pick-go">Open</span>
            </button>
          </li>`,
        ).join('')}
      </ul>
    </div>
  `);
  document.querySelectorAll('[data-open-report]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.reportView = btn.getAttribute('data-open-report') || '';
      adminReports();
    });
  });
}

async function adminReportWeekProgress() {
  const { from, to } = reportDateDefaults();
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  view(`
    <div class="card">
      <button type="button" class="btn" id="backReports">← Reports</button>
      <h2>Weekly session progress</h2>
      <p class="muted">Sessions delivered % and notes posted % versus each child's mandate. Missed sessions do not count as delivered; missed and attended both count toward notes posted. Yellow rows are below mandate.</p>
      <div class="row">
        <label>Week from <input id="progFrom" type="date" value="${esc(from)}" /></label>
        <label>Week to <input id="progTo" type="date" value="${esc(to)}" /></label>
        <button type="button" class="btn-primary" id="progLoad" disabled>Loading…</button>
        <button type="button" class="btn" id="progXlsx">Export Excel</button>
      </div>
      <table>
        <tr>
          <th>Child</th>
          <th>Provider</th>
          <th>Program type</th>
          <th>Mandate</th>
          <th>Week</th>
          <th>Sessions delivered %</th>
          <th>Notes posted %</th>
        </tr>
        <tbody id="progBody"><tr><td colspan="7">Loading…</td></tr></tbody>
      </table>
    </div>
  `);
  bindReportDetailChrome();
  const loadBtn = document.getElementById('progLoad');
  const loadProgress = async () => {
    if (loadBtn?.disabled) return;
    state.reportFrom = document.getElementById('progFrom').value || from;
    state.reportTo = document.getElementById('progTo').value || to;
    const nextFrom = state.reportFrom;
    const nextTo = state.reportTo;
    const qq = `from=${encodeURIComponent(nextFrom)}&to=${encodeURIComponent(nextTo)}`;
    const tbody = document.getElementById('progBody');
    if (loadBtn) {
      loadBtn.disabled = true;
      loadBtn.textContent = 'Loading…';
    }
    if (tbody) tbody.innerHTML = '<tr><td colspan="7">Loading…</td></tr>';
    try {
      const progress = await api('GET', `/admin/reports/week-progress?${qq}`);
      if (tbody) tbody.innerHTML = weekProgressRowsHtml(progress.rows || []);
      setStatus('', '');
    } catch (e) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7">${esc(e.message || 'Unable to load progress.')}</td></tr>`;
      }
      setStatus(e.message || 'Unable to load progress.', 'err');
    } finally {
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Load';
      }
    }
  };
  if (loadBtn) loadBtn.onclick = () => loadProgress();
  const progXlsx = document.getElementById('progXlsx');
  if (progXlsx) {
    progXlsx.onclick = async () => {
      try {
        const f = document.getElementById('progFrom')?.value || from;
        const t = document.getElementById('progTo')?.value || to;
        const qq = `from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
        await downloadReportXlsx(`/admin/reports/week-progress.xlsx?${qq}`, 'weekly-session-progress.xlsx');
        setStatus('Downloaded weekly-session-progress.xlsx.', 'ok');
      } catch (e) {
        setStatus(e.message, 'err');
      }
    };
  }
  try {
    const progress = await api('GET', `/admin/reports/week-progress?${q}`);
    const progBody = document.getElementById('progBody');
    if (progBody) progBody.innerHTML = weekProgressRowsHtml(progress.rows || []);
  } catch (e) {
    const progBody = document.getElementById('progBody');
    if (progBody) {
      progBody.innerHTML = `<tr><td colspan="7">${esc(e.message || 'Unable to load progress.')}</td></tr>`;
    }
    setStatus(e.message || 'Unable to load progress.', 'err');
  } finally {
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load';
    }
  }
}

async function adminReportLastService() {
  const lastProviderId = state.lastServiceProviderId || '';
  const providersOut = await api('GET', '/admin/providers').catch(() => ({ providers: [] }));
  const providers = providersOut.providers || [];
  view(`
    <div class="card">
      <button type="button" class="btn" id="backReports">← Reports</button>
      <h2>Last date of service</h2>
      <p class="muted">Most recent attended or makeup date of service by child and provider. Filter by provider as needed.</p>
      <div class="row">
        <label>Provider
          <select id="lastProvider">
            <option value="">All providers</option>
            ${providers.map((p) => {
              const label = `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.id;
              const sel = lastProviderId === p.id ? ' selected' : '';
              return `<option value="${esc(p.id)}"${sel}>${esc(label)}</option>`;
            }).join('')}
          </select>
        </label>
        <button type="button" class="btn-primary" id="lastLoad">Load</button>
        <button type="button" class="btn" id="lastXlsx">Export Excel</button>
      </div>
      <table><tr><th>Child</th><th>Provider</th><th>School</th><th>Last DOS</th></tr>
      <tbody id="lastBody"><tr><td colspan="4">Loading…</td></tr></tbody>
      </table>
    </div>
  `);
  bindReportDetailChrome();
  const lastLoad = document.getElementById('lastLoad');
  if (lastLoad) {
    lastLoad.onclick = async () => {
      state.lastServiceProviderId = document.getElementById('lastProvider')?.value || '';
      await adminReports();
    };
  }
  const lastXlsx = document.getElementById('lastXlsx');
  if (lastXlsx) {
    lastXlsx.onclick = async () => {
      try {
        const pid = document.getElementById('lastProvider')?.value || '';
        const qq = pid ? `providerId=${encodeURIComponent(pid)}` : '';
        await downloadReportXlsx(`/admin/reports/last-service.xlsx${qq ? `?${qq}` : ''}`, 'last-service.xlsx');
        setStatus('Downloaded last-service.xlsx.', 'ok');
      } catch (e) {
        setStatus(e.message, 'err');
      }
    };
  }
  const lastQ = lastProviderId ? `providerId=${encodeURIComponent(lastProviderId)}` : '';
  const lastBody = document.getElementById('lastBody');
  try {
    const last = await api('GET', `/admin/reports/last-service${lastQ ? `?${lastQ}` : ''}`);
    if (lastBody) {
      lastBody.innerHTML =
        (last.rows || [])
          .map(
            (r) =>
              `<tr><td>${childNameLink(r.studentId, r.name)}</td><td>${esc(r.providerName || '—')}</td><td>${esc(r.schoolName || '—')}</td><td>${esc(r.lastDos)}</td></tr>`,
          )
          .join('') || '<tr><td colspan="4">None</td></tr>';
    }
  } catch (e) {
    if (lastBody) {
      lastBody.innerHTML = `<tr><td colspan="4">${esc(e.message || 'Unable to load last service dates.')}</td></tr>`;
    }
    setStatus(e.message || 'Unable to load last service dates.', 'err');
  }
}

async function adminReportDueDates() {
  const { from, to } = reportDateDefaults();
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  view(`
    <div class="card">
      <button type="button" class="btn" id="backReports">← Reports</button>
      <h2>Progress-report due dates</h2>
      <p class="muted">School progress, annual, and reevaluation due dates in the selected range.</p>
      <div class="row">
        <label>From <input id="dueFrom" type="date" value="${esc(from)}" /></label>
        <label>To <input id="dueTo" type="date" value="${esc(to)}" /></label>
        <button type="button" class="btn-primary" id="duesLoad">Load</button>
        <button type="button" class="btn" id="duesXlsx">Export Excel</button>
      </div>
      ${bulkBar('report-dues')}
      <table><tr>${bulkTh('report-dues')}<th>School</th><th>Type</th><th>Due Date</th><th>Notes</th><th>Status</th><th></th></tr>
      <tbody id="duesBody"><tr><td colspan="7">Loading…</td></tr></tbody>
      </table>
    </div>
  `);
  bindReportDetailChrome();
  const fillDues = (rows) => {
    const duesBody = document.getElementById('duesBody');
    if (!duesBody) return;
    duesBody.innerHTML =
      (rows || [])
        .map(
          (r) =>
            `<tr>${bulkTd('report-dues', r.id)}<td>${esc(r.schoolName || r.schoolId)}</td><td>${esc(r.kind === 'annual' ? 'Annual' : r.kind === 'reeval' ? 'Reevaluation' : 'Progress')}</td><td>${esc(r.dueOn)}</td><td>${esc(r.notes || '—')}</td><td>${esc(r.status)}</td><td>${r.completedAt ? `<button class="btn" data-del-due="${esc(r.id)}">Remove</button>` : `<button class="btn" data-complete="${esc(r.id)}">Mark complete</button> <button class="btn" data-del-due="${esc(r.id)}">Remove</button>`}</td></tr>`,
        )
        .join('') || '<tr><td colspan="7">None</td></tr>';
  };
  const loadDues = async () => {
    const f = document.getElementById('dueFrom')?.value || from;
    const t = document.getElementById('dueTo')?.value || to;
    state.reportFrom = f;
    state.reportTo = t;
    const qq = `from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
    const duesBody = document.getElementById('duesBody');
    if (duesBody) duesBody.innerHTML = '<tr><td colspan="7">Loading…</td></tr>';
    try {
      const dues = await api('GET', `/admin/reports/due-dates?${qq}`);
      fillDues(dues.rows || []);
      setStatus('', '');
    } catch (e) {
      if (duesBody) {
        duesBody.innerHTML = `<tr><td colspan="7">${esc(e.message || 'Unable to load due dates.')}</td></tr>`;
      }
      setStatus(e.message || 'Unable to load due dates.', 'err');
    }
  };
  const duesLoad = document.getElementById('duesLoad');
  if (duesLoad) duesLoad.onclick = () => loadDues();
  const duesXlsx = document.getElementById('duesXlsx');
  if (duesXlsx) {
    duesXlsx.onclick = async () => {
      try {
        const f = document.getElementById('dueFrom')?.value || from;
        const t = document.getElementById('dueTo')?.value || to;
        const qq = `from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
        await downloadReportXlsx(`/admin/reports/due-dates.xlsx?${qq}`, 'due-dates.xlsx');
        setStatus('Downloaded due-dates.xlsx.', 'ok');
      } catch (e) {
        setStatus(e.message, 'err');
      }
    };
  }
  bindBulkDelete('report-dues', {
    noun: 'due dates',
    deleteOne: (id) => api('DELETE', `/admin/due-dates/${id}`),
    refresh: () => adminReports(),
  });
  try {
    const dues = await api('GET', `/admin/reports/due-dates?${q}`);
    fillDues(dues.rows || []);
  } catch (e) {
    const duesBody = document.getElementById('duesBody');
    if (duesBody) {
      duesBody.innerHTML = `<tr><td colspan="6">${esc(e.message || 'Unable to load due dates.')}</td></tr>`;
    }
    setStatus(e.message || 'Unable to load due dates.', 'err');
  }
}

function formatArchiveWhen(iso) {
  const s = String(iso || '').trim();
  if (!s) return '—';
  const d = s.slice(0, 10);
  const t = s.length >= 16 ? s.slice(11, 16) : '';
  return t ? `${d} ${t}` : d;
}

function archiveSourceLabel(sourceType) {
  const v = String(sourceType || '');
  if (v === 'therapist_activity') return 'Therapist Activity';
  if (v === 'frontline') return 'Frontline';
  if (v === 'timesheet' || v === 'timesheet_signed') return 'Timesheet';
  return v || 'Upload';
}

async function openArchivePdf(archiveId) {
  const id = String(archiveId || '').trim();
  if (!id) return;
  try {
    setStatus('Opening archived PDF…', '');
    const raw = await api('GET', `/archive/${encodeURIComponent(id)}/file`);
    const blob =
      raw && raw.type && String(raw.type).includes('pdf')
        ? raw
        : new Blob([await raw.arrayBuffer()], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const existing = document.getElementById('archivePdfModal');
    if (existing) existing.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'archivePdfModal';
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-panel timesheet-print timesheet-pdf-panel">
        <div class="row" style="justify-content:space-between;align-items:center">
          <h2>Archived PDF</h2>
          <div class="row">
            <a class="btn" href="${url}" download>Download</a>
            <button type="button" class="btn" data-close-archive-pdf>Close</button>
          </div>
        </div>
        <iframe class="timesheet-pdf-frame" title="Archived PDF" src="${url}" style="display:block;width:100%;min-height:70vh;border:0"></iframe>
      </div>`;
    document.body.appendChild(backdrop);
    const close = () => {
      URL.revokeObjectURL(url);
      backdrop.remove();
    };
    backdrop.querySelector('[data-close-archive-pdf]').onclick = close;
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    setStatus('', '');
  } catch (e) {
    setStatus(e.message || 'Unable to open archived PDF.', 'error');
  }
}

async function adminReportArchive() {
  const { from, to } = reportDateDefaults();
  let providers = [];
  try {
    const list = await api('GET', '/admin/providers');
    providers = Array.isArray(list.providers) ? list.providers : Array.isArray(list) ? list : [];
  } catch {
    providers = [];
  }
  view(`
    <div class="card">
      <button type="button" class="btn" id="backReports">← Reports</button>
      <h2>Uploads &amp; timesheets archive</h2>
      <p class="muted">All uploaded session PDFs and generated timesheets. Filter by type, provider, or date.</p>
      <div class="row">
        <label>Type
          <select id="archKind">
            <option value="">All</option>
            <option value="upload">Uploads</option>
            <option value="timesheet">Timesheets</option>
          </select>
        </label>
        <label>Provider
          <select id="archProvider">
            <option value="">All providers</option>
            ${providers
              .map(
                (p) =>
                  `<option value="${esc(p.id)}">${esc(`${p.firstName || ''} ${p.lastName || ''}`.trim() || p.id)}</option>`,
              )
              .join('')}
          </select>
        </label>
        <label>From <input id="archFrom" type="date" value="${esc(from)}" /></label>
        <label>To <input id="archTo" type="date" value="${esc(to)}" /></label>
        <button type="button" class="btn-primary" id="archLoad">Load</button>
      </div>
      <div class="table-wrap"><table>
        <tr>
          <th>When</th>
          <th>Kind</th>
          <th>Type</th>
          <th>Provider</th>
          <th>Week</th>
          <th>Status</th>
          <th>File</th>
          <th></th>
        </tr>
        <tbody id="archBody"><tr><td colspan="8">Loading…</td></tr></tbody>
      </table></div>
    </div>
  `);
  bindReportDetailChrome();
  const load = async () => {
    const tbody = document.getElementById('archBody');
    const kind = document.getElementById('archKind')?.value || '';
    const providerId = document.getElementById('archProvider')?.value || '';
    const nextFrom = document.getElementById('archFrom')?.value || from;
    const nextTo = document.getElementById('archTo')?.value || to;
    state.reportFrom = nextFrom;
    state.reportTo = nextTo;
    const q = new URLSearchParams();
    if (kind) q.set('kind', kind);
    if (providerId) q.set('providerId', providerId);
    if (nextFrom) q.set('from', nextFrom);
    if (nextTo) q.set('to', nextTo);
    if (tbody) tbody.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
    try {
      const out = await api('GET', `/admin/archive?${q.toString()}`);
      const items = Array.isArray(out.items) ? out.items : [];
      if (tbody) {
        tbody.innerHTML =
          items
            .map(
              (a) => `<tr>
            <td>${esc(formatArchiveWhen(a.createdAt))}</td>
            <td>${esc(a.kind || '—')}</td>
            <td>${esc(archiveSourceLabel(a.sourceType))}</td>
            <td>${esc(a.providerName || a.providerId || '—')}</td>
            <td>${esc(a.weekStart || '—')}</td>
            <td>${esc(a.status || '—')}</td>
            <td>${esc(a.filename || '—')}</td>
            <td class="row-actions">
              ${a.hasFile ? `<button type="button" class="btn" data-open-archive="${esc(a.id)}">Open</button>` : ''}
              <button type="button" class="btn" data-delete-archive="${esc(a.id)}">Delete</button>
            </td>
          </tr>`,
            )
            .join('') || '<tr><td colspan="8">No archive items match these filters.</td></tr>';
      }
      document.querySelectorAll('[data-open-archive]').forEach((btn) => {
        btn.onclick = () => openArchivePdf(btn.getAttribute('data-open-archive'));
      });
      document.querySelectorAll('[data-delete-archive]').forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute('data-delete-archive');
          if (!id) return;
          if (!confirm('Delete this archived report? This cannot be undone.')) return;
          try {
            await api('DELETE', `/archive/${encodeURIComponent(id)}`);
            await load();
            setStatus('Archived report deleted.', 'ok');
          } catch (e) {
            setStatus(e.message || 'Unable to delete archived report.', 'err');
          }
        };
      });
      setStatus('', '');
    } catch (e) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8">${esc(e.message || 'Unable to load archive.')}</td></tr>`;
      }
      setStatus(e.message || 'Unable to load archive.', 'err');
    }
  };
  document.getElementById('archLoad')?.addEventListener('click', () => load());
  await load();
}

async function adminReportInternalNotes() {
  const { from, to } = reportDateDefaults();
  const notesProviderId = state.internalNotesProviderId || '';
  let providers = [];
  try {
    const list = await api('GET', '/admin/providers');
    providers = Array.isArray(list.providers) ? list.providers : Array.isArray(list) ? list : [];
  } catch {
    providers = [];
  }
  view(`
    <div class="card">
      <button type="button" class="btn" id="backReports">← Reports</button>
      <h2>Internal notes</h2>
      <p class="muted">All administrator internal notes across providers. Filter by date range and provider.</p>
      <div class="row">
        <label>From <input id="notesFrom" type="date" value="${esc(from)}" /></label>
        <label>To <input id="notesTo" type="date" value="${esc(to)}" /></label>
        <label>Provider
          <select id="notesProvider">
            <option value="">All providers</option>
            ${providers
              .map((p) => {
                const label = `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.id;
                const sel = notesProviderId === p.id ? ' selected' : '';
                return `<option value="${esc(p.id)}"${sel}>${esc(label)}</option>`;
              })
              .join('')}
          </select>
        </label>
        <button type="button" class="btn-primary" id="notesLoad">Load</button>
        <button type="button" class="btn" id="notesXlsx">Export Excel</button>
      </div>
      <div class="table-wrap"><table>
        <tr>
          <th>When</th>
          <th>Provider</th>
          <th>Author</th>
          <th>Tags</th>
          <th>Note</th>
        </tr>
        <tbody id="notesBody"><tr><td colspan="5">Loading…</td></tr></tbody>
      </table></div>
    </div>
  `);
  bindReportDetailChrome();
  const fillNotes = (rows) => {
    const tbody = document.getElementById('notesBody');
    if (!tbody) return;
    tbody.innerHTML =
      (rows || [])
        .map((r) => {
          const when = String(r.createdAt || '').slice(0, 16).replace('T', ' ') || '—';
          const tags =
            (r.tags || []).map((t) => `<span class="status-chip">${esc(t)}</span>`).join(' ') || '—';
          return `<tr>
            <td>${esc(when)}</td>
            <td>${esc(r.providerName || '—')}</td>
            <td>${esc(r.authorName || '—')}</td>
            <td>${tags}</td>
            <td style="white-space:pre-wrap">${esc(r.body || '')}</td>
          </tr>`;
        })
        .join('') || '<tr><td colspan="5">No internal notes match these filters.</td></tr>';
  };
  const loadNotes = async () => {
    const nextFrom = document.getElementById('notesFrom')?.value || from;
    const nextTo = document.getElementById('notesTo')?.value || to;
    const pid = document.getElementById('notesProvider')?.value || '';
    state.reportFrom = nextFrom;
    state.reportTo = nextTo;
    state.internalNotesProviderId = pid;
    const q = new URLSearchParams();
    if (nextFrom) q.set('from', nextFrom);
    if (nextTo) q.set('to', nextTo);
    if (pid) q.set('providerId', pid);
    const tbody = document.getElementById('notesBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    try {
      const out = await api('GET', `/admin/reports/internal-notes?${q.toString()}`);
      fillNotes(out.rows || []);
      setStatus('', '');
    } catch (e) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="5">${esc(e.message || 'Unable to load internal notes.')}</td></tr>`;
      }
      setStatus(e.message || 'Unable to load internal notes.', 'err');
    }
  };
  document.getElementById('notesLoad')?.addEventListener('click', () => loadNotes());
  const notesXlsx = document.getElementById('notesXlsx');
  if (notesXlsx) {
    notesXlsx.onclick = async () => {
      try {
        const f = document.getElementById('notesFrom')?.value || from;
        const t = document.getElementById('notesTo')?.value || to;
        const pid = document.getElementById('notesProvider')?.value || '';
        const q = new URLSearchParams();
        if (f) q.set('from', f);
        if (t) q.set('to', t);
        if (pid) q.set('providerId', pid);
        await downloadReportXlsx(`/admin/reports/internal-notes.xlsx?${q.toString()}`, 'internal-notes.xlsx');
        setStatus('Downloaded internal-notes.xlsx.', 'ok');
      } catch (e) {
        setStatus(e.message || 'Unable to export.', 'err');
      }
    };
  }
  await loadNotes();
}

async function adminReportSessionNotes() {
  const { from, to } = reportDateDefaults();
  const notesProviderId = state.sessionNotesProviderId || '';
  const notesDistrict = state.sessionNotesDistrict || '';
  let providers = [];
  let districts = [];
  try {
    const list = await api('GET', '/admin/providers');
    providers = Array.isArray(list.providers) ? list.providers : Array.isArray(list) ? list : [];
  } catch {
    providers = [];
  }
  try {
    const schoolsOut = await api('GET', '/admin/schools');
    districts = [...new Set(
      (schoolsOut.schools || []).map((s) => String(s.district || '').trim()).filter(Boolean),
    )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch {
    districts = [];
  }
  view(`
    <div class="card">
      <button type="button" class="btn" id="backReports">← Reports</button>
      <h2>Session notes</h2>
      <p class="muted">Count of session notes by attendance for a date of service range. Attended includes makeup (same as weekly progress “delivered”). Optional provider and district filters.</p>
      <div class="row">
        <label>From <input id="snFrom" type="date" value="${esc(from)}" /></label>
        <label>To <input id="snTo" type="date" value="${esc(to)}" /></label>
        <label>Provider
          <select id="snProvider">
            <option value="">All providers</option>
            ${providers
              .map((p) => {
                const label = `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.id;
                const sel = notesProviderId === p.id ? ' selected' : '';
                return `<option value="${esc(p.id)}"${sel}>${esc(label)}</option>`;
              })
              .join('')}
          </select>
        </label>
        <label>District
          <select id="snDistrict">
            <option value="">All districts</option>
            ${districts.map((d) => `<option value="${esc(d)}"${d === notesDistrict ? ' selected' : ''}>${esc(d)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="btn-primary" id="snLoad">Load</button>
        <button type="button" class="btn" id="snXlsx">Export Excel</button>
      </div>
      <div class="report-summary" id="snSummary" aria-live="polite">
        <div class="report-summary-card"><span class="report-summary-label">Attended</span><strong class="report-summary-value" id="snAttended">—</strong><span class="muted report-summary-hint">incl. makeup</span></div>
        <div class="report-summary-card"><span class="report-summary-label">Missed</span><strong class="report-summary-value" id="snMissed">—</strong></div>
        <div class="report-summary-card"><span class="report-summary-label">Total sessions</span><strong class="report-summary-value" id="snTotal">—</strong></div>
        <div class="report-summary-card report-summary-card-soft"><span class="report-summary-label">Breakdown</span><span class="muted" id="snBreakdown">—</span></div>
      </div>
      <div class="table-wrap"><table>
        <tr>
          <th>Child</th>
          <th>Provider</th>
          <th>School</th>
          <th>District</th>
          <th>Date of service</th>
          <th>Attendance</th>
          <th>Begin</th>
          <th>End</th>
        </tr>
        <tbody id="snBody"><tr><td colspan="8">Loading…</td></tr></tbody>
      </table></div>
    </div>
  `);
  bindReportDetailChrome();
  const fillSummary = (totals) => {
    const t = totals || {};
    const elA = document.getElementById('snAttended');
    const elM = document.getElementById('snMissed');
    const elT = document.getElementById('snTotal');
    const elB = document.getElementById('snBreakdown');
    if (elA) elA.textContent = String(t.attended ?? 0);
    if (elM) elM.textContent = String(t.missed ?? 0);
    if (elT) elT.textContent = String(t.total ?? 0);
    if (elB) {
      elB.textContent = `Attended only ${t.attendedOnly ?? 0} · Makeup ${t.makeup ?? 0}${
        t.other ? ` · Other ${t.other}` : ''
      }`;
    }
  };
  const fillRows = (rows) => {
    const tbody = document.getElementById('snBody');
    if (!tbody) return;
    tbody.innerHTML =
      (rows || [])
        .map(
          (r) => `<tr>
            <td>${esc(r.childName || '—')}</td>
            <td>${esc(r.providerName || '—')}</td>
            <td>${esc(r.schoolName || '—')}</td>
            <td>${esc(r.district || '—')}</td>
            <td>${esc(r.dateOfService || '—')}</td>
            <td>${esc(r.attendance || '—')}</td>
            <td>${esc(r.beginTime || '—')}</td>
            <td>${esc(r.endTime || '—')}</td>
          </tr>`,
        )
        .join('') || '<tr><td colspan="8">No session notes match these filters.</td></tr>';
  };
  const loadSessionNotes = async () => {
    const nextFrom = document.getElementById('snFrom')?.value || from;
    const nextTo = document.getElementById('snTo')?.value || to;
    const pid = document.getElementById('snProvider')?.value || '';
    const district = document.getElementById('snDistrict')?.value || '';
    state.reportFrom = nextFrom;
    state.reportTo = nextTo;
    state.sessionNotesProviderId = pid;
    state.sessionNotesDistrict = district;
    const q = new URLSearchParams();
    if (nextFrom) q.set('from', nextFrom);
    if (nextTo) q.set('to', nextTo);
    if (pid) q.set('providerId', pid);
    if (district) q.set('district', district);
    const tbody = document.getElementById('snBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8">Loading…</td></tr>';
    try {
      const out = await api('GET', `/admin/reports/session-notes?${q.toString()}`);
      fillSummary(out.totals || {});
      fillRows(out.rows || []);
      setStatus('', '');
    } catch (e) {
      fillSummary({ attended: 0, missed: 0, total: 0, attendedOnly: 0, makeup: 0 });
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8">${esc(e.message || 'Unable to load session notes.')}</td></tr>`;
      }
      setStatus(e.message || 'Unable to load session notes.', 'err');
    }
  };
  document.getElementById('snLoad')?.addEventListener('click', () => loadSessionNotes());
  const snXlsx = document.getElementById('snXlsx');
  if (snXlsx) {
    snXlsx.onclick = async () => {
      try {
        const f = document.getElementById('snFrom')?.value || from;
        const t = document.getElementById('snTo')?.value || to;
        const pid = document.getElementById('snProvider')?.value || '';
        const district = document.getElementById('snDistrict')?.value || '';
        const q = new URLSearchParams();
        if (f) q.set('from', f);
        if (t) q.set('to', t);
        if (pid) q.set('providerId', pid);
        if (district) q.set('district', district);
        await downloadReportXlsx(`/admin/reports/session-notes.xlsx?${q.toString()}`, 'session-notes.xlsx');
        setStatus('Downloaded session-notes.xlsx.', 'ok');
      } catch (e) {
        setStatus(e.message || 'Unable to export.', 'err');
      }
    };
  }
  await loadSessionNotes();
}

async function adminReports() {
  const id = state.reportView || '';
  if (!id) {
    adminReportsLanding();
    return;
  }
  if (id === 'week-progress') {
    await adminReportWeekProgress();
    return;
  }
  if (id === 'last-service') {
    await adminReportLastService();
    return;
  }
  if (id === 'due-dates') {
    await adminReportDueDates();
    return;
  }
  if (id === 'archive') {
    await adminReportArchive();
    return;
  }
  if (id === 'internal-notes') {
    await adminReportInternalNotes();
    return;
  }
  if (id === 'session-notes') {
    await adminReportSessionNotes();
    return;
  }
  adminReportsLanding();
}

// ---- Cognito sign-in (only when the build set a clientId) ----

function cognitoRegion() {
  return USER_POOL_ID.split('_')[0] || 'us-east-1';
}

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

function cognitoType(data) {
  return String(data?.__type || '').split('#').pop();
}

function loginErrorMessage(data) {
  const type = cognitoType(data);
  const plain = {
    NotAuthorizedException: 'Incorrect email or password.',
    UserNotFoundException: 'No account exists for that email. Contact the office for an invitation.',
    UserNotConfirmedException: 'This account is not confirmed yet. Contact the office for assistance.',
    PasswordResetRequiredException: 'Your password must be reset. Use Forgot password below, or contact the office for assistance.',
    InvalidPasswordException: 'That password does not meet requirements. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.',
    InvalidParameterException: 'Verify the email address and try again.',
    TooManyRequestsException: 'Too many attempts. Wait a minute and try again.',
    LimitExceededException: 'Too many attempts. Wait a minute and try again.',
    CodeMismatchException: 'Invalid confirmation code. Please try again.',
    ExpiredCodeException: 'That code has expired. Request a new code with Forgot password.',
    EnableSoftwareTokenMFAException: 'That authenticator code was not accepted. Check the time on your device and try again.',
    SoftwareTokenMFANotFoundException: 'Authenticator MFA is not set up on this account yet.',
    ResourceNotFoundException: 'Sign-in is misconfigured (incorrect app client). Contact the office for assistance.',
  };
  if (plain[type]) return plain[type];
  if (data?.message) return type ? `${data.message} (${type})` : String(data.message);
  return 'Sign-in was unsuccessful. Please try again.';
}

function changePasswordErrorMessage(data) {
  const type = cognitoType(data);
  const plain = {
    NotAuthorizedException: 'Incorrect current password. Please try again.',
    InvalidPasswordException: 'That password does not meet requirements. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.',
    InvalidParameterException: 'That password does not meet requirements. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.',
    LimitExceededException: 'Too many attempts. Wait a minute and try again.',
    TooManyRequestsException: 'Too many attempts. Wait a minute and try again.',
    CodeMismatchException: 'Invalid confirmation code. Please try again.',
    ExpiredCodeException: 'That code has expired. Request a new code with Forgot password.',
    UserNotFoundException: 'No account exists for that email. Contact the office for an invitation.',
  };
  if (plain[type]) return plain[type];
  if (data?.message) return type ? `${data.message} (${type})` : String(data.message);
  return 'Unable to change password. Please try again.';
}

const COGNITO_NETFREE_HINT =
  'Unable to reach Cognito. If you use NetFree, allowlist cognito-idp.us-east-1.amazonaws.com, then try again.';

const DEVICE_STORE_KEY = 'tmsCognitoDevice';

async function cognitoCall(target, body, errorFn = loginErrorMessage) {
  const url = `https://cognito-idp.${cognitoRegion()}.amazonaws.com/`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(COGNITO_NETFREE_HINT);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (!data.__type && !data.message) {
      throw new Error(
        `Sign-in service returned ${res.status}. If you use NetFree, allowlist cognito-idp.us-east-1.amazonaws.com.`,
      );
    }
    throw new Error(errorFn(data));
  }
  return data;
}

function applyToken(idToken, accessToken) {
  const payload = decodeJwtPayload(idToken) || {};
  const groups = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [];
  state.idToken = idToken;
  state.email = String(payload.email || payload['cognito:username'] || '');
  state.role = groups.includes('Admin') || groups.includes('admin') ? 'admin' : 'therapist';
  localStorage.setItem('tmsIdToken', idToken);
  if (arguments.length >= 2) {
    state.accessToken = accessToken || '';
    if (accessToken) localStorage.setItem('tmsAccessToken', accessToken);
    else localStorage.removeItem('tmsAccessToken');
  }
}

function tokenStillGood(token) {
  const payload = token ? decodeJwtPayload(token) : null;
  return Boolean(payload && payload.exp && payload.exp * 1000 > Date.now() + 30000);
}

function cognitoUsernameFromToken(idToken) {
  const payload = decodeJwtPayload(idToken) || {};
  return String(payload['cognito:username'] || payload.email || state.email || '').trim();
}

function loadDeviceRecord(username) {
  try {
    const raw = localStorage.getItem(DEVICE_STORE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw);
    const key = String(username || '').toLowerCase();
    return all && key && all[key] ? all[key] : null;
  } catch {
    return null;
  }
}

function saveDeviceRecord(username, record) {
  try {
    const key = String(username || '').toLowerCase();
    if (!key) return;
    const all = JSON.parse(localStorage.getItem(DEVICE_STORE_KEY) || '{}') || {};
    all[key] = record;
    localStorage.setItem(DEVICE_STORE_KEY, JSON.stringify(all));
  } catch {
    /* ignore quota */
  }
}

function clearDeviceRecord(username) {
  try {
    const key = String(username || '').toLowerCase();
    const all = JSON.parse(localStorage.getItem(DEVICE_STORE_KEY) || '{}') || {};
    if (key && all[key]) {
      delete all[key];
      localStorage.setItem(DEVICE_STORE_KEY, JSON.stringify(all));
    }
  } catch {
    /* ignore */
  }
}

function deviceAuthParams(username) {
  const rec = loadDeviceRecord(username);
  return rec?.deviceKey ? { DEVICE_KEY: rec.deviceKey } : {};
}

/** Cognito SRP-6a N (device password verifier) — amazon-cognito-identity-js INIT_N. */
const COGNITO_SRP_N = BigInt(
  '0x' +
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1' +
    '29024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245' +
    'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D' +
    'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D' +
    '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9' +
    'DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
    '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64' +
    'ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
    'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6B' +
    'F12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
    'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB31' +
    '43DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF',
);
const COGNITO_SRP_G = BigInt(2);

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  const clean = String(hex || '').replace(/^0x/i, '');
  const out = new Uint8Array(Math.ceil(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16) || 0;
  }
  return out;
}

function padHexCognito(hex) {
  let h = String(hex || '').replace(/^0x/i, '');
  if (h.length % 2 === 1) h = `0${h}`;
  else if ('89ABCDEFabcdef'.includes(h[0])) h = `00${h}`;
  return h;
}

function modPow(base, exp, mod) {
  let result = BigInt(1);
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

async function sha256HexFromUtf8(str) {
  const data = new TextEncoder().encode(str);
  const dig = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(dig));
}

async function sha256HexFromHex(hex) {
  const dig = await crypto.subtle.digest('SHA-256', hexToBytes(hex));
  return bytesToHex(new Uint8Array(dig));
}

function randomHex(byteLen) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLen));
  return bytesToHex(bytes);
}

function b64FromHex(hex) {
  const bytes = hexToBytes(hex);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function buildDeviceSecretVerifier(deviceGroupKey, username) {
  const devicePassword = randomHex(20);
  const saltRandom = randomHex(16);
  const combined = `${deviceGroupKey}${username}:${devicePassword}`;
  const hashedPassword = await sha256HexFromUtf8(combined);
  const saltHex = padHexCognito(BigInt(`0x${saltRandom}`).toString(16));
  const xHex = await sha256HexFromHex(saltHex + hashedPassword);
  const verifier = modPow(COGNITO_SRP_G, BigInt(`0x${xHex}`), COGNITO_SRP_N);
  const verifierHex = padHexCognito(verifier.toString(16));
  return {
    devicePassword,
    DeviceSecretVerifierConfig: {
      PasswordVerifier: b64FromHex(verifierHex),
      Salt: b64FromHex(saltHex),
    },
  };
}

async function rememberDeviceIfRequested(authResult, username, trustDevice) {
  if (!trustDevice || !authResult) return;
  const meta = authResult.NewDeviceMetadata;
  if (!meta?.DeviceKey || !meta?.DeviceGroupKey) return;
  try {
    const { devicePassword, DeviceSecretVerifierConfig } = await buildDeviceSecretVerifier(
      meta.DeviceGroupKey,
      username,
    );
    await cognitoCall('ConfirmDevice', {
      AccessToken: authResult.AccessToken,
      DeviceKey: meta.DeviceKey,
      DeviceName: `White Glove TMS · ${navigator.platform || 'browser'}`,
      DeviceSecretVerifierConfig,
    });
    await cognitoCall('UpdateDeviceStatus', {
      AccessToken: authResult.AccessToken,
      DeviceKey: meta.DeviceKey,
      DeviceRememberedStatus: 'remembered',
    });
    saveDeviceRecord(username, {
      deviceKey: meta.DeviceKey,
      deviceGroupKey: meta.DeviceGroupKey,
      devicePassword,
      username,
      rememberedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[mfa] remember device failed', err);
  }
}

function trustDeviceChecked() {
  const el = document.getElementById('trustDevice');
  return Boolean(el && el.checked);
}

function trustDeviceCheckboxHtml(checked = true) {
  return `<label class="trust-device"><input type="checkbox" id="trustDevice" ${checked ? 'checked' : ''} /> ${esc(t('mfa.trustDevice'))}</label>`;
}

async function getCognitoUserMfa(accessToken) {
  const out = await cognitoCall('GetUser', { AccessToken: accessToken });
  const list = Array.isArray(out.UserMFASettingList) ? out.UserMFASettingList : [];
  const attrs = Array.isArray(out.UserAttributes) ? out.UserAttributes : [];
  const phone = attrs.find((a) => a.Name === 'phone_number')?.Value || '';
  const phoneVerified = attrs.find((a) => a.Name === 'phone_number_verified')?.Value === 'true';
  const email = attrs.find((a) => a.Name === 'email')?.Value || '';
  let passkeyCount = 0;
  try {
    const creds = await cognitoCall('ListWebAuthnCredentials', { AccessToken: accessToken });
    passkeyCount = Array.isArray(creds.Credentials) ? creds.Credentials.length : 0;
  } catch {
    passkeyCount = 0;
  }
  return {
    hasSoftware: list.includes('SOFTWARE_TOKEN_MFA'),
    hasSms: list.includes('SMS_MFA'),
    hasEmail: list.includes('EMAIL_OTP'),
    preferred: out.PreferredMfaSetting || '',
    phone,
    phoneVerified,
    email,
    passkeyCount,
    hasPasskey: passkeyCount > 0,
    hasAny: list.length > 0 || passkeyCount > 0,
  };
}

function b64urlToBuf(value) {
  const s = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob(s + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

function bufToB64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function publicKeyCreateOptionsFromCognito(options) {
  const o = options && typeof options === 'object' ? structuredClone(options) : {};
  if (o.challenge) o.challenge = b64urlToBuf(o.challenge);
  if (o.user?.id) o.user.id = b64urlToBuf(o.user.id);
  if (Array.isArray(o.excludeCredentials)) {
    o.excludeCredentials = o.excludeCredentials.map((c) => ({
      ...c,
      id: typeof c.id === 'string' ? b64urlToBuf(c.id) : c.id,
    }));
  }
  return o;
}

function publicKeyRequestOptionsFromCognito(options) {
  const o = options && typeof options === 'object' ? structuredClone(options) : {};
  if (o.challenge) o.challenge = b64urlToBuf(o.challenge);
  if (Array.isArray(o.allowCredentials)) {
    o.allowCredentials = o.allowCredentials.map((c) => ({
      ...c,
      id: typeof c.id === 'string' ? b64urlToBuf(c.id) : c.id,
    }));
  }
  return o;
}

function credentialToJson(cred) {
  if (!cred) return null;
  const response = cred.response || {};
  const json = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type || 'public-key',
    response: {},
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  };
  if (response.clientDataJSON) json.response.clientDataJSON = bufToB64url(response.clientDataJSON);
  if (response.attestationObject) json.response.attestationObject = bufToB64url(response.attestationObject);
  if (response.authenticatorData) json.response.authenticatorData = bufToB64url(response.authenticatorData);
  if (response.signature) json.response.signature = bufToB64url(response.signature);
  if (response.userHandle) json.response.userHandle = bufToB64url(response.userHandle);
  if (cred.authenticatorAttachment) json.authenticatorAttachment = cred.authenticatorAttachment;
  return json;
}

function passkeySupported() {
  return Boolean(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
}

function readCachedRequireMfa() {
  try {
    const raw = localStorage.getItem('tmsRequireMfa');
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    /* ignore */
  }
  return null;
}

function cacheRequireMfa(requireMfa) {
  try {
    localStorage.setItem('tmsRequireMfa', requireMfa ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

/** Coerce API/settings value; only default when the field is truly missing. */
function coerceRequireMfa(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

/**
 * Load org MFA policy. Never invent requireMfa=true on network blips —
 * that was forcing enroll every login even when Dynamo already had OFF.
 */
async function fetchAppMfaSettings() {
  const cached = readCachedRequireMfa();
  try {
    let settings = {};
    let fromServer = false;
    if (state.role === 'admin') {
      try {
        const out = await api('GET', '/admin/settings');
        settings = out.settings || {};
        fromServer = true;
      } catch {
        const me = await api('GET', '/me');
        settings = me.settings || {};
        fromServer = true;
      }
    } else {
      const me = await api('GET', '/me');
      settings = me.settings || {};
      fromServer = true;
    }
    const requireMfa = coerceRequireMfa(
      settings.requireMfa,
      // Prefer last known OFF over inventing ON when the field is missing.
      cached != null ? cached : false,
    );
    const allowSmsMfa = settings.allowSmsMfa === true;
    cacheRequireMfa(requireMfa);
    state.meSettings = { ...(state.meSettings || {}), ...settings, requireMfa, allowSmsMfa };
    return { requireMfa, allowSmsMfa, fromServer };
  } catch {
    const requireMfa =
      cached != null ? cached : coerceRequireMfa(state.meSettings?.requireMfa, false);
    return {
      requireMfa,
      allowSmsMfa: state.meSettings?.allowSmsMfa === true,
      fromServer: false,
    };
  }
}

async function enforceMfaIfRequired() {
  if (!COGNITO_MODE || !state.accessToken) return false;
  const { requireMfa, fromServer } = await fetchAppMfaSettings();
  state.meSettings = { ...(state.meSettings || {}), requireMfa, allowSmsMfa: false };
  // Only force enroll when the server explicitly says ON. Stale cache / failed /me must not lock users out.
  if (!fromServer || requireMfa !== true) return false;
  try {
    const mfa = await getCognitoUserMfa(state.accessToken);
    if (mfa.hasAny) return false;
  } catch {
    return false;
  }
  showMfaSetup({ forced: true });
  return true;
}

function otpauthUri(secret, email) {
  const label = encodeURIComponent(`White Glove TMS:${email || 'user'}`);
  const issuer = encodeURIComponent('White Glove TMS');
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${issuer}`;
}

function qrImgHtml(otpauth) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauth)}`;
  return `<img class="mfa-qr" src="${src}" width="180" height="180" alt="Authenticator QR code" />`;
}

async function completeAuthSuccess(authResult, opts = {}) {
  const idToken = authResult?.IdToken;
  if (!idToken) throw new Error('Sign-in was unsuccessful. Please try again.');
  const accessToken = authResult.AccessToken || '';
  applyToken(idToken, accessToken);
  const username = cognitoUsernameFromToken(idToken) || opts.email || state.email;
  if (opts.trustDevice) await rememberDeviceIfRequested(authResult, username, true);
  state.schoolConfirmed = false;
  sessionStorage.removeItem('tmsSchoolConfirmed');
  state.programConfirmed = false;
  sessionStorage.removeItem('tmsProgramConfirmed');
  openingAccountView();
  // Prefer Dynamo/API role (admin) over Cognito groups alone — fixes Admin invite left in Therapist group.
  try {
    const me = await api('GET', '/me');
    if (me?.user?.role === 'admin' || me?.user?.role === 'therapist') {
      state.role = me.user.role;
    }
  } catch {
    /* keep token-derived role */
  }
  await showRole();
}

async function handleAuthResponse(out, ctx) {
  const challenge = out?.ChallengeName;
  if (!challenge) {
    await completeAuthSuccess(out.AuthenticationResult || {}, ctx);
    return;
  }
  if (challenge === 'NEW_PASSWORD_REQUIRED') {
    showNewPassword(ctx.email, out.Session);
    return;
  }
  if (challenge === 'SOFTWARE_TOKEN_MFA' || challenge === 'SMS_MFA' || challenge === 'EMAIL_OTP') {
    showMfaChallenge(ctx.email, out.Session, challenge, ctx);
    return;
  }
  if (challenge === 'SELECT_MFA_TYPE') {
    showSelectMfaType(ctx.email, out.Session, out.ChallengeParameters || {}, ctx);
    return;
  }
  if (challenge === 'WEB_AUTHN') {
    await completeWebAuthnChallenge(ctx.email, out.Session, out.ChallengeParameters || {}, ctx);
    return;
  }
  if (challenge === 'SELECT_CHALLENGE') {
    await handleSelectChallenge(out, ctx);
    return;
  }
  if (challenge === 'MFA_SETUP') {
    showMfaSetup({ forced: true, session: out.Session, email: ctx.email, fromChallenge: true });
    return;
  }
  throw new Error(`Unsupported sign-in step (${challenge}). Contact the office for assistance.`);
}

/** Cognito puts choice-based factors on AvailableChallenges (top-level array), not ChallengeParameters. */
function availableAuthChallenges(out) {
  const top = Array.isArray(out?.AvailableChallenges) ? out.AvailableChallenges : [];
  const params = out?.ChallengeParameters || {};
  const raw = params.AVAILABLE_CHALLENGES || params.MFAS_CAN_CHOOSE || '';
  let fromParams = [];
  if (Array.isArray(raw)) fromParams = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      fromParams = Array.isArray(parsed) ? parsed : String(raw).split(/[,\s]+/);
    } catch {
      fromParams = String(raw).split(/[,\s]+/);
    }
  }
  return [
    ...new Set(
      [...top, ...fromParams]
        .map((s) => String(s || '').trim())
        .filter(Boolean),
    ),
  ];
}

async function handleSelectChallenge(out, ctx) {
  const params = out.ChallengeParameters || {};
  const available = availableAuthChallenges(out);
  if (available.includes('WEB_AUTHN') && ctx.preferPasskey) {
    const credParam = params.CREDENTIAL_REQUEST_OPTIONS || params.credentialRequestOptions;
    if (credParam) {
      await completeWebAuthnChallenge(ctx.email, out.Session, params, ctx);
      return;
    }
    const next = await cognitoCall('RespondToAuthChallenge', {
      ChallengeName: 'SELECT_CHALLENGE',
      ClientId: CLIENT_ID,
      Session: out.Session,
      ChallengeResponses: { USERNAME: ctx.email, ANSWER: 'WEB_AUTHN' },
    });
    await handleAuthResponse(next, ctx);
    return;
  }
  if (ctx.preferPasskey) {
    throw new Error(t('mfa.passkeyNotRegistered'));
  }
  throw new Error('Unsupported sign-in choice. Try password sign-in.');
}

async function completeWebAuthnChallenge(email, session, params, ctx = {}) {
  if (!passkeySupported()) throw new Error(t('mfa.passkeyNeedSecure'));
  let optionsRaw = params.CREDENTIAL_REQUEST_OPTIONS || params.credentialRequestOptions || '';
  if (typeof optionsRaw === 'string' && optionsRaw) {
    try {
      optionsRaw = JSON.parse(optionsRaw);
    } catch {
      /* keep string */
    }
  }
  if (!optionsRaw || typeof optionsRaw !== 'object') {
    throw new Error('Passkey challenge missing options. Try again.');
  }
  const publicKey = publicKeyRequestOptionsFromCognito(optionsRaw.publicKey || optionsRaw);
  const assertion = await navigator.credentials.get({ publicKey });
  const credential = JSON.stringify(credentialToJson(assertion));
  const out = await cognitoCall('RespondToAuthChallenge', {
    ChallengeName: 'WEB_AUTHN',
    ClientId: CLIENT_ID,
    Session: session,
    ChallengeResponses: {
      USERNAME: email,
      CREDENTIAL: credential,
    },
  });
  await handleAuthResponse(out, { email, ...ctx });
}

function signOut(message) {
  state.idToken = '';
  state.accessToken = '';
  state.email = '';
  state.selectedSchoolId = '';
  state.schoolConfirmed = false;
  state.selectedProgramType = '';
  state.programConfirmed = false;
  sessionStorage.removeItem('tmsSchoolId');
  sessionStorage.removeItem('tmsSchoolConfirmed');
  sessionStorage.removeItem('tmsProgramType');
  sessionStorage.removeItem('tmsProgramConfirmed');
  localStorage.removeItem('tmsIdToken');
  localStorage.removeItem('tmsAccessToken');
  showLogin(message || '');
}

function loginError(msg) {
  const box = document.getElementById('loginErr');
  if (!box) return;
  box.textContent = msg || '';
  box.hidden = !msg;
}

function showLogin(message) {
  if (COGNITO_MODE && tokenStillGood(state.idToken)) {
    showRole();
    return;
  }
  hideAppChrome();
  setStatus('', '');
  applyStaticI18n();
  view(`
    <div class="card login-card">
      ${langSwitcherHtml(false)}
      <h2>${esc(t('login.title'))}</h2>
      <p>${esc(t('login.blurb'))}</p>
      <div id="loginErr" class="err-box" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
      <label>${esc(t('login.email'))} <input id="loginEmail" type="email" autocomplete="username" placeholder="you@example.com" /></label>
      <label>${esc(t('login.password'))} <input id="loginPassword" type="password" autocomplete="current-password" /></label>
      <button class="btn-primary big" id="loginBtn">${esc(t('login.submit'))}</button>
      ${
        passkeySupported()
          ? `<button type="button" class="btn big" id="passkeyLoginBtn" style="margin-top:.5rem">${esc(t('mfa.passkeySignIn'))}</button>
      <p class="muted" style="margin:.35rem 0 0;font-size:.85rem">${esc(t('mfa.passkeyHint'))}</p>`
          : ''
      }
      <p class="login-footer-link"><button type="button" class="linkish" id="forgotPasswordBtn">${esc(t('login.forgot'))}</button></p>
    </div>
  `);
  bindLangSwitcher(document.getElementById('view'), () => showLogin(message || ''));
  const submit = async () => {
    const btn = document.getElementById('loginBtn');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    loginError('');
    if (!email || !password) {
      loginError(t('login.needBoth'));
      return;
    }
    btn.disabled = true;
    btn.textContent = t('login.signingIn');
    try {
      const out = await cognitoCall('InitiateAuth', {
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
          ...deviceAuthParams(email),
        },
      });
      await handleAuthResponse(out, { email });
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = t('login.submit');
    }
  };
  document.getElementById('loginBtn').onclick = submit;
  document.getElementById('loginPassword').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  document.getElementById('passkeyLoginBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    loginError('');
    if (!email) {
      loginError(t('mfa.passkeyNeedEmail'));
      return;
    }
    const btn = document.getElementById('passkeyLoginBtn');
    btn.disabled = true;
    btn.textContent = t('mfa.passkeyWorking');
    try {
      const out = await cognitoCall('InitiateAuth', {
        AuthFlow: 'USER_AUTH',
        ClientId: CLIENT_ID,
        AuthParameters: {
          USERNAME: email,
          PREFERRED_CHALLENGE: 'WEB_AUTHN',
        },
      });
      await handleAuthResponse(out, { email, preferPasskey: true });
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = t('mfa.passkeySignIn');
    }
  });
  document.getElementById('forgotPasswordBtn').onclick = () => {
    const email = document.getElementById('loginEmail').value.trim();
    showForgotPassword(email);
  };
  document.getElementById('loginEmail').focus();
}

function showMfaChallenge(email, session, challengeName, ctx = {}) {
  hideAppChrome();
  setStatus('', '');
  const sms = challengeName === 'SMS_MFA';
  const emailOtp = challengeName === 'EMAIL_OTP';
  const blurb = sms ? t('mfa.challengeSms') : emailOtp ? t('mfa.challengeEmail') : t('mfa.challengeTotp');
  view(`
    <div class="card login-card">
      ${langSwitcherHtml(false)}
      <h2>${esc(t('mfa.challengeTitle'))}</h2>
      <p>${esc(blurb)}</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>${esc(t('mfa.code'))} <input id="mfaCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" /></label>
      ${trustDeviceCheckboxHtml(true)}
      <button class="btn-primary big" id="mfaBtn">${esc(t('mfa.verify'))}</button>
      <p><button type="button" class="btn" id="mfaBackBtn">${esc(t('mfa.backLogin'))}</button></p>
    </div>
  `);
  bindLangSwitcher(document.getElementById('view'), () => showMfaChallenge(email, session, challengeName, ctx));
  const submit = async () => {
    const btn = document.getElementById('mfaBtn');
    const code = document.getElementById('mfaCode').value.trim().replace(/\s+/g, '');
    loginError('');
    if (!code) {
      loginError(t('mfa.needCode'));
      return;
    }
    btn.disabled = true;
    btn.textContent = t('mfa.verifying');
    try {
      const responses = { USERNAME: email };
      if (sms) responses.SMS_MFA_CODE = code;
      else if (emailOtp) responses.EMAIL_OTP_CODE = code;
      else responses.SOFTWARE_TOKEN_MFA_CODE = code;
      const device = loadDeviceRecord(email);
      if (device?.deviceKey) responses.DEVICE_KEY = device.deviceKey;
      const out = await cognitoCall('RespondToAuthChallenge', {
        ChallengeName: challengeName,
        ClientId: CLIENT_ID,
        Session: session,
        ChallengeResponses: responses,
      });
      await handleAuthResponse(out, { email, trustDevice: trustDeviceChecked(), ...ctx });
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = t('mfa.verify');
    }
  };
  document.getElementById('mfaBtn').onclick = submit;
  document.getElementById('mfaBackBtn').onclick = () => showLogin('');
  document.getElementById('mfaCode').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  document.getElementById('mfaCode').focus();
}

function showSelectMfaType(email, session, params, ctx = {}) {
  hideAppChrome();
  const types = String(params.MFAS_CAN_CHOOSE || params.MFAS_CAN_SELECT || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hasTotp = types.includes('SOFTWARE_TOKEN_MFA') || !types.length;
  const hasEmail = types.includes('EMAIL_OTP') || types.includes('EMAIL_MFA');
  const hasSms = types.includes('SMS_MFA');
  view(`
    <div class="card login-card">
      ${langSwitcherHtml(false)}
      <h2>${esc(t('mfa.selectTitle'))}</h2>
      <p>${esc(t('mfa.selectBlurb'))}</p>
      <div id="loginErr" class="err-box" hidden></div>
      ${hasTotp ? `<button type="button" class="btn-primary big" id="pickTotp">${esc(t('mfa.pickTotp'))}</button>` : ''}
      ${hasEmail ? `<button type="button" class="btn big" id="pickEmail" style="margin-top:.5rem">${esc(t('mfa.pickEmail'))}</button>` : ''}
      ${hasSms ? `<button type="button" class="btn big" id="pickSms" style="margin-top:.5rem">${esc(t('mfa.pickSms'))}</button>` : ''}
      <p><button type="button" class="btn" id="mfaBackBtn">${esc(t('mfa.backLogin'))}</button></p>
    </div>
  `);
  bindLangSwitcher(document.getElementById('view'), () => showSelectMfaType(email, session, params, ctx));
  const pick = async (answer) => {
    loginError('');
    try {
      const out = await cognitoCall('RespondToAuthChallenge', {
        ChallengeName: 'SELECT_MFA_TYPE',
        ClientId: CLIENT_ID,
        Session: session,
        ChallengeResponses: { USERNAME: email, ANSWER: answer },
      });
      await handleAuthResponse(out, { email, ...ctx });
    } catch (e) {
      loginError(e.message);
    }
  };
  document.getElementById('pickTotp')?.addEventListener('click', () => pick('SOFTWARE_TOKEN_MFA'));
  document.getElementById('pickEmail')?.addEventListener('click', () =>
    pick(types.includes('EMAIL_MFA') && !types.includes('EMAIL_OTP') ? 'EMAIL_MFA' : 'EMAIL_OTP'),
  );
  document.getElementById('pickSms')?.addEventListener('click', () => pick('SMS_MFA'));
  document.getElementById('mfaBackBtn').onclick = () => showLogin('');
}

function showMfaSetup(opts = {}) {
  hideAppChrome();
  setStatus('', '');
  const forced = Boolean(opts.forced);
  view(`
    <div class="card login-card mfa-setup-card">
      ${langSwitcherHtml(false)}
      <h2>${esc(forced ? t('mfa.setupForcedTitle') : t('mfa.setupTitle'))}</h2>
      <p>${esc(forced ? t('mfa.setupForcedBlurb') : t('mfa.setupBlurb'))}</p>
      <div id="loginErr" class="err-box" hidden></div>
      <div class="mfa-method-list">
        <button type="button" class="btn-primary big" id="mfaEnrollTotp">${esc(t('mfa.enrollTotp'))}</button>
        <button type="button" class="btn big" id="mfaEnrollEmail" style="margin-top:.5rem">${esc(t('mfa.enrollEmail'))}</button>
        <button type="button" class="btn big" id="mfaEnrollPasskey" style="margin-top:.5rem">${esc(t('mfa.enrollPasskey'))}</button>
      </div>
      <div id="mfaEnrollPanel" hidden></div>
      ${forced ? '' : `<p><button type="button" class="btn" id="mfaSetupBack">${esc(t('mfa.back'))}</button></p>`}
    </div>
  `);
  bindLangSwitcher(document.getElementById('view'), () => showMfaSetup(opts));
  document.getElementById('mfaSetupBack')?.addEventListener('click', () => showRole());
  document.getElementById('mfaEnrollTotp').onclick = () => startTotpEnroll({ forced });
  document.getElementById('mfaEnrollEmail').onclick = () => startEmailEnroll({ forced });
  document.getElementById('mfaEnrollPasskey').onclick = () => startPasskeyEnroll({ forced });
}

async function startEmailEnroll({ forced }) {
  const panel = document.getElementById('mfaEnrollPanel');
  loginError('');
  if (!state.accessToken) {
    loginError(t('mfa.needResignSetup'));
    return;
  }
  panel.hidden = false;
  panel.innerHTML = `
    <h3>${esc(t('mfa.emailTitle'))}</h3>
    <p>${esc(t('mfa.emailBlurb'))}</p>
    <button type="button" class="btn-primary" id="emailEnableBtn">${esc(t('mfa.confirmEnable'))}</button>
  `;
  document.getElementById('emailEnableBtn').onclick = async () => {
    const btn = document.getElementById('emailEnableBtn');
    btn.disabled = true;
    btn.textContent = t('mfa.confirming');
    loginError('');
    try {
      await cognitoCall('SetUserMFAPreference', {
        AccessToken: state.accessToken,
        EmailMfaSettings: { Enabled: true, PreferredMfa: true },
      });
      setStatus(t('mfa.emailOn'), 'ok');
      if (forced) await showRole();
      else await showSecurityMfa();
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = t('mfa.confirmEnable');
    }
  };
}

async function startPasskeyEnroll({ forced }) {
  const panel = document.getElementById('mfaEnrollPanel');
  loginError('');
  if (!state.accessToken) {
    loginError(t('mfa.needResignSetup'));
    return;
  }
  if (!passkeySupported()) {
    loginError(t('mfa.passkeyNeedSecure'));
    return;
  }
  panel.hidden = false;
  panel.innerHTML = `
    <h3>${esc(t('mfa.passkeyTitle'))}</h3>
    <p>${esc(t('mfa.passkeyBlurb'))}</p>
    <button type="button" class="btn-primary" id="passkeyRegisterBtn">${esc(t('mfa.passkeyRegister'))}</button>
  `;
  document.getElementById('passkeyRegisterBtn').onclick = async () => {
    const btn = document.getElementById('passkeyRegisterBtn');
    btn.disabled = true;
    btn.textContent = t('mfa.passkeyWorking');
    loginError('');
    try {
      const start = await cognitoCall('StartWebAuthnRegistration', { AccessToken: state.accessToken });
      let options = start.CredentialCreationOptions || start.credentialCreationOptions;
      if (typeof options === 'string') options = JSON.parse(options);
      const publicKey = publicKeyCreateOptionsFromCognito(options.publicKey || options);
      const cred = await navigator.credentials.create({ publicKey });
      await cognitoCall('CompleteWebAuthnRegistration', {
        AccessToken: state.accessToken,
        Credential: credentialToJson(cred),
      });
      try {
        await cognitoCall('SetUserMFAPreference', {
          AccessToken: state.accessToken,
          WebAuthnMfaSettings: { Enabled: true },
        });
      } catch {
        /* optional on older pool configs */
      }
      setStatus(t('mfa.passkeyOn'), 'ok');
      if (forced) await showRole();
      else await showSecurityMfa();
    } catch (e) {
      loginError(e.message || t('common.error'));
      btn.disabled = false;
      btn.textContent = t('mfa.passkeyRegister');
    }
  };
}

async function startTotpEnroll({ forced }) {
  const panel = document.getElementById('mfaEnrollPanel');
  loginError('');
  if (!state.accessToken) {
    loginError(t('mfa.needResignSetup'));
    return;
  }
  try {
    const assoc = await cognitoCall('AssociateSoftwareToken', { AccessToken: state.accessToken });
    const secret = assoc.SecretCode;
    if (!secret) throw new Error('Unable to start authenticator setup.');
    const uri = otpauthUri(secret, state.email);
    panel.hidden = false;
    panel.innerHTML = `
      <h3>${esc(t('mfa.totpTitle'))}</h3>
      <p>${esc(t('mfa.totpBlurb'))}</p>
      ${qrImgHtml(uri)}
      <p class="mfa-secret"><code id="mfaSecret">${esc(secret)}</code>
        <button type="button" class="linkish" id="copyMfaSecret">${esc(t('mfa.copyKey'))}</button></p>
      <p class="muted"><a href="${esc(uri)}">${esc(t('mfa.openApp'))}</a> (mobile)</p>
      <label>${esc(t('mfa.confirmCode'))} <input id="totpVerifyCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" /></label>
      <button type="button" class="btn-primary" id="totpVerifyBtn">${esc(t('mfa.confirmEnable'))}</button>
    `;
    document.getElementById('copyMfaSecret').onclick = async () => {
      try {
        await navigator.clipboard.writeText(secret);
        setStatus('Authenticator key copied.', 'ok');
      } catch {
        setStatus('Copy the key manually.', 'err');
      }
    };
    document.getElementById('totpVerifyBtn').onclick = async () => {
      const code = document.getElementById('totpVerifyCode').value.trim().replace(/\s+/g, '');
      loginError('');
      if (!/^\d{6}$/.test(code)) {
        loginError(t('mfa.needSix'));
        return;
      }
      const btn = document.getElementById('totpVerifyBtn');
      btn.disabled = true;
      btn.textContent = t('mfa.confirming');
      try {
        await cognitoCall('VerifySoftwareToken', {
          AccessToken: state.accessToken,
          UserCode: code,
          FriendlyDeviceName: 'Authenticator app',
        });
        await cognitoCall('SetUserMFAPreference', {
          AccessToken: state.accessToken,
          SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
        });
        setStatus(t('mfa.totpOn'), 'ok');
        if (forced) await showRole();
        else await showSecurityMfa();
      } catch (e) {
        loginError(e.message);
        btn.disabled = false;
        btn.textContent = t('mfa.confirmEnable');
      }
    };
  } catch (e) {
    loginError(e.message);
  }
}

async function startSmsEnroll({ forced }) {
  const panel = document.getElementById('mfaEnrollPanel');
  loginError('');
  if (!state.accessToken) {
    loginError(t('mfa.needResignSetup'));
    return;
  }
  panel.hidden = false;
  panel.innerHTML = `
    <h3>${esc(t('mfa.smsTitle'))}</h3>
    <p class="muted">${esc(t('mfa.smsBlurb'))}</p>
    <label>${esc(t('mfa.phone'))} <input id="smsPhone" type="tel" autocomplete="tel" placeholder="+1…" /></label>
    <button type="button" class="btn-primary" id="smsSendCode">${esc(t('mfa.sendSms'))}</button>
    <div id="smsVerifyWrap" hidden>
      <label>${esc(t('mfa.smsCode'))} <input id="smsVerifyCode" type="text" inputmode="numeric" autocomplete="one-time-code" /></label>
      <button type="button" class="btn-primary" id="smsConfirmBtn">${esc(t('mfa.smsConfirm'))}</button>
    </div>
  `;
  document.getElementById('smsSendCode').onclick = async () => {
    const phone = document.getElementById('smsPhone').value.trim();
    loginError('');
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      loginError(t('mfa.needPhone'));
      return;
    }
    try {
      await cognitoCall('UpdateUserAttributes', {
        AccessToken: state.accessToken,
        UserAttributes: [{ Name: 'phone_number', Value: phone }],
      });
      await cognitoCall('GetUserAttributeVerificationCode', {
        AccessToken: state.accessToken,
        AttributeName: 'phone_number',
      });
      document.getElementById('smsVerifyWrap').hidden = false;
      setStatus(t('mfa.smsSent'), 'ok');
    } catch (e) {
      loginError(e.message);
    }
  };
  document.getElementById('smsConfirmBtn').onclick = async () => {
    const code = document.getElementById('smsVerifyCode').value.trim();
    loginError('');
    if (!code) {
      loginError(t('mfa.needSmsCode'));
      return;
    }
    try {
      await cognitoCall('VerifyUserAttribute', {
        AccessToken: state.accessToken,
        AttributeName: 'phone_number',
        Code: code,
      });
      await cognitoCall('SetUserMFAPreference', {
        AccessToken: state.accessToken,
        SMSMfaSettings: { Enabled: true, PreferredMfa: true },
      });
      setStatus(t('mfa.smsOn'), 'ok');
      if (forced) await showRole();
      else await showSecurityMfa();
    } catch (e) {
      loginError(e.message);
    }
  };
}

function mfaOrgPolicyHtml(settings) {
  const req = coerceRequireMfa(settings?.requireMfa, false);
  return `
    <div class="mfa-advanced-panel" id="mfaOrgPolicy">
      <p class="muted">${esc(t('mfa.policyBlurb'))}</p>
      <div class="row">
        <label>${esc(t('mfa.requireLabel'))}
          <select id="requireMfa">
            <option value="true" ${req ? 'selected' : ''}>${esc(t('mfa.on'))}</option>
            <option value="false" ${!req ? 'selected' : ''}>${esc(t('mfa.off'))}</option>
          </select>
        </label>
      </div>
      <p class="muted">${esc(t('mfa.smsOffNote'))}</p>
      <button type="button" class="btn-primary" id="saveMfaSettings">${esc(t('mfa.savePolicy'))}</button>
      <p class="muted" id="mfaSettingsStatus"></p>
    </div>
  `;
}

function bindMfaOrgPolicySave(onSaved) {
  document.getElementById('saveMfaSettings')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('mfaSettingsStatus');
    try {
      const requested = document.getElementById('requireMfa').value === 'true';
      const wantOff = !requested;
      const out = await api(
        'POST',
        '/admin/settings',
        {
          requireMfa: requested,
          allowSmsMfa: false,
        },
        { timeoutMs: 20000 },
      );
      // Re-GET for confirmation — but Scan hydrate can lag; trust POST when it matches
      // the value we just sent (that path uses strongly consistent persist + echo).
      let verified = out.settings || {};
      try {
        const fresh = await api('GET', '/admin/settings');
        if (fresh?.settings) verified = fresh.settings;
      } catch {
        /* keep POST body */
      }
      const fromGet = coerceRequireMfa(verified.requireMfa, false);
      const postedMatches =
        typeof out.settings?.requireMfa === 'boolean' && out.settings.requireMfa === requested;
      const req = postedMatches ? out.settings.requireMfa : fromGet;
      const sel = document.getElementById('requireMfa');
      if (sel) sel.value = req ? 'true' : 'false';
      state.meSettings = { ...(state.meSettings || {}), requireMfa: req, allowSmsMfa: false };
      cacheRequireMfa(req);
      // Keep the Security page org-status line in sync without waiting for a full re-render.
      const orgStatus = document.getElementById('mfaOrgRequires');
      if (orgStatus) orgStatus.textContent = req ? t('mfa.yes') : t('mfa.no');
      const pending = out.mfaClear?.pending;
      const clearErr = out.mfaClear?.error;
      let msg = t('mfa.policySaved');
      if (!req && pending) {
        msg = `${t('mfa.policySaved')} (Cognito MFA clear still running — policy is OFF)`;
      } else if (!req && clearErr) {
        msg = `${t('mfa.policySaved')} (Cognito MFA clear had an error — policy is still OFF)`;
      } else if (wantOff && req) {
        msg = 'Save reported Require MFA still ON — try again.';
        if (statusEl) statusEl.textContent = msg;
        setStatus(msg, 'err');
        return;
      }
      if (statusEl) statusEl.textContent = msg;
      setStatus(msg, 'ok');
      if (typeof onSaved === 'function') onSaved({ requireMfa: req, allowSmsMfa: false });
    } catch (err) {
      // On failure, re-read so the select shows Dynamo — not a stale local Off/On.
      try {
        const fresh = await api('GET', '/admin/settings');
        const req = coerceRequireMfa(fresh.settings?.requireMfa, false);
        const sel = document.getElementById('requireMfa');
        if (sel) sel.value = req ? 'true' : 'false';
        cacheRequireMfa(req);
        const orgStatus = document.getElementById('mfaOrgRequires');
        if (orgStatus) orgStatus.textContent = req ? t('mfa.yes') : t('mfa.no');
      } catch {
        /* ignore */
      }
      if (statusEl) statusEl.textContent = err.message || t('common.error');
      setStatus(err.message || t('common.error'), 'err');
    }
  });
}

async function showAdvancedMfaPolicy() {
  if (state.role !== 'admin') {
    setStatus('Admin only.', 'err');
    return;
  }
  hideAppChrome();
  document.body.classList.remove('is-auth');
  document.body.classList.add('is-app');
  const whoBar = document.getElementById('whoBar');
  whoBar.hidden = false;
  const settings = await fetchAppMfaSettings();
  view(`
    <div class="card login-card mfa-setup-card">
      <h2>${esc(t('mfa.advancedHint'))}</h2>
      ${mfaOrgPolicyHtml(settings)}
      <p><button type="button" class="btn" id="mfaAdvBack">${esc(t('mfa.back'))}</button></p>
    </div>
  `);
  bindMfaOrgPolicySave();
  document.getElementById('mfaAdvBack').onclick = () => showRole();
}

async function showSecurityMfa() {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    signOut(t('session.ended'));
    return;
  }
  if (!state.accessToken) {
    view(`
      <div class="card login-card">
        <h2>${esc(t('mfa.securityTitle'))}</h2>
        <div class="err-box">${esc(t('mfa.needResign'))}</div>
        <button type="button" class="btn" id="mfaBack">${esc(t('mfa.back'))}</button>
      </div>
    `);
    document.getElementById('mfaBack').onclick = () => showRole();
    return;
  }
  const settings = await fetchAppMfaSettings();
  let mfa = { hasSoftware: false, hasSms: false, hasEmail: false, hasPasskey: false, hasAny: false, phone: '' };
  try {
    mfa = await getCognitoUserMfa(state.accessToken);
  } catch (e) {
    /* show below */
  }
  const canDisable = settings.requireMfa !== true;
  const isAdmin = state.role === 'admin';
  const uname = state.email || cognitoUsernameFromToken(state.idToken);
  const trusted = Boolean(loadDeviceRecord(uname));
  view(`
    <div class="card login-card mfa-setup-card">
      ${langSwitcherHtml(false)}
      <h2>${esc(t('mfa.securityTitle'))}</h2>
      <p>${esc(t('mfa.securityBlurb'))}</p>
      <div id="loginErr" class="err-box" hidden></div>
      <ul class="mfa-status-list">
        <li>${esc(t('mfa.statusTotp'))}: <strong>${mfa.hasSoftware ? esc(t('mfa.on')) : esc(t('mfa.off'))}</strong></li>
        <li>${esc(t('mfa.statusEmail'))}: <strong>${mfa.hasEmail ? esc(t('mfa.on')) : esc(t('mfa.off'))}</strong></li>
        <li>${esc(t('mfa.statusPasskey'))}: <strong>${mfa.hasPasskey ? esc(t('mfa.on')) : esc(t('mfa.off'))}</strong></li>
        <li>${esc(t('mfa.statusOrg'))}: <strong id="mfaOrgRequires">${settings.requireMfa === true ? esc(t('mfa.yes')) : esc(t('mfa.no'))}</strong></li>
      </ul>
      <button type="button" class="btn-primary" id="mfaAddMethods">${esc(t('mfa.addMethods'))}</button>
      ${!canDisable ? `<p class="muted">${esc(t('mfa.requiredNote'))}</p>` : ''}
      <p class="muted">${esc(t('mfa.trustedLabel'))}: ${trusted ? esc(t('mfa.trustedYes')) : esc(t('mfa.trustedNo'))}
        ${trusted ? ` <button type="button" class="linkish" id="forgetDevice">${esc(t('mfa.forgetDevice'))}</button>` : ''}
      </p>
      <details class="mfa-advanced-details">
        <summary class="mfa-advanced-summary">${esc(t('mfa.advanced'))}</summary>
        ${
          canDisable && mfa.hasAny
            ? `<p><button type="button" class="btn" id="mfaDisable">${esc(t('mfa.disableMine'))}</button></p>`
            : ''
        }
        ${isAdmin ? `<h3 class="mfa-adv-h">${esc(t('mfa.advancedHint'))}</h3>${mfaOrgPolicyHtml(settings)}` : ''}
      </details>
      <p><button type="button" class="btn" id="mfaBack">${esc(t('mfa.back'))}</button></p>
    </div>
  `);
  bindLangSwitcher(document.getElementById('view'), () => showSecurityMfa());
  document.getElementById('mfaBack').onclick = () => showRole();
  document.getElementById('mfaAddMethods').onclick = () => showMfaSetup({ forced: false });
  document.getElementById('forgetDevice')?.addEventListener('click', () => {
    clearDeviceRecord(uname);
    setStatus(t('mfa.forgotDeviceOk'), 'ok');
    showSecurityMfa();
  });
  document.getElementById('mfaDisable')?.addEventListener('click', async () => {
    loginError('');
    try {
      // Do not send WebAuthnMfaSettings — Cognito SetUserMFAPreference rejects it and
      // would leave EMAIL_OTP / TOTP still preferred (login keeps challenging).
      await cognitoCall('SetUserMFAPreference', {
        AccessToken: state.accessToken,
        SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false },
        SMSMfaSettings: { Enabled: false, PreferredMfa: false },
        EmailMfaSettings: { Enabled: false, PreferredMfa: false },
      });
      try {
        const creds = await cognitoCall('ListWebAuthnCredentials', { AccessToken: state.accessToken });
        for (const c of creds.Credentials || []) {
          const id = c.CredentialId || c.credentialId;
          if (!id) continue;
          await cognitoCall('DeleteWebAuthnCredential', {
            AccessToken: state.accessToken,
            CredentialId: id,
          });
        }
      } catch {
        /* passkeys optional */
      }
      setStatus(t('mfa.disabledOk'), 'ok');
      await showSecurityMfa();
    } catch (e) {
      loginError(e.message);
    }
  });
  if (isAdmin) {
    bindMfaOrgPolicySave(async (saved) => {
      // Re-render from the verified server value (already cached) so Advanced stays open on Off.
      state.meSettings = { ...(state.meSettings || {}), ...saved };
      cacheRequireMfa(saved.requireMfa === true);
      await showSecurityMfa();
      const details = document.querySelector('.mfa-advanced-details');
      if (details) details.open = true;
    });
  }
}

function showForgotPassword(prefillEmail) {
  hideAppChrome();
  setStatus('', '');
  view(`
    <div class="card login-card">
      ${langSwitcherHtml(false)}
      <h2>${esc(t('forgot.title'))}</h2>
      <p>${esc(t('forgot.blurb'))}</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>${esc(t('login.email'))} <input id="forgotEmail" type="email" autocomplete="username" placeholder="you@example.com" value="${esc(prefillEmail || '')}" /></label>
      <button class="btn-primary big" id="forgotSendBtn">${esc(t('forgot.send'))}</button>
      <p><button type="button" class="btn" id="forgotBackBtn">${esc(t('mfa.backLogin'))}</button></p>
    </div>
  `);
  bindLangSwitcher(document.getElementById('view'), () => showForgotPassword(prefillEmail));
  document.getElementById('forgotBackBtn').onclick = () => showLogin('');
  document.getElementById('forgotSendBtn').onclick = async () => {
    const btn = document.getElementById('forgotSendBtn');
    const email = document.getElementById('forgotEmail').value.trim();
    loginError('');
    if (!email) {
      loginError(t('forgot.needEmail'));
      return;
    }
    btn.disabled = true;
    btn.textContent = t('forgot.sending');
    try {
      await cognitoCall('ForgotPassword', {
        ClientId: CLIENT_ID,
        Username: email,
      });
      showConfirmForgotPassword(email);
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = t('forgot.send');
    }
  };
  document.getElementById('forgotEmail').focus();
}

function showConfirmForgotPassword(email) {
  hideAppChrome();
  setStatus('', '');
  view(`
    <div class="card login-card">
      <h2>Enter confirmation code</h2>
      <p>Check <strong>${esc(email)}</strong> for a confirmation code, then choose a new password (at least 8 characters with an uppercase letter, a lowercase letter, and a number).</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>Confirmation code <input id="forgotCode" type="text" autocomplete="one-time-code" inputmode="numeric" /></label>
      <label>New password <input id="forgotNew" type="password" autocomplete="new-password" /></label>
      <label>Confirm new password <input id="forgotNew2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="forgotConfirmBtn">Save new password</button>
      <p><button type="button" class="linkish" id="forgotResendBtn">Resend code</button></p>
      <p><button type="button" class="btn" id="forgotBackBtn">Back to sign in</button></p>
    </div>
  `);
  document.getElementById('forgotBackBtn').onclick = () => showLogin('');
  document.getElementById('forgotResendBtn').onclick = () => showForgotPassword(email);
  const submit = async () => {
    const btn = document.getElementById('forgotConfirmBtn');
    const code = document.getElementById('forgotCode').value.trim();
    const p1 = document.getElementById('forgotNew').value;
    const p2 = document.getElementById('forgotNew2').value;
    loginError('');
    if (!code || !p1 || !p2) {
      loginError('Enter the confirmation code and both password fields.');
      return;
    }
    if (p1 !== p2) {
      loginError('The passwords do not match.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await cognitoCall('ConfirmForgotPassword', {
        ClientId: CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
        Password: p1,
      });
      setStatus('Password updated. Sign in with your new password.', 'ok');
      showLogin('');
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = 'Save new password';
    }
  };
  document.getElementById('forgotConfirmBtn').onclick = submit;
  document.getElementById('forgotNew2').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  document.getElementById('forgotCode').focus();
}

function showNewPassword(email, session) {
  hideAppChrome();
  view(`
    <div class="card login-card">
      <h2>Choose a new password</h2>
      <p>First sign-in: choose your own password. Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.</p>
      <div id="loginErr" class="err-box" hidden></div>
      <label>New password <input id="newPassword" type="password" autocomplete="new-password" /></label>
      <label>Confirm password <input id="newPassword2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="newPassBtn">Save password and sign in</button>
    </div>
  `);
  const submit = async () => {
    const btn = document.getElementById('newPassBtn');
    const p1 = document.getElementById('newPassword').value;
    const p2 = document.getElementById('newPassword2').value;
    loginError('');
    if (!p1) {
      loginError('Enter a new password.');
      return;
    }
    if (p1 !== p2) {
      loginError('The passwords do not match.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const out = await cognitoCall('RespondToAuthChallenge', {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: CLIENT_ID,
        Session: session,
        ChallengeResponses: { USERNAME: email, NEW_PASSWORD: p1 },
      });
      await handleAuthResponse(out, { email });
    } catch (e) {
      loginError(e.message);
      btn.disabled = false;
      btn.textContent = 'Save password and sign in';
    }
  };
  document.getElementById('newPassBtn').onclick = submit;
  document.getElementById('newPassword2').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  document.getElementById('newPassword').focus();
}

function changePasswordError(msg) {
  const box = document.getElementById('changePwErr');
  if (!box) return;
  box.textContent = msg || '';
  box.hidden = !msg;
}

function showChangePassword() {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    signOut('Your session has ended. Please sign in again.');
    return;
  }
  if (!state.accessToken) {
    view(`
      <div class="card login-card">
        <h2>Change password</h2>
        <div class="err-box">Sign out and sign in again to change your password.</div>
        <button type="button" class="btn" id="changePwCancel">Back</button>
      </div>
    `);
    document.getElementById('changePwCancel').onclick = () => showRole();
    return;
  }
  view(`
    <div class="card login-card">
      <h2>Change password</h2>
      <p>Use at least 8 characters with an uppercase letter, a lowercase letter, and a number.</p>
      <div id="changePwErr" class="err-box" hidden></div>
      <label>Current password <input id="changePwCurrent" type="password" autocomplete="current-password" /></label>
      <label>New password <input id="changePwNew" type="password" autocomplete="new-password" /></label>
      <label>Confirm new password <input id="changePwNew2" type="password" autocomplete="new-password" /></label>
      <button class="btn-primary big" id="changePwSave">Save</button>
      <p><button type="button" class="btn" id="changePwCancel">Cancel</button></p>
    </div>
  `);
  const submit = async () => {
    const btn = document.getElementById('changePwSave');
    const current = document.getElementById('changePwCurrent').value;
    const p1 = document.getElementById('changePwNew').value;
    const p2 = document.getElementById('changePwNew2').value;
    changePasswordError('');
    if (!current || !p1 || !p2) {
      changePasswordError('Enter all three password fields.');
      return;
    }
    if (p1 !== p2) {
      changePasswordError('The new passwords do not match.');
      return;
    }
    if (!state.accessToken) {
      changePasswordError('Sign out and sign in again to change your password.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await cognitoCall(
        'ChangePassword',
        {
          PreviousPassword: current,
          ProposedPassword: p1,
          AccessToken: state.accessToken,
        },
        changePasswordErrorMessage,
      );
      setStatus('Password changed. Use the new password the next time you sign in.', 'ok');
      showRole();
    } catch (e) {
      changePasswordError(e.message);
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  };
  document.getElementById('changePwSave').onclick = submit;
  document.getElementById('changePwCancel').onclick = () => showRole();
  document.getElementById('changePwNew2').onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };
  document.getElementById('changePwCurrent').focus();
}

// ---- Navigation ----

document.getElementById('role').onchange = (e) => {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    hideAppChrome();
    signOut('');
    return;
  }
  state.role = e.target.value;
  showRole();
};

document.getElementById('changePassword').onclick = () => {
  showChangePassword();
};

document.getElementById('securityMfa').onclick = () => {
  showSecurityMfa();
};

document.getElementById('signout').onclick = () => {
  signOut('');
};

document.getElementById('therapistNav').onclick = (e) => {
  e.preventDefault();
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    hideAppChrome();
    signOut('');
    return;
  }
  therapistHome();
};

document.getElementById('adminNav').onclick = (e) => {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    hideAppChrome();
    signOut('');
    return;
  }
  const btn = e.target.closest('[data-admin]');
  if (!btn) return;
  clearTransientErrors();
  document.querySelectorAll('#adminNav .nav').forEach((b) => b.classList.toggle('on', b === btn));
  const screen = btn.getAttribute('data-admin');
  if (screen === 'dash') adminDash();
  if (screen === 'children') adminChildren();
  if (screen === 'providers') adminProviders();
  if (screen === 'mandates') adminMandates();
  if (screen === 'schools') adminSchools();
  if (screen === 'admins') adminAdmins();
  if (screen === 'reports') {
    state.reportView = '';
    adminReports();
  }
};

// ---- Luna support chatbot ----
const lunaState = {
  open: localStorage.getItem('tmsLunaOpen') === '1',
  busy: false,
  messages: [],
  pendingSummary: '',
  readyForHandoff: false,
};

function setLunaVisible(on) {
  const root = document.getElementById('lunaRoot');
  if (!root) return;
  root.hidden = !on;
  if (!on) {
    const panel = document.getElementById('lunaPanel');
    const fab = document.getElementById('lunaFab');
    if (panel) panel.hidden = true;
    if (fab) fab.setAttribute('aria-expanded', 'false');
    return;
  }
  setLunaOpen(lunaState.open);
}

function setLunaOpen(open) {
  lunaState.open = Boolean(open);
  localStorage.setItem('tmsLunaOpen', lunaState.open ? '1' : '0');
  const panel = document.getElementById('lunaPanel');
  const fab = document.getElementById('lunaFab');
  if (panel) panel.hidden = !lunaState.open;
  if (fab) fab.setAttribute('aria-expanded', lunaState.open ? 'true' : 'false');
  if (lunaState.open) {
    ensureLunaWelcome();
    const input = document.getElementById('lunaInput');
    if (input) input.focus();
  }
}

function ensureLunaWelcome() {
  if (lunaState.messages.length) return;
  lunaState.messages.push({
    role: 'assistant',
    content: 'Hi, I’m Luna. Tell me what’s going wrong and I’ll help gather the details for support.',
  });
  renderLunaMessages();
}

function renderLunaMessages(extraTyping) {
  const box = document.getElementById('lunaMessages');
  if (!box) return;
  const rows = lunaState.messages
    .map(
      (m) =>
        `<div class="luna-bubble ${m.role === 'user' ? 'luna-user' : 'luna-bot'}">${esc(m.content)}</div>`,
    )
    .join('');
  const typing = extraTyping
    ? '<div class="luna-bubble luna-bot luna-typing">Luna is typing…</div>'
    : '';
  box.innerHTML = rows + typing;
  box.scrollTop = box.scrollHeight;
  syncLunaHandoffBar();
}

function lunaContactDefaults() {
  const payload = state.idToken ? decodeJwtPayload(state.idToken) || {} : {};
  const given = String(payload.given_name || '').trim();
  const family = String(payload.family_name || '').trim();
  const full = [given, family].filter(Boolean).join(' ');
  const name = String(payload.name || full || payload['cognito:username'] || '').trim();
  const email = String(state.email || payload.email || '').trim();
  return { name, email };
}

function readLunaContact() {
  const nameEl = document.getElementById('lunaContactName');
  const emailEl = document.getElementById('lunaContactEmail');
  return {
    contactName: String(nameEl?.value || '').trim(),
    contactEmail: String(emailEl?.value || '').trim(),
  };
}

function lunaEmailLooksOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function syncLunaHandoffBar() {
  const bar = document.getElementById('lunaHandoffBar');
  const btn = document.getElementById('lunaSendHandoff');
  if (!bar) return;
  const show = Boolean(lunaState.readyForHandoff);
  bar.hidden = !show;
  if (show) {
    const nameEl = document.getElementById('lunaContactName');
    const emailEl = document.getElementById('lunaContactEmail');
    const defaults = lunaContactDefaults();
    if (nameEl && !String(nameEl.value || '').trim() && defaults.name) nameEl.value = defaults.name;
    if (emailEl && !String(emailEl.value || '').trim() && defaults.email) emailEl.value = defaults.email;
  }
  const { contactName, contactEmail } = readLunaContact();
  if (btn) btn.disabled = lunaState.busy || !show || !contactName || !lunaEmailLooksOk(contactEmail);
}

function setLunaStatus(msg) {
  const el = document.getElementById('lunaStatus');
  if (!el) return;
  const text = String(msg || '').trim();
  if (!text) {
    el.textContent = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = 'luna-status status-banner';
  el.innerHTML = `<span>${esc(text)}</span><button type="button" class="status-banner-dismiss" aria-label="Dismiss">×</button>`;
  el.querySelector('.status-banner-dismiss')?.addEventListener('click', () => setLunaStatus(''));
}

async function lunaChat(userText) {
  if (lunaState.busy) return;
  const text = String(userText || '').trim();
  if (!text) return;
  setLunaStatus('');
  lunaState.readyForHandoff = false;
  lunaState.pendingSummary = '';
  lunaState.messages.push({ role: 'user', content: text });
  renderLunaMessages(true);
  lunaState.busy = true;
  const sendBtn = document.getElementById('lunaSend');
  if (sendBtn) sendBtn.disabled = true;
  syncLunaHandoffBar();
  try {
    const out = await api(
      'POST',
      '/support/luna/chat',
      {
        messages: lunaState.messages.map((m) => ({ role: m.role, content: m.content })),
        pageUrl: typeof location !== 'undefined' ? location.href : '',
      },
      lunaApiOpts(),
    );
    const reply = String(out.reply || '').trim() || 'Thanks — could you share a bit more detail?';
    lunaState.messages.push({ role: 'assistant', content: reply });
    if (String(out.action || '').toLowerCase() === 'handoff') {
      lunaState.readyForHandoff = true;
      lunaState.pendingSummary = String(out.summary || reply).trim();
    }
    renderLunaMessages(false);
  } catch (e) {
    setLunaStatus(e?.message || 'Luna is unavailable.');
    renderLunaMessages(false);
  } finally {
    lunaState.busy = false;
    if (sendBtn) sendBtn.disabled = false;
    syncLunaHandoffBar();
  }
}

async function lunaHandoff() {
  if (lunaState.busy || !lunaState.readyForHandoff) return;
  const { contactName, contactEmail } = readLunaContact();
  if (!contactName) {
    setLunaStatus('Enter your name before sending to our team.');
    document.getElementById('lunaContactName')?.focus();
    syncLunaHandoffBar();
    return;
  }
  if (!lunaEmailLooksOk(contactEmail)) {
    setLunaStatus('Enter a valid email before sending to our team.');
    document.getElementById('lunaContactEmail')?.focus();
    syncLunaHandoffBar();
    return;
  }
  lunaState.busy = true;
  setLunaStatus('');
  const btn = document.getElementById('lunaSendHandoff');
  if (btn) btn.disabled = true;
  renderLunaMessages(true);
  try {
    const out = await api(
      'POST',
      '/support/luna/handoff',
      {
        messages: lunaState.messages.map((m) => ({ role: m.role, content: m.content })),
        summary: lunaState.pendingSummary,
        pageUrl: typeof location !== 'undefined' ? location.href : '',
        contactName,
        contactEmail,
      },
      lunaApiOpts(),
    );
    const herEmail = String(out.contactEmail || contactEmail || '').trim();
    const reply =
      String(out.reply || '').trim() ||
      (herEmail
        ? `Thanks — I’ve sent this to our team. We’ll follow up with you at ${herEmail}.`
        : 'Thanks — I’ve sent this to our team. We’ll follow up at the email you provided.');
    lunaState.messages.push({ role: 'assistant', content: reply });
    lunaState.readyForHandoff = false;
    lunaState.pendingSummary = '';
    renderLunaMessages(false);
  } catch (e) {
    setLunaStatus(e?.message || 'Unable to send the support handoff.');
    renderLunaMessages(false);
  } finally {
    lunaState.busy = false;
    if (btn) btn.disabled = false;
    syncLunaHandoffBar();
  }
}

function initLuna() {
  const fab = document.getElementById('lunaFab');
  const close = document.getElementById('lunaClose');
  const form = document.getElementById('lunaForm');
  const handoff = document.getElementById('lunaSendHandoff');
  const nameEl = document.getElementById('lunaContactName');
  const emailEl = document.getElementById('lunaContactEmail');
  if (!fab || fab.dataset.bound === '1') return;
  fab.dataset.bound = '1';
  fab.onclick = () => setLunaOpen(!lunaState.open);
  if (close) close.onclick = () => setLunaOpen(false);
  if (handoff) handoff.onclick = () => lunaHandoff();
  const onContactEdit = () => {
    setLunaStatus('');
    syncLunaHandoffBar();
  };
  if (nameEl) nameEl.addEventListener('input', onContactEdit);
  if (emailEl) emailEl.addEventListener('input', onContactEdit);
  if (form) {
    const sendLunaMessage = () => {
      const input = document.getElementById('lunaInput');
      const text = input?.value || '';
      if (input) input.value = '';
      lunaChat(text);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendLunaMessage();
    };
    const input = document.getElementById('lunaInput');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        // Shift+Enter keeps newline in the textarea; bare Enter sends.
        if (e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        sendLunaMessage();
      });
    }
  }
  setLunaOpen(lunaState.open);
}

function hideAppChrome() {
  document.body.classList.add('is-auth');
  document.body.classList.remove('is-app');
  // Language control stays visible in the header (outside whoBar).
  applyStaticI18n();
  document.getElementById('whoBar').hidden = true;
  document.getElementById('rolePick').hidden = true;
  document.getElementById('adminNav').hidden = true;
  document.getElementById('therapistNav').hidden = true;
  document.getElementById('changePassword').hidden = true;
  document.getElementById('securityMfa').hidden = true;
  document.getElementById('signout').hidden = true;
  document.getElementById('whoami').textContent = '';
  initLuna();
  setLunaVisible(true);
}

async function showRole() {
  if (COGNITO_MODE && !tokenStillGood(state.idToken)) {
    signOut(t('session.ended'));
    return;
  }
  if (COGNITO_MODE && state.idToken) {
    try {
      const me = await api('GET', '/me');
      if (me?.user?.role === 'admin' || me?.user?.role === 'therapist') {
        state.role = me.user.role;
      }
    } catch {
      /* keep token-derived role */
    }
  }
  const admin = state.role === 'admin';
  document.body.classList.remove('is-auth');
  document.body.classList.add('is-app');
  applyStaticI18n();
  // Always show whoBar after login for both therapist and admin
  const whoBar = document.getElementById('whoBar');
  whoBar.hidden = false;
  whoBar.removeAttribute('hidden');
  // Therapists get one page — never show therapist tab nav
  document.getElementById('therapistNav').hidden = true;
  document.getElementById('adminNav').hidden = !admin;
  if (admin) void refreshSchoolsSetupBadge();
  else updateSchoolsSetupBadge(0);
  document.getElementById('rolePick').hidden = COGNITO_MODE;
  const label = admin ? t('nav.admin') : t('nav.therapist');
  document.getElementById('whoami').textContent = COGNITO_MODE && state.email ? `${state.email} — ${label}` : label;
  const changePw = document.getElementById('changePassword');
  const securityMfa = document.getElementById('securityMfa');
  const signOutBtn = document.getElementById('signout');
  if (COGNITO_MODE) {
    changePw.hidden = false;
    changePw.removeAttribute('hidden');
    securityMfa.hidden = false;
    securityMfa.removeAttribute('hidden');
    signOutBtn.hidden = false;
    signOutBtn.removeAttribute('hidden');
  } else {
    changePw.hidden = true;
    securityMfa.hidden = true;
    signOutBtn.hidden = true;
  }
  initLuna();
  setLunaVisible(true);
  // Replace Sign in (or any prior) content before API calls so chrome never
  // shows "signed in" while the login form is still stuck on Signing in…
  openingAccountView();
  try {
    if (COGNITO_MODE && state.accessToken) {
      const blocked = await enforceMfaIfRequired();
      if (blocked) return;
    }
    if (admin) await adminDash();
    else await therapistHome();
  } catch (e) {
    homeLoadErrorView(e);
  }
}

if (COGNITO_MODE) {
  hideAppChrome();
  applyStaticI18n();
  bindFooterAdvancedSecurity();
  if (tokenStillGood(state.idToken)) {
    applyToken(state.idToken);
    showRole();
  } else {
    showLogin('');
  }
} else {
  applyStaticI18n();
  bindFooterAdvancedSecurity();
  showRole();
}

function bindFooterAdvancedSecurity() {
  const footer = document.getElementById('siteFooter');
  if (!footer || footer.dataset.mfaHoldBound) return;
  footer.dataset.mfaHoldBound = '1';
  let holdTimer = null;
  const start = (e) => {
    if (state.role !== 'admin' || !state.accessToken) return;
    if (e.type === 'mousedown' && e.button !== 0) return;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      showAdvancedMfaPolicy();
    }, 1600);
  };
  const clear = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  };
  footer.addEventListener('mousedown', start);
  footer.addEventListener('touchstart', start, { passive: true });
  footer.addEventListener('mouseup', clear);
  footer.addEventListener('mouseleave', clear);
  footer.addEventListener('touchend', clear);
  footer.addEventListener('touchcancel', clear);
  footer.title = t('mfa.footerHold');
}
