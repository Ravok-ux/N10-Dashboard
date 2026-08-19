// ══════════════════════════════════════════════════════════════
// fcm.js — Firebase Cloud Messaging (push notifications web)
// ══════════════════════════════════════════════════════════════

import { messaging, VAPID_KEY } from "./firebase-config.js";
import { getToken, onMessage }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { doc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { Sesion } from "./auth.js";
import { db }     from "./firebase-config.js";

let _fcmIniciado = false;

export async function iniciarFCM() {
  if (_fcmIniciado) return;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
  if (!Sesion.uid) return;

  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") {
      console.info("[FCM] Permiso de notificaciones no otorgado");
      return;
    }

    // Registrar SW dedicado a FCM (gitignored — tiene config real)
    const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (!token) {
      console.warn("[FCM] No se pudo obtener token FCM");
      return;
    }

    // Guardar token en Firestore del usuario (arrayUnion evita duplicados)
    await updateDoc(doc(db, "usuarios", Sesion.uid), {
      fcmTokens: arrayUnion(token),
    });

    _fcmIniciado = true;
    console.info("[FCM] Token registrado y listo");

    // Manejar mensajes mientras la app está abierta (foreground)
    onMessage(messaging, (payload) => {
      const titulo = payload.notification?.title || "N-10 ERP";
      const cuerpo = payload.notification?.body  || "";
      // Mostrar como toast en lugar de notificación OS (ya está visible la app)
      window.toast?.(cuerpo || titulo, "info");
    });

    // Escuchar clicks de notificación desde el SW (app en background)
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "FCM_CLICK") {
        const vista = e.data.data?.vista;
        if (vista && typeof window.navigate === "function") {
          window.navigate(vista);
        }
      }
    });

  } catch (err) {
    console.error("[FCM] Error al iniciar:", err);
  }
}
