/**
 * Browser download of an in-memory text payload.
 *
 * The study data never leaves the device on its own; exporting is an explicit action by the
 * participant or the researcher, which is what keeps the camera/privacy promise intact.
 */
export function downloadText(filename: string, text: string, type = 'text/plain'): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers; one frame is enough.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}