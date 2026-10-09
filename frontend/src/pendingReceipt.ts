// Tiny in-memory store for a receipt image being handed off from the scan screen
// to the add-expense screen. Cleared after read.
let PENDING: { base64: string; mime: string } | null = null;

export function setPendingReceipt(base64: string | null, mime: string = 'image/jpeg') {
  PENDING = base64 ? { base64, mime } : null;
}

export function takePendingReceipt(): { base64: string; mime: string } | null {
  const r = PENDING;
  PENDING = null;
  return r;
}
