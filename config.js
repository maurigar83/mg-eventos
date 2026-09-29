// URL ÚNICA de la API (proyecto Apps Script "Validación QR Evento").
// Todas las rutas (login/panel, lector QR, Ventas y webhook de WhatsApp)
// las atiende el mismo proyecto: doGet/doPost separan cada caso.
// Las 3 claves se conservan para no tocar el resto del front.
const API_UNICA = "https://script.google.com/macros/s/AKfycbxyBX5k1h-LsYNRFO_g-eDkkqoE3vE_N4AWZA4c9PS0fixYVIpGPRGc5bYnn-DDqFEd/exec";

const CONFIG = {
  SEGURIDAD_API_URL: API_UNICA,
  BOLETAS_API_URL: API_UNICA,
  VENTAS_URL: API_UNICA
};
