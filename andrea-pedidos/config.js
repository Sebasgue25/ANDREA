// Configuración de Supabase para Andrea — Pedidos.
//
// Este archivo SÍ se sube a GitHub (a diferencia de .env): la "anonKey" de
// Supabase está diseñada para vivir en el navegador del cliente, siempre que
// tengas activado Row Level Security (RLS) en tus tablas de Supabase.
//
// Nunca pongas aquí la "service_role key" de Supabase: esa sí es secreta y
// nunca debe salir de tu backend.
//
// Mientras "url" y "anonKey" queden vacíos, la aplicación sigue funcionando
// en modo local (sin nube), exactamente como hasta ahora.

window.ANDREA_SUPABASE_CONFIG = {
  url: 'https://upgrcviijcvvrnrxzygn.supabase.co',      // Ej: 'https://xxxxxxxxxxxx.supabase.co'
  anonKey: 'sb_publishable_cPEW9mefMud1wTe1gqGLvQ_VtevqYJg'   // Ej: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};
