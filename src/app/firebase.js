// Вход через Firebase Auth (compat-скрипты из CDN, глобал firebase). Firestore в этой версии не используется:
// данные идут через API, а ID-токен Firebase подтверждает пользователя на сервере.

// Ошибки Firebase Auth приходят по-английски — переводим частые
const AUTH_ERRORS = {
  "auth/invalid-credential": "Неверный email или пароль",
  "auth/wrong-password": "Неверный email или пароль",
  "auth/user-not-found": "Неверный email или пароль",
  "auth/invalid-email": "Некорректный email",
  "auth/email-already-in-use": "Такой email уже зарегистрирован",
  "auth/weak-password": "Пароль слишком простой — минимум 6 символов",
  "auth/too-many-requests": "Слишком много попыток, попробуйте позже",
  "auth/network-request-failed": "Нет связи с сервером — проверьте интернет"
};

export function authErrorMessage(err) {
  return AUTH_ERRORS[err?.code] || err?.message || "Не удалось войти";
}

export function createFirebaseAuth(env) {
  if (!firebase.apps.length) {
    firebase.initializeApp({
      apiKey: env.FIREBASE_API_KEY,
      authDomain: env.FIREBASE_AUTH_DOMAIN,
      projectId: env.FIREBASE_PROJECT_ID,
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
      appId: env.FIREBASE_APP_ID,
      measurementId: env.FIREBASE_MEASUREMENT_ID
    });
  }
  const auth = firebase.auth();
  return {
    onChange: (cb) => auth.onAuthStateChanged(u => cb(u ? { uid: u.uid, email: u.email } : null)),
    signIn: (email, password) => auth.signInWithEmailAndPassword(email, password),
    register: (email, password) => auth.createUserWithEmailAndPassword(email, password),
    signOut: () => auth.signOut(),
    getIdToken: () => {
      if (!auth.currentUser) throw new Error("not signed in");
      return auth.currentUser.getIdToken();
    }
  };
}
