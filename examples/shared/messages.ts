export interface ExampleCopy {
  app: string; account: string; signIn: string; signUp: string; signedIn: string; welcome: string;
  intro: string; openAccount: string; email: string; phone: string; none: string; verified: string;
  unverified: string; methods: string; mfa: string; mfaYes: string; mfaNo: string; ends: string;
  confirm: string; confirmCopy: string; stepUp: string; agents: string; revokeCopy: string; failed: string;
}

const en: ExampleCopy = {
  app: "Example app", account: "Your account", signIn: "Sign in", signUp: "Create account",
  signedIn: "You are signed in", welcome: "Sign in with Didit",
  intro: "Create an account or sign in on your Didit sign-in page. Forgot your password? The sign-in page sends a reset link.",
  openAccount: "Open your account", email: "Email", phone: "Phone", none: "None", verified: "verified",
  unverified: "not verified", methods: "Signed in with", mfa: "Two-step verification",
  mfaYes: "Verified in this session", mfaNo: "Not used in this session", ends: "Session ends",
  confirm: "Confirm it is you", confirmCopy: "Sign in again before a sensitive change. You will return here with a new session.",
  stepUp: "Sign in again to continue", agents: "Connected agents", revokeCopy: "Revoking an agent ends its access everywhere at once.",
  failed: "Something went wrong. Try again."
};
const es: ExampleCopy = {
  app: "Aplicación de ejemplo", account: "Tu cuenta", signIn: "Iniciar sesión", signUp: "Crear cuenta",
  signedIn: "Has iniciado sesión", welcome: "Inicia sesión con Didit",
  intro: "Crea una cuenta o inicia sesión en tu página de Didit. ¿Olvidaste tu contraseña? La página de acceso envía un enlace para restablecerla.",
  openAccount: "Abrir tu cuenta", email: "Correo electrónico", phone: "Teléfono", none: "Ninguno", verified: "verificado",
  unverified: "sin verificar", methods: "Método de acceso", mfa: "Verificación en dos pasos",
  mfaYes: "Verificada en esta sesión", mfaNo: "No se usó en esta sesión", ends: "Fin de la sesión",
  confirm: "Confirma tu identidad", confirmCopy: "Inicia sesión de nuevo antes de un cambio sensible. Volverás aquí con una sesión nueva.",
  stepUp: "Inicia sesión de nuevo para continuar", agents: "Agentes conectados", revokeCopy: "Revocar un agente termina su acceso en todas partes de inmediato.",
  failed: "Algo salió mal. Inténtalo de nuevo."
};
const fr: ExampleCopy = {
  app: "Application de démonstration", account: "Votre compte", signIn: "Se connecter", signUp: "Créer un compte",
  signedIn: "Vous êtes connecté", welcome: "Connectez-vous avec Didit",
  intro: "Créez un compte ou connectez-vous sur votre page Didit. Mot de passe oublié ? La page de connexion envoie un lien de réinitialisation.",
  openAccount: "Ouvrir votre compte", email: "Adresse e-mail", phone: "Téléphone", none: "Aucun", verified: "vérifié",
  unverified: "non vérifié", methods: "Méthode de connexion", mfa: "Vérification en deux étapes",
  mfaYes: "Vérifiée pour cette session", mfaNo: "Non utilisée pour cette session", ends: "Fin de la session",
  confirm: "Confirmez votre identité", confirmCopy: "Reconnectez-vous avant une modification sensible. Vous reviendrez ici avec une nouvelle session.",
  stepUp: "Reconnectez-vous pour continuer", agents: "Agents connectés", revokeCopy: "Révoquer un agent met immédiatement fin à son accès partout.",
  failed: "Une erreur est survenue. Réessayez."
};
const de: ExampleCopy = {
  app: "Beispiel-App", account: "Dein Konto", signIn: "Anmelden", signUp: "Konto erstellen",
  signedIn: "Du bist angemeldet", welcome: "Mit Didit anmelden",
  intro: "Erstelle ein Konto oder melde dich auf deiner Didit-Seite an. Passwort vergessen? Die Anmeldeseite sendet einen Link zum Zurücksetzen.",
  openAccount: "Dein Konto öffnen", email: "E-Mail", phone: "Telefon", none: "Keine", verified: "bestätigt",
  unverified: "nicht bestätigt", methods: "Anmeldemethode", mfa: "Bestätigung in zwei Schritten",
  mfaYes: "In dieser Sitzung bestätigt", mfaNo: "In dieser Sitzung nicht verwendet", ends: "Sitzungsende",
  confirm: "Bestätige deine Identität", confirmCopy: "Melde dich vor einer sensiblen Änderung erneut an. Danach kommst du mit einer neuen Sitzung hierher zurück.",
  stepUp: "Zum Fortfahren erneut anmelden", agents: "Verbundene Agenten", revokeCopy: "Der Widerruf beendet den Zugriff des Agenten sofort überall.",
  failed: "Etwas ist schiefgegangen. Versuche es erneut."
};
const ja: ExampleCopy = {
  app: "サンプルアプリ", account: "アカウント", signIn: "ログイン", signUp: "アカウントを作成",
  signedIn: "ログイン済みです", welcome: "Diditでログイン",
  intro: "Diditのログインページでアカウントを作成するか、ログインしてください。パスワードを忘れた場合は、ログインページから再設定リンクを送信できます。",
  openAccount: "アカウントを開く", email: "メールアドレス", phone: "電話番号", none: "なし", verified: "確認済み",
  unverified: "未確認", methods: "ログイン方法", mfa: "二段階認証",
  mfaYes: "このセッションで確認済み", mfaNo: "このセッションでは未使用", ends: "セッションの有効期限",
  confirm: "本人確認", confirmCopy: "重要な変更を行う前に再度ログインしてください。新しいセッションでこのページに戻ります。",
  stepUp: "再度ログインして続行", agents: "接続済みエージェント", revokeCopy: "エージェントを取り消すと、すべてのアクセスが直ちに終了します。",
  failed: "エラーが発生しました。もう一度お試しください。"
};
const messages: Record<string, ExampleCopy> = { en, es, fr, de, ja };

export function exampleCopy(locale: string): ExampleCopy {
  const key = locale.toLowerCase().split(/[-_]/)[0];

  return Object.prototype.hasOwnProperty.call(messages, key) ? messages[key] : en;
}
