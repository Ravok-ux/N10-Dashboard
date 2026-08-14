// ══════════════════════════════════════════════════════════════
// firebase-config.js
// Las claves se inyectan en CI/CD desde GitHub Secrets.
// NUNCA subas valores reales a este archivo al repositorio.
// ══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Claves sustituidas en deploy: %%VAR_NAME%%
const firebaseConfig = {
  apiKey:            "%%FIREBASE_API_KEY%%",
  authDomain:        "%%FIREBASE_AUTH_DOMAIN%%",
  projectId:         "%%FIREBASE_PROJECT_ID%%",
  storageBucket:     "%%FIREBASE_STORAGE_BUCKET%%",
  messagingSenderId: "%%FIREBASE_MESSAGING_SENDER_ID%%",
  appId:             "%%FIREBASE_APP_ID%%"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export { app, auth, db };
