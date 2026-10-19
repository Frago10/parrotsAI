// Página que pide el permiso de micrófono una sola vez (el panel lateral no puede mostrar el aviso).
const statusEl = document.getElementById('status')!;
document.getElementById('grant')!.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const t of stream.getTracks()) t.stop();
    statusEl.textContent =
      '✅ Micrófono concedido. Ya puedes cerrar esta pestaña y volver al panel.';
  } catch (err) {
    statusEl.textContent = `No se concedió el permiso: ${err instanceof Error ? err.message : String(err)}. Revisa chrome://settings/content/microphone.`;
  }
});

export {};
