export interface ModalTranslations {
  exitTitle: string;
  exitMessage: string;
  continueButton: string;
  exitButton: string;
  ariaLabelModal: string;
  ariaLabelClose: string;
  /** A flow that can fail to load (Bank Link) says so with these; the verification modal never shows them. */
  loadErrorMessage?: string;
  retryButton?: string;
  refusalMessage?: string;
  closeButton?: string;
}

const EN: ModalTranslations = {
  exitTitle: "Exit verification?",
  exitMessage: "Exiting will end your verification process. Are you sure?",
  continueButton: "Continue",
  exitButton: "Exit",
  ariaLabelModal: "Didit Verification",
  ariaLabelClose: "Close verification"
};

const translationsMap: Record<string, ModalTranslations> = {
  ar: {
    exitTitle: "الخروج من التحقق؟",
    exitMessage: "سيؤدي الخروج إلى إنهاء عملية التحقق الخاصة بك. هل أنت متأكد؟",
    continueButton: "متابعة",
    exitButton: "خروج",
    ariaLabelModal: "التحقق من Didit",
    ariaLabelClose: "إغلاق التحقق"
  },
  bg: {
    exitTitle: "Излизане от верификацията?",
    exitMessage: "Излизането ще прекрати процеса на верификация. Сигурни ли сте?",
    continueButton: "Продължи",
    exitButton: "Изход",
    ariaLabelModal: "Верификация Didit",
    ariaLabelClose: "Затваряне на верификацията"
  },
  bn: {
    exitTitle: "যাচাইকরণ থেকে বের হবেন?",
    exitMessage: "বের হলে আপনার যাচাইকরণ প্রক্রিয়া শেষ হয়ে যাবে। আপনি কি নিশ্চিত?",
    continueButton: "চালিয়ে যান",
    exitButton: "বের হন",
    ariaLabelModal: "Didit যাচাইকরণ",
    ariaLabelClose: "যাচাইকরণ বন্ধ করুন"
  },
  bs: {
    exitTitle: "Izaći iz verifikacije?",
    exitMessage: "Izlaskom ćete prekinuti proces verifikacije. Jeste li sigurni?",
    continueButton: "Nastavi",
    exitButton: "Izađi",
    ariaLabelModal: "Didit verifikacija",
    ariaLabelClose: "Zatvori verifikaciju"
  },
  ca: {
    exitTitle: "Sortir de la verificació?",
    exitMessage: "Sortir finalitzarà el procés de verificació. N'esteu segur?",
    continueButton: "Continua",
    exitButton: "Sortir",
    ariaLabelModal: "Verificació Didit",
    ariaLabelClose: "Tancar verificació"
  },
  cnr: {
    exitTitle: "Izaći iz verifikacije?",
    exitMessage: "Izlaskom ćete prekinuti proces verifikacije. Jeste li sigurni?",
    continueButton: "Nastavi",
    exitButton: "Izađi",
    ariaLabelModal: "Didit verifikacija",
    ariaLabelClose: "Zatvori verifikaciju"
  },
  cs: {
    exitTitle: "Opravdu chcete odejít?",
    exitMessage: "Když odejdete, proces ověření se přeruší. Opravdu chcete skončit?",
    continueButton: "Zůstat",
    exitButton: "Odejít",
    ariaLabelModal: "Ověření Didit",
    ariaLabelClose: "Zavřít ověření"
  },
  da: {
    exitTitle: "Forlad verifikation?",
    exitMessage: "Hvis du forlader, afsluttes din verifikationsproces. Er du sikker?",
    continueButton: "Fortsæt",
    exitButton: "Forlad",
    ariaLabelModal: "Didit-verifikation",
    ariaLabelClose: "Luk verifikation"
  },
  de: {
    exitTitle: "Verifizierung verlassen?",
    exitMessage: "Das Verlassen beendet Ihren Verifizierungsprozess. Sind Sie sicher?",
    continueButton: "Fortfahren",
    exitButton: "Verlassen",
    ariaLabelModal: "Didit-Verifizierung",
    ariaLabelClose: "Verifizierung schließen"
  },
  el: {
    exitTitle: "Έξοδος από την επαλήθευση;",
    exitMessage: "Η έξοδος θα τερματίσει τη διαδικασία επαλήθευσης. Είστε σίγουροι;",
    continueButton: "Συνέχεια",
    exitButton: "Έξοδος",
    ariaLabelModal: "Επαλήθευση Didit",
    ariaLabelClose: "Κλείσιμο επαλήθευσης"
  },
  en: EN,
  es: {
    exitTitle: "¿Salir de la verificación?",
    exitMessage: "Salir terminará tu proceso de verificación. ¿Estás seguro?",
    continueButton: "Continuar",
    exitButton: "Salir",
    ariaLabelModal: "Verificación Didit",
    ariaLabelClose: "Cerrar verificación"
  },
  et: {
    exitTitle: "Lahkuda kinnitamisest?",
    exitMessage: "Lahkumine lõpetab teie kinnitamisprotsessi. Kas olete kindel?",
    continueButton: "Jätka",
    exitButton: "Lahku",
    ariaLabelModal: "Didit kinnitus",
    ariaLabelClose: "Sulge kinnitus"
  },
  fa: {
    exitTitle: "خروج از تأیید هویت؟",
    exitMessage: "خروج باعث پایان فرآیند تأیید هویت شما می‌شود. آیا مطمئن هستید؟",
    continueButton: "ادامه",
    exitButton: "خروج",
    ariaLabelModal: "تأیید هویت Didit",
    ariaLabelClose: "بستن تأیید هویت"
  },
  fi: {
    exitTitle: "Poistu vahvistuksesta?",
    exitMessage: "Poistuminen päättää vahvistusprosessisi. Oletko varma?",
    continueButton: "Jatka",
    exitButton: "Poistu",
    ariaLabelModal: "Didit-vahvistus",
    ariaLabelClose: "Sulje vahvistus"
  },
  fr: {
    exitTitle: "Quitter la vérification ?",
    exitMessage: "Quitter mettra fin à votre processus de vérification. Êtes-vous sûr ?",
    continueButton: "Continuer",
    exitButton: "Quitter",
    ariaLabelModal: "Vérification Didit",
    ariaLabelClose: "Fermer la vérification"
  },
  he: {
    exitTitle: "לצאת מהאימות?",
    exitMessage: "יציאה תסיים את תהליך האימות שלך. האם אתה בטוח?",
    continueButton: "המשך",
    exitButton: "יציאה",
    ariaLabelModal: "אימות Didit",
    ariaLabelClose: "סגירת אימות"
  },
  hi: {
    exitTitle: "सत्यापन से बाहर निकलें?",
    exitMessage: "बाहर निकलने से आपकी सत्यापन प्रक्रिया समाप्त हो जाएगी। क्या आप सुनिश्चित हैं?",
    continueButton: "जारी रखें",
    exitButton: "बाहर निकलें",
    ariaLabelModal: "Didit सत्यापन",
    ariaLabelClose: "सत्यापन बंद करें"
  },
  hr: {
    exitTitle: "Izaći iz verifikacije?",
    exitMessage: "Izlaskom ćete prekinuti proces verifikacije. Jeste li sigurni?",
    continueButton: "Nastavi",
    exitButton: "Izađi",
    ariaLabelModal: "Didit verifikacija",
    ariaLabelClose: "Zatvori verifikaciju"
  },
  hu: {
    exitTitle: "Kilépés az ellenőrzésből?",
    exitMessage: "A kilépés befejezi az ellenőrzési folyamatot. Biztos benne?",
    continueButton: "Folytatás",
    exitButton: "Kilépés",
    ariaLabelModal: "Didit ellenőrzés",
    ariaLabelClose: "Ellenőrzés bezárása"
  },
  hy: {
    exitTitle: "Դուրս գա՞լ ստուգումից",
    exitMessage: "Դուրս գալը կավարտի ձեր ստուգման գործընթացը։ Համոզված ե՞ք?",
    continueButton: "Շարունակել",
    exitButton: "Դուրս գալ",
    ariaLabelModal: "Didit ստուգում",
    ariaLabelClose: "Փակել ստուգումը"
  },
  id: {
    exitTitle: "Keluar dari verifikasi?",
    exitMessage: "Keluar akan mengakhiri proses verifikasi Anda. Apakah Anda yakin?",
    continueButton: "Lanjutkan",
    exitButton: "Keluar",
    ariaLabelModal: "Verifikasi Didit",
    ariaLabelClose: "Tutup verifikasi"
  },
  it: {
    exitTitle: "Uscire dalla verifica?",
    exitMessage: "L'uscita terminerà il processo di verifica. Sei sicuro?",
    continueButton: "Continua",
    exitButton: "Esci",
    ariaLabelModal: "Verifica Didit",
    ariaLabelClose: "Chiudi verifica"
  },
  ja: {
    exitTitle: "認証を終了しますか？",
    exitMessage: "終了すると認証プロセスが中断されます。よろしいですか？",
    continueButton: "続ける",
    exitButton: "終了",
    ariaLabelModal: "Didit 認証",
    ariaLabelClose: "認証を閉じる"
  },
  ka: {
    exitTitle: "გამოსვლა შემოწმებიდან?",
    exitMessage: "გამოსვლა დაასრულებს თქვენს შემოწმების პროცესს. დარწმუნებული ხართ?",
    continueButton: "გაგრძელება",
    exitButton: "გამოსვლა",
    ariaLabelModal: "Didit შემოწმება",
    ariaLabelClose: "შემოწმების დახურვა"
  },
  kk: {
    exitTitle: "Растаудан шығасыз ба?",
    exitMessage: "Шығу растау процесін аяқтайды. Сенімдісіз бе?",
    continueButton: "Жалғастыру",
    exitButton: "Шығу",
    ariaLabelModal: "Didit растауы",
    ariaLabelClose: "Растауды жабу"
  },
  ko: {
    exitTitle: "인증을 종료하시겠습니까?",
    exitMessage: "종료하면 인증 절차가 중단됩니다. 확실하십니까?",
    continueButton: "계속",
    exitButton: "종료",
    ariaLabelModal: "Didit 인증",
    ariaLabelClose: "인증 닫기"
  },
  ky: {
    exitTitle: "Текшерүүдөн чыгасызбы?",
    exitMessage: "Чыгуу текшерүү процессин токтотот. Ишенесизби?",
    continueButton: "Улантуу",
    exitButton: "Чыгуу",
    ariaLabelModal: "Didit текшерүүсү",
    ariaLabelClose: "Текшерүүнү жабуу"
  },
  lt: {
    exitTitle: "Išeiti iš patvirtinimo?",
    exitMessage: "Išėjimas nutrauks jūsų patvirtinimo procesą. Ar esate tikri?",
    continueButton: "Tęsti",
    exitButton: "Išeiti",
    ariaLabelModal: "Didit patvirtinimas",
    ariaLabelClose: "Uždaryti patvirtinimą"
  },
  lv: {
    exitTitle: "Iziet no verifikācijas?",
    exitMessage: "Iziešana pārtrauks jūsu verifikācijas procesu. Vai esat pārliecināts?",
    continueButton: "Turpināt",
    exitButton: "Iziet",
    ariaLabelModal: "Didit verifikācija",
    ariaLabelClose: "Aizvērt verifikāciju"
  },
  mk: {
    exitTitle: "Излези од верификацијата?",
    exitMessage: "Излегувањето ќе го прекине процесот на верификација. Дали сте сигурни?",
    continueButton: "Продолжи",
    exitButton: "Излези",
    ariaLabelModal: "Верификација Didit",
    ariaLabelClose: "Затвори верификација"
  },
  mn: {
    exitTitle: "Баталгаажуулалтаас гарах уу?",
    exitMessage: "Гарвал таны баталгаажуулалтын процесс дуусна. Та итгэлтэй байна уу?",
    continueButton: "Үргэлжлүүлэх",
    exitButton: "Гарах",
    ariaLabelModal: "Didit баталгаажуулалт",
    ariaLabelClose: "Баталгаажуулалтыг хаах"
  },
  ms: {
    exitTitle: "Keluar dari pengesahan?",
    exitMessage: "Keluar akan menamatkan proses pengesahan anda. Adakah anda pasti?",
    continueButton: "Teruskan",
    exitButton: "Keluar",
    ariaLabelModal: "Pengesahan Didit",
    ariaLabelClose: "Tutup pengesahan"
  },
  nl: {
    exitTitle: "Verificatie verlaten?",
    exitMessage: "Verlaten beëindigt uw verificatieproces. Weet u het zeker?",
    continueButton: "Doorgaan",
    exitButton: "Verlaten",
    ariaLabelModal: "Didit-verificatie",
    ariaLabelClose: "Verificatie sluiten"
  },
  no: {
    exitTitle: "Forlat verifisering?",
    exitMessage: "Å forlate vil avslutte verifiseringsprosessen. Er du sikker?",
    continueButton: "Fortsett",
    exitButton: "Forlat",
    ariaLabelModal: "Didit-verifisering",
    ariaLabelClose: "Lukk verifisering"
  },
  pl: {
    exitTitle: "Czy wyjść z weryfikacji?",
    exitMessage: "Wyjście zakończy proces weryfikacji. Czy na pewno?",
    continueButton: "Kontynuuj",
    exitButton: "Wyjdź",
    ariaLabelModal: "Weryfikacja Didit",
    ariaLabelClose: "Zamknij weryfikację"
  },
  "pt-BR": {
    exitTitle: "Sair da verificação?",
    exitMessage: "Sair encerrará seu processo de verificação. Tem certeza?",
    continueButton: "Continuar",
    exitButton: "Sair",
    ariaLabelModal: "Verificação Didit",
    ariaLabelClose: "Fechar verificação"
  },
  pt: {
    exitTitle: "Sair da verificação?",
    exitMessage: "Sair terminará o seu processo de verificação. Tem a certeza?",
    continueButton: "Continuar",
    exitButton: "Sair",
    ariaLabelModal: "Verificação Didit",
    ariaLabelClose: "Fechar verificação"
  },
  ro: {
    exitTitle: "Ieși din verificare?",
    exitMessage: "Ieșirea va încheia procesul de verificare. Ești sigur?",
    continueButton: "Continuă",
    exitButton: "Ieși",
    ariaLabelModal: "Verificare Didit",
    ariaLabelClose: "Închide verificarea"
  },
  ru: {
    exitTitle: "Выйти из верификации?",
    exitMessage: "Выход завершит процесс верификации. Вы уверены?",
    continueButton: "Продолжить",
    exitButton: "Выйти",
    ariaLabelModal: "Верификация Didit",
    ariaLabelClose: "Закрыть верификацию"
  },
  sk: {
    exitTitle: "Opustiť overenie?",
    exitMessage: "Odchodom ukončíte proces overenia. Ste si istí?",
    continueButton: "Pokračovať",
    exitButton: "Odísť",
    ariaLabelModal: "Overenie Didit",
    ariaLabelClose: "Zavrieť overenie"
  },
  sl: {
    exitTitle: "Zapustiti preverjanje?",
    exitMessage: "Izhod bo prekinil postopek preverjanja. Ali ste prepričani?",
    continueButton: "Nadaljuj",
    exitButton: "Izhod",
    ariaLabelModal: "Preverjanje Didit",
    ariaLabelClose: "Zapri preverjanje"
  },
  so: {
    exitTitle: "Ka baxdo xaqiijinta?",
    exitMessage: "Ka bixitaanku wuxuu dhammayn doonaa habka xaqiijintaada. Ma hubtaa?",
    continueButton: "Sii wad",
    exitButton: "Ka bax",
    ariaLabelModal: "Xaqiijinta Didit",
    ariaLabelClose: "Xir xaqiijinta"
  },
  sq: {
    exitTitle: "Dilni nga verifikimi?",
    exitMessage: "Dalja do të përfundojë procesin tuaj të verifikimit. A jeni të sigurt?",
    continueButton: "Vazhdo",
    exitButton: "Dil",
    ariaLabelModal: "Verifikimi Didit",
    ariaLabelClose: "Mbyll verifikimin"
  },
  sr: {
    exitTitle: "Изаћи из верификације?",
    exitMessage: "Изласком ћете прекинути процес верификације. Да ли сте сигурни?",
    continueButton: "Настави",
    exitButton: "Изађи",
    ariaLabelModal: "Верификација Didit",
    ariaLabelClose: "Затвори верификацију"
  },
  sv: {
    exitTitle: "Lämna verifiering?",
    exitMessage: "Att lämna avslutar din verifieringsprocess. Är du säker?",
    continueButton: "Fortsätt",
    exitButton: "Lämna",
    ariaLabelModal: "Didit-verifiering",
    ariaLabelClose: "Stäng verifiering"
  },
  th: {
    exitTitle: "ออกจากการยืนยันตัวตน?",
    exitMessage: "การออกจะสิ้นสุดกระบวนการยืนยันตัวตนของคุณ คุณแน่ใจหรือไม่?",
    continueButton: "ดำเนินการต่อ",
    exitButton: "ออก",
    ariaLabelModal: "การยืนยันตัวตน Didit",
    ariaLabelClose: "ปิดการยืนยันตัวตน"
  },
  tr: {
    exitTitle: "Doğrulamadan çıkmak istiyor musunuz?",
    exitMessage: "Çıkış, doğrulama sürecinizi sonlandıracak. Emin misiniz?",
    continueButton: "Devam et",
    exitButton: "Çıkış",
    ariaLabelModal: "Didit doğrulama",
    ariaLabelClose: "Doğrulamayı kapat"
  },
  uk: {
    exitTitle: "Вийти з верифікації?",
    exitMessage: "Вихід завершить процес верифікації. Ви впевнені?",
    continueButton: "Продовжити",
    exitButton: "Вийти",
    ariaLabelModal: "Верифікація Didit",
    ariaLabelClose: "Закрити верифікацію"
  },
  uz: {
    exitTitle: "Tekshiruvdan chiqasizmi?",
    exitMessage: "Chiqish tekshiruv jarayonini tugatadi. Ishonchingiz komilmi?",
    continueButton: "Davom etish",
    exitButton: "Chiqish",
    ariaLabelModal: "Didit tekshiruvi",
    ariaLabelClose: "Tekshiruvni yopish"
  },
  vi: {
    exitTitle: "Thoát khỏi xác minh?",
    exitMessage: "Thoát sẽ kết thúc quá trình xác minh của bạn. Bạn có chắc không?",
    continueButton: "Tiếp tục",
    exitButton: "Thoát",
    ariaLabelModal: "Xác minh Didit",
    ariaLabelClose: "Đóng xác minh"
  },
  "zh-CN": {
    exitTitle: "退出验证？",
    exitMessage: "退出将结束您的验证流程。确定要退出吗？",
    continueButton: "继续",
    exitButton: "退出",
    ariaLabelModal: "Didit 验证",
    ariaLabelClose: "关闭验证"
  },
  "zh-TW": {
    exitTitle: "退出驗證？",
    exitMessage: "退出將結束您的驗證流程。確定要退出嗎？",
    continueButton: "繼續",
    exitButton: "退出",
    ariaLabelModal: "Didit 驗證",
    ariaLabelClose: "關閉驗證"
  },
  zh: {
    exitTitle: "退出验证？",
    exitMessage: "退出将结束您的验证流程。确定要退出吗？",
    continueButton: "继续",
    exitButton: "退出",
    ariaLabelModal: "Didit 验证",
    ariaLabelClose: "关闭验证"
  }
};

export function getTranslations(language: string): ModalTranslations {
  return translationsMap[language] ?? EN;
}

/**
 * The text a Bank Link modal draws itself: its dialog label and the close button label. The
 * link screens are in the hosted page and carry their own translations.
 */
export interface BankLinkTranslations {
  ariaLabelBankLink: string;
  ariaLabelCloseBankLink: string;
  /** Shown with a retry button when the hosted page's document never loaded. */
  loadErrorMessage: string;
  retryButton: string;
  /** Shown when the link cannot be opened on this page: it blames nothing on the person and names no internals. */
  refusalMessage: string;
  closeButton: string;
}

const BANK_LINK_EN: BankLinkTranslations = {
  ariaLabelBankLink: "Didit bank connection",
  ariaLabelCloseBankLink: "Close bank connection",
  loadErrorMessage: "We couldn't load the bank connection. Check your connection and try again.",
  retryButton: "Try again",
  refusalMessage: "This bank connection can't be opened here. Please contact the company that sent you the link.",
  closeButton: "Close"
};

const bankLinkTranslationsMap: Record<string, BankLinkTranslations> = {
  ar: { ariaLabelBankLink: "ربط الحساب المصرفي من Didit", ariaLabelCloseBankLink: "إغلاق ربط الحساب المصرفي", loadErrorMessage: "تعذّر تحميل ربط الحساب المصرفي. تحقق من اتصالك وحاول مرة أخرى.", retryButton: "حاول مرة أخرى", refusalMessage: "لا يمكن فتح هذا الربط المصرفي هنا. يُرجى التواصل مع الشركة التي أرسلت لك الرابط.", closeButton: "إغلاق" },
  bg: { ariaLabelBankLink: "Банкова връзка Didit", ariaLabelCloseBankLink: "Затваряне на банковата връзка", loadErrorMessage: "Банковата връзка не можа да се зареди. Проверете интернет връзката си и опитайте отново.", retryButton: "Опитайте отново", refusalMessage: "Тази банкова връзка не може да бъде отворена тук. Моля, свържете се с компанията, която ви е изпратила връзката.", closeButton: "Затвори" },
  bn: { ariaLabelBankLink: "Didit ব্যাংক সংযোগ", ariaLabelCloseBankLink: "ব্যাংক সংযোগ বন্ধ করুন", loadErrorMessage: "ব্যাংক সংযোগ লোড করা যায়নি। আপনার ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।", retryButton: "আবার চেষ্টা করুন", refusalMessage: "এই ব্যাংক সংযোগটি এখানে খোলা যাচ্ছে না। অনুগ্রহ করে যে প্রতিষ্ঠান আপনাকে লিঙ্কটি পাঠিয়েছে তাদের সঙ্গে যোগাযোগ করুন।", closeButton: "বন্ধ করুন" },
  bs: { ariaLabelBankLink: "Didit povezivanje banke", ariaLabelCloseBankLink: "Zatvori povezivanje banke", loadErrorMessage: "Povezivanje banke nije moguće učitati. Provjerite internetsku vezu i pokušajte ponovo.", retryButton: "Pokušaj ponovo", refusalMessage: "Ovo povezivanje banke ne može se otvoriti ovdje. Obratite se kompaniji koja vam je poslala vezu.", closeButton: "Zatvori" },
  ca: { ariaLabelBankLink: "Connexió bancària Didit", ariaLabelCloseBankLink: "Tancar la connexió bancària", loadErrorMessage: "No s'ha pogut carregar la connexió bancària. Comproveu la connexió i torneu-ho a provar.", retryButton: "Torna-ho a provar", refusalMessage: "Aquesta connexió bancària no es pot obrir aquí. Poseu-vos en contacte amb l'empresa que us ha enviat l'enllaç.", closeButton: "Tanca" },
  cnr: { ariaLabelBankLink: "Didit povezivanje banke", ariaLabelCloseBankLink: "Zatvori povezivanje banke", loadErrorMessage: "Povezivanje banke nije moguće učitati. Provjerite internetsku vezu i pokušajte ponovo.", retryButton: "Pokušaj ponovo", refusalMessage: "Ovo povezivanje banke ne može se otvoriti ovdje. Obratite se kompaniji koja vam je poslala vezu.", closeButton: "Zatvori" },
  cs: { ariaLabelBankLink: "Propojení banky Didit", ariaLabelCloseBankLink: "Zavřít propojení banky", loadErrorMessage: "Propojení s bankou se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.", retryButton: "Zkusit znovu", refusalMessage: "Toto propojení s bankou se zde nedá otevřít. Obraťte se na společnost, která vám odkaz poslala.", closeButton: "Zavřít" },
  da: { ariaLabelBankLink: "Didit bankforbindelse", ariaLabelCloseBankLink: "Luk bankforbindelse", loadErrorMessage: "Bankforbindelsen kunne ikke indlæses. Tjek din internetforbindelse, og prøv igen.", retryButton: "Prøv igen", refusalMessage: "Denne bankforbindelse kan ikke åbnes her. Kontakt den virksomhed, der sendte dig linket.", closeButton: "Luk" },
  de: { ariaLabelBankLink: "Didit Bankverbindung", ariaLabelCloseBankLink: "Bankverbindung schließen", loadErrorMessage: "Die Bankverbindung konnte nicht geladen werden. Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.", retryButton: "Erneut versuchen", refusalMessage: "Diese Bankverbindung kann hier nicht geöffnet werden. Bitte wenden Sie sich an das Unternehmen, das Ihnen den Link geschickt hat.", closeButton: "Schließen" },
  el: { ariaLabelBankLink: "Σύνδεση τράπεζας Didit", ariaLabelCloseBankLink: "Κλείσιμο σύνδεσης τράπεζας", loadErrorMessage: "Δεν ήταν δυνατή η φόρτωση της σύνδεσης τράπεζας. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.", retryButton: "Δοκιμάστε ξανά", refusalMessage: "Αυτή η σύνδεση τράπεζας δεν μπορεί να ανοίξει εδώ. Επικοινωνήστε με την εταιρεία που σας έστειλε τον σύνδεσμο.", closeButton: "Κλείσιμο" },
  es: { ariaLabelBankLink: "Conexión bancaria Didit", ariaLabelCloseBankLink: "Cerrar la conexión bancaria", loadErrorMessage: "No se pudo cargar la conexión bancaria. Comprueba tu conexión e inténtalo de nuevo.", retryButton: "Reintentar", refusalMessage: "Esta conexión bancaria no se puede abrir aquí. Ponte en contacto con la empresa que te envió el enlace.", closeButton: "Cerrar" },
  et: { ariaLabelBankLink: "Didit pangaühendus", ariaLabelCloseBankLink: "Sulge pangaühendus", loadErrorMessage: "Pangaühendust ei õnnestunud laadida. Kontrollige oma internetiühendust ja proovige uuesti.", retryButton: "Proovi uuesti", refusalMessage: "Seda pangaühendust ei saa siin avada. Võtke ühendust ettevõttega, kes teile lingi saatis.", closeButton: "Sulge" },
  fa: { ariaLabelBankLink: "اتصال بانکی Didit", ariaLabelCloseBankLink: "بستن اتصال بانکی", loadErrorMessage: "بارگذاری اتصال بانکی انجام نشد. اتصال اینترنت خود را بررسی کنید و دوباره تلاش کنید.", retryButton: "تلاش دوباره", refusalMessage: "این اتصال بانکی در اینجا باز نمی‌شود. لطفاً با شرکتی که پیوند را برای شما فرستاده تماس بگیرید.", closeButton: "بستن" },
  fi: { ariaLabelBankLink: "Didit-pankkiyhteys", ariaLabelCloseBankLink: "Sulje pankkiyhteys", loadErrorMessage: "Pankkiyhteyden lataaminen epäonnistui. Tarkista verkkoyhteytesi ja yritä uudelleen.", retryButton: "Yritä uudelleen", refusalMessage: "Tätä pankkiyhteyttä ei voi avata täällä. Ota yhteyttä yritykseen, joka lähetti sinulle linkin.", closeButton: "Sulje" },
  fr: { ariaLabelBankLink: "Connexion bancaire Didit", ariaLabelCloseBankLink: "Fermer la connexion bancaire", loadErrorMessage: "La connexion bancaire n'a pas pu être chargée. Vérifiez votre connexion et réessayez.", retryButton: "Réessayer", refusalMessage: "Cette connexion bancaire ne peut pas être ouverte ici. Veuillez contacter l'entreprise qui vous a envoyé le lien.", closeButton: "Fermer" },
  he: { ariaLabelBankLink: "חיבור בנק Didit", ariaLabelCloseBankLink: "סגירת חיבור הבנק", loadErrorMessage: "לא ניתן היה לטעון את חיבור הבנק. בדקו את החיבור לאינטרנט ונסו שוב.", retryButton: "נסו שוב", refusalMessage: "לא ניתן לפתוח את חיבור הבנק הזה כאן. פנו לחברה ששלחה לכם את הקישור.", closeButton: "סגירה" },
  hi: { ariaLabelBankLink: "Didit बैंक कनेक्शन", ariaLabelCloseBankLink: "बैंक कनेक्शन बंद करें", loadErrorMessage: "बैंक कनेक्शन लोड नहीं हो सका। अपना इंटरनेट कनेक्शन जाँचें और फिर से प्रयास करें।", retryButton: "फिर से प्रयास करें", refusalMessage: "यह बैंक कनेक्शन यहाँ नहीं खोला जा सकता। कृपया उस कंपनी से संपर्क करें जिसने आपको लिंक भेजा है।", closeButton: "बंद करें" },
  hr: { ariaLabelBankLink: "Didit povezivanje banke", ariaLabelCloseBankLink: "Zatvori povezivanje banke", loadErrorMessage: "Povezivanje s bankom nije moguće učitati. Provjerite internetsku vezu i pokušajte ponovno.", retryButton: "Pokušaj ponovno", refusalMessage: "Ova se veza s bankom ne može otvoriti ovdje. Obratite se tvrtki koja vam je poslala poveznicu.", closeButton: "Zatvori" },
  hu: { ariaLabelBankLink: "Didit banki kapcsolat", ariaLabelCloseBankLink: "Banki kapcsolat bezárása", loadErrorMessage: "A banki kapcsolat betöltése nem sikerült. Ellenőrizze az internetkapcsolatot, és próbálja újra.", retryButton: "Újrapróbálás", refusalMessage: "Ez a banki kapcsolat itt nem nyitható meg. Kérjük, forduljon ahhoz a céghez, amely a linket küldte.", closeButton: "Bezárás" },
  hy: { ariaLabelBankLink: "Didit բանկային կապ", ariaLabelCloseBankLink: "Փակել բանկային կապը", loadErrorMessage: "Բանկային կապը չհաջողվեց բեռնել։ Ստուգեք ինտերնետ կապը և կրկին փորձեք։", retryButton: "Կրկին փորձել", refusalMessage: "Այս բանկային կապը հնարավոր չէ բացել այստեղ։ Խնդրում ենք դիմել այն ընկերությանը, որն ուղարկել է հղումը։", closeButton: "Փակել" },
  id: { ariaLabelBankLink: "Koneksi bank Didit", ariaLabelCloseBankLink: "Tutup koneksi bank", loadErrorMessage: "Koneksi bank tidak dapat dimuat. Periksa koneksi internet Anda lalu coba lagi.", retryButton: "Coba lagi", refusalMessage: "Koneksi bank ini tidak dapat dibuka di sini. Hubungi perusahaan yang mengirimkan tautan kepada Anda.", closeButton: "Tutup" },
  it: { ariaLabelBankLink: "Collegamento bancario Didit", ariaLabelCloseBankLink: "Chiudi il collegamento bancario", loadErrorMessage: "Non è stato possibile caricare il collegamento bancario. Controlla la connessione e riprova.", retryButton: "Riprova", refusalMessage: "Questo collegamento bancario non può essere aperto qui. Contatta l'azienda che ti ha inviato il link.", closeButton: "Chiudi" },
  ja: { ariaLabelBankLink: "Didit 銀行連携", ariaLabelCloseBankLink: "銀行連携を閉じる", loadErrorMessage: "銀行連携を読み込めませんでした。接続を確認して、もう一度お試しください。", retryButton: "再試行", refusalMessage: "この銀行連携はここでは開けません。リンクを送った会社にお問い合わせください。", closeButton: "閉じる" },
  ka: { ariaLabelBankLink: "Didit საბანკო კავშირი", ariaLabelCloseBankLink: "საბანკო კავშირის დახურვა", loadErrorMessage: "საბანკო კავშირის ჩატვირთვა ვერ მოხერხდა. შეამოწმეთ ინტერნეტკავშირი და სცადეთ ხელახლა.", retryButton: "ხელახლა ცდა", refusalMessage: "ამ საბანკო კავშირის გახსნა აქ შეუძლებელია. გთხოვთ, დაუკავშირდეთ კომპანიას, რომელმაც ბმული გამოგიგზავნათ.", closeButton: "დახურვა" },
  kk: { ariaLabelBankLink: "Didit банк байланысы", ariaLabelCloseBankLink: "Банк байланысын жабу", loadErrorMessage: "Банк байланысын жүктеу мүмкін болмады. Интернет байланысын тексеріп, қайталап көріңіз.", retryButton: "Қайталау", refusalMessage: "Бұл банк байланысын мұнда ашу мүмкін емес. Сілтемені жіберген компанияға хабарласыңыз.", closeButton: "Жабу" },
  ko: { ariaLabelBankLink: "Didit 은행 연결", ariaLabelCloseBankLink: "은행 연결 닫기", loadErrorMessage: "은행 연결을 불러오지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해 주세요.", retryButton: "다시 시도", refusalMessage: "이 은행 연결은 여기에서 열 수 없습니다. 링크를 보낸 회사에 문의해 주세요.", closeButton: "닫기" },
  ky: { ariaLabelBankLink: "Didit банк байланышы", ariaLabelCloseBankLink: "Банк байланышын жабуу", loadErrorMessage: "Банк байланышын жүктөө мүмкүн болгон жок. Интернет байланышын текшерип, кайра аракет кылыңыз.", retryButton: "Кайра аракет кылуу", refusalMessage: "Бул банк байланышын бул жерде ачуу мүмкүн эмес. Шилтемени жиберген компания менен байланышыңыз.", closeButton: "Жабуу" },
  lt: { ariaLabelBankLink: "Didit banko ryšys", ariaLabelCloseBankLink: "Uždaryti banko ryšį", loadErrorMessage: "Nepavyko įkelti banko ryšio. Patikrinkite interneto ryšį ir bandykite dar kartą.", retryButton: "Bandyti dar kartą", refusalMessage: "Šio banko ryšio čia atidaryti negalima. Susisiekite su įmone, kuri atsiuntė nuorodą.", closeButton: "Uždaryti" },
  lv: { ariaLabelBankLink: "Didit bankas savienojums", ariaLabelCloseBankLink: "Aizvērt bankas savienojumu", loadErrorMessage: "Bankas savienojumu neizdevās ielādēt. Pārbaudiet interneta savienojumu un mēģiniet vēlreiz.", retryButton: "Mēģināt vēlreiz", refusalMessage: "Šo bankas savienojumu šeit nevar atvērt. Lūdzu, sazinieties ar uzņēmumu, kas jums nosūtīja saiti.", closeButton: "Aizvērt" },
  mk: { ariaLabelBankLink: "Didit поврзување на банка", ariaLabelCloseBankLink: "Затвори го поврзувањето со банка", loadErrorMessage: "Поврзувањето со банката не можеше да се вчита. Проверете ја интернет-врската и обидете се повторно.", retryButton: "Обидете се повторно", refusalMessage: "Ова поврзување со банка не може да се отвори овде. Контактирајте ја компанијата што ви ја испрати врската.", closeButton: "Затвори" },
  mn: { ariaLabelBankLink: "Didit банкны холболт", ariaLabelCloseBankLink: "Банкны холболтыг хаах", loadErrorMessage: "Банкны холболтыг ачаалж чадсангүй. Интернет холболтоо шалгаад дахин оролдоно уу.", retryButton: "Дахин оролдох", refusalMessage: "Энэ банкны холболтыг энд нээх боломжгүй. Холбоосыг танд илгээсэн компанитай холбогдоно уу.", closeButton: "Хаах" },
  ms: { ariaLabelBankLink: "Sambungan bank Didit", ariaLabelCloseBankLink: "Tutup sambungan bank", loadErrorMessage: "Sambungan bank tidak dapat dimuatkan. Semak sambungan internet anda dan cuba lagi.", retryButton: "Cuba lagi", refusalMessage: "Sambungan bank ini tidak boleh dibuka di sini. Sila hubungi syarikat yang menghantar pautan kepada anda.", closeButton: "Tutup" },
  nl: { ariaLabelBankLink: "Didit bankkoppeling", ariaLabelCloseBankLink: "Bankkoppeling sluiten", loadErrorMessage: "De bankkoppeling kon niet worden geladen. Controleer je internetverbinding en probeer het opnieuw.", retryButton: "Opnieuw proberen", refusalMessage: "Deze bankkoppeling kan hier niet worden geopend. Neem contact op met het bedrijf dat je de link heeft gestuurd.", closeButton: "Sluiten" },
  no: { ariaLabelBankLink: "Didit bankforbindelse", ariaLabelCloseBankLink: "Lukk bankforbindelsen", loadErrorMessage: "Bankforbindelsen kunne ikke lastes. Sjekk internettforbindelsen og prøv igjen.", retryButton: "Prøv igjen", refusalMessage: "Denne bankforbindelsen kan ikke åpnes her. Ta kontakt med selskapet som sendte deg lenken.", closeButton: "Lukk" },
  pl: { ariaLabelBankLink: "Połączenie z bankiem Didit", ariaLabelCloseBankLink: "Zamknij połączenie z bankiem", loadErrorMessage: "Nie udało się załadować połączenia z bankiem. Sprawdź połączenie z internetem i spróbuj ponownie.", retryButton: "Spróbuj ponownie", refusalMessage: "Tego połączenia z bankiem nie można tutaj otworzyć. Skontaktuj się z firmą, która przesłała Ci link.", closeButton: "Zamknij" },
  "pt-BR": { ariaLabelBankLink: "Conexão bancária Didit", ariaLabelCloseBankLink: "Fechar conexão bancária", loadErrorMessage: "Não foi possível carregar a conexão bancária. Verifique sua conexão e tente novamente.", retryButton: "Tentar novamente", refusalMessage: "Não é possível abrir esta conexão bancária aqui. Entre em contato com a empresa que enviou o link para você.", closeButton: "Fechar" },
  pt: { ariaLabelBankLink: "Ligação bancária Didit", ariaLabelCloseBankLink: "Fechar ligação bancária", loadErrorMessage: "Não foi possível carregar a ligação bancária. Verifique a sua ligação e tente novamente.", retryButton: "Tentar novamente", refusalMessage: "Não é possível abrir esta ligação bancária aqui. Contacte a empresa que lhe enviou a ligação.", closeButton: "Fechar" },
  ro: { ariaLabelBankLink: "Conexiune bancară Didit", ariaLabelCloseBankLink: "Închide conexiunea bancară", loadErrorMessage: "Conexiunea bancară nu a putut fi încărcată. Verifică conexiunea la internet și încearcă din nou.", retryButton: "Încearcă din nou", refusalMessage: "Această conexiune bancară nu poate fi deschisă aici. Contactează compania care ți-a trimis linkul.", closeButton: "Închide" },
  ru: { ariaLabelBankLink: "Подключение банка Didit", ariaLabelCloseBankLink: "Закрыть подключение банка", loadErrorMessage: "Не удалось загрузить подключение банка. Проверьте подключение к интернету и повторите попытку.", retryButton: "Повторить", refusalMessage: "Это подключение банка нельзя открыть здесь. Обратитесь в компанию, приславшую вам ссылку.", closeButton: "Закрыть" },
  sk: { ariaLabelBankLink: "Prepojenie banky Didit", ariaLabelCloseBankLink: "Zavrieť prepojenie banky", loadErrorMessage: "Prepojenie s bankou sa nepodarilo načítať. Skontrolujte pripojenie a skúste to znova.", retryButton: "Skúsiť znova", refusalMessage: "Toto prepojenie s bankou sa tu nedá otvoriť. Obráťte sa na spoločnosť, ktorá vám poslala odkaz.", closeButton: "Zavrieť" },
  sl: { ariaLabelBankLink: "Povezava z banko Didit", ariaLabelCloseBankLink: "Zapri povezavo z banko", loadErrorMessage: "Povezave z banko ni bilo mogoče naložiti. Preverite internetno povezavo in poskusite znova.", retryButton: "Poskusi znova", refusalMessage: "Te povezave z banko tukaj ni mogoče odpreti. Obrnite se na podjetje, ki vam je poslalo povezavo.", closeButton: "Zapri" },
  so: { ariaLabelBankLink: "Isku xirka bangiga Didit", ariaLabelCloseBankLink: "Xir isku xirka bangiga", loadErrorMessage: "Isku xirka bangiga lama soo rari karin. Hubi xiriirkaaga internetka oo mar kale isku day.", retryButton: "Mar kale isku day", refusalMessage: "Isku xirka bangigan halkan lagama furi karo. Fadlan la xiriir shirkadda kuu soo dirtay xiriirka.", closeButton: "Xir" },
  sq: { ariaLabelBankLink: "Lidhja bankare Didit", ariaLabelCloseBankLink: "Mbyll lidhjen bankare", loadErrorMessage: "Lidhja bankare nuk u ngarkua. Kontrolloni lidhjen me internetin dhe provoni përsëri.", retryButton: "Provo përsëri", refusalMessage: "Kjo lidhje bankare nuk mund të hapet këtu. Ju lutemi kontaktoni kompaninë që ju dërgoi lidhjen.", closeButton: "Mbyll" },
  sr: { ariaLabelBankLink: "Didit повезивање банке", ariaLabelCloseBankLink: "Затвори повезивање банке", loadErrorMessage: "Повезивање са банком није могуће учитати. Проверите интернет везу и покушајте поново.", retryButton: "Покушај поново", refusalMessage: "Ово повезивање са банком не може да се отвори овде. Обратите се компанији која вам је послала везу.", closeButton: "Затвори" },
  sv: { ariaLabelBankLink: "Didit bankanslutning", ariaLabelCloseBankLink: "Stäng bankanslutningen", loadErrorMessage: "Bankanslutningen kunde inte laddas. Kontrollera din internetanslutning och försök igen.", retryButton: "Försök igen", refusalMessage: "Den här bankanslutningen kan inte öppnas här. Kontakta företaget som skickade länken till dig.", closeButton: "Stäng" },
  th: { ariaLabelBankLink: "การเชื่อมต่อธนาคาร Didit", ariaLabelCloseBankLink: "ปิดการเชื่อมต่อธนาคาร", loadErrorMessage: "ไม่สามารถโหลดการเชื่อมต่อธนาคารได้ โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง", retryButton: "ลองอีกครั้ง", refusalMessage: "ไม่สามารถเปิดการเชื่อมต่อธนาคารนี้ที่นี่ได้ โปรดติดต่อบริษัทที่ส่งลิงก์ให้คุณ", closeButton: "ปิด" },
  tr: { ariaLabelBankLink: "Didit banka bağlantısı", ariaLabelCloseBankLink: "Banka bağlantısını kapat", loadErrorMessage: "Banka bağlantısı yüklenemedi. İnternet bağlantınızı kontrol edip tekrar deneyin.", retryButton: "Tekrar dene", refusalMessage: "Bu banka bağlantısı burada açılamıyor. Lütfen size bağlantıyı gönderen şirketle iletişime geçin.", closeButton: "Kapat" },
  uk: { ariaLabelBankLink: "Підключення банку Didit", ariaLabelCloseBankLink: "Закрити підключення банку", loadErrorMessage: "Не вдалося завантажити підключення банку. Перевірте підключення до інтернету та спробуйте ще раз.", retryButton: "Спробувати ще раз", refusalMessage: "Це підключення банку не можна відкрити тут. Зверніться до компанії, яка надіслала вам посилання.", closeButton: "Закрити" },
  uz: { ariaLabelBankLink: "Didit bank ulanishi", ariaLabelCloseBankLink: "Bank ulanishini yopish", loadErrorMessage: "Bank ulanishini yuklab bo'lmadi. Internet aloqangizni tekshirib, qayta urinib ko'ring.", retryButton: "Qayta urinish", refusalMessage: "Bu bank ulanishini bu yerda ochib bo'lmaydi. Havolani yuborgan kompaniya bilan bog'laning.", closeButton: "Yopish" },
  vi: { ariaLabelBankLink: "Kết nối ngân hàng Didit", ariaLabelCloseBankLink: "Đóng kết nối ngân hàng", loadErrorMessage: "Không thể tải kết nối ngân hàng. Hãy kiểm tra kết nối internet và thử lại.", retryButton: "Thử lại", refusalMessage: "Không thể mở kết nối ngân hàng này tại đây. Vui lòng liên hệ công ty đã gửi liên kết cho bạn.", closeButton: "Đóng" },
  "zh-CN": { ariaLabelBankLink: "Didit 银行连接", ariaLabelCloseBankLink: "关闭银行连接", loadErrorMessage: "无法加载银行连接。请检查网络连接后重试。", retryButton: "重试", refusalMessage: "此处无法打开该银行连接。请联系向您发送链接的公司。", closeButton: "关闭" },
  "zh-TW": { ariaLabelBankLink: "Didit 銀行連結", ariaLabelCloseBankLink: "關閉銀行連結", loadErrorMessage: "無法載入銀行連結。請檢查網路連線後再試一次。", retryButton: "重試", refusalMessage: "此處無法開啟該銀行連結。請聯絡寄送連結給您的公司。", closeButton: "關閉" },
  zh: { ariaLabelBankLink: "Didit 银行连接", ariaLabelCloseBankLink: "关闭银行连接", loadErrorMessage: "无法加载银行连接。请检查网络连接后重试。", retryButton: "重试", refusalMessage: "此处无法打开该银行连接。请联系向您发送链接的公司。", closeButton: "关闭" }
};

export function getBankLinkTranslations(language: string): BankLinkTranslations {
  // A regional code of a language the SDK has (es-ES, fr-CA) uses the language's text.
  return bankLinkTranslationsMap[language] ?? bankLinkTranslationsMap[language.split("-")[0]] ?? BANK_LINK_EN;
}

/** The modal text of a Bank Link: the shared exit texts (never shown, the flow closes without asking) with the bank labels. */
export function getBankLinkModalTranslations(language: string): ModalTranslations {
  const t = getBankLinkTranslations(language);
  return {
    ...getTranslations(language),
    ariaLabelModal: t.ariaLabelBankLink,
    ariaLabelClose: t.ariaLabelCloseBankLink,
    loadErrorMessage: t.loadErrorMessage,
    retryButton: t.retryButton,
    refusalMessage: t.refusalMessage,
    closeButton: t.closeButton
  };
}

export const BANK_LINK_TRANSLATION_LANGUAGES = Object.keys(bankLinkTranslationsMap);
export const MODAL_TRANSLATION_LANGUAGES = Object.keys(translationsMap);
